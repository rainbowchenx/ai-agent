# ask_all Permission Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置 `ask_all` 后，工具调用前在对话流内联卡片确认（允许 / 本会话允许 / 拒绝）；Server 挂起等待；会话豁免仅存进程内存。

**Architecture:** Shared 扩展 `permission_response.scope`；Core 在 emit `permission_request` 前增加 `isPreAllowed` 跳过询问；Server `PermissionBroker` 挂起 requestId 并记 session 豁免；Desktop 权限卡片三按钮发 WS，视觉对齐 Figma `16:235`。

**Tech Stack:** TypeScript monorepo、Fastify WebSocket、Vitest、React/Zustand Electron desktop

**Spec:** `docs/superpowers/specs/2026-09-20-ask-all-permission-design.md`

## UI Reference

| 项 | 值 |
|----|-----|
| Figma | https://www.figma.com/design/6mxCXcFGVyupqTTKbZD7GF/myagent?node-id=16-235 |
| Figma `fileKey` | `6mxCXcFGVyupqTTKbZD7GF` |
| Figma `nodeId` | `16:235` |
| 备注 | 只对齐权限卡片（标题、副文案、参数块、三描边按钮）；不重做整页壳。 |

## Global Constraints

- 本切片 **仅 ask_all 确认环**；不做 MCP、不改 `default` 写操作策略、豁免不落库。
- 「本会话允许」按 **工具名**，忽略参数；仅 Server 进程内存；重启清空。
- 拒绝 → tool error 回模型，**run 继续**（现有 Runner 行为）。
- Stop / WS close → abort，不执行工具；清理 Broker pending。
- 不提交设计 zip / `Agent 工作台 等 5 个设计/`。
- 每任务单独 commit；Windows 用 PowerShell here-string 提交。
- 分支：`feat/ask-all-permission`（自最新 `main`）。

---

## File map

| 文件 | 职责 |
|------|------|
| `packages/shared/src/api.ts` | `PermissionWsResponse.scope?: "once" \| "session"` |
| `packages/core/src/permissions/permission-gate.ts` | `isPreAllowed?`；跳过时不 `onRequest` |
| `packages/core/src/runner/types.ts` / `runner.ts` | 传入 `isPreAllowed` |
| `packages/core/src/runner/runner.test.ts` | 豁免跳过无 `permission_request` |
| `packages/server/src/permissions/permission-broker.ts` | 进程内 pending + sessionAllow |
| `packages/server/src/permissions/permission-broker.test.ts` | Broker 单测 |
| `packages/server/src/routes/runs.ts` | 接线 broker；处理 `permission_response` |
| `packages/server/src/app.ts` | 创建 broker 注入 deps |
| `packages/server/src/routes/runs.test.ts` | WS 集成：allow / session / deny / stop |
| `apps/desktop/src/lib/apply-run-event.ts` | permission `status`；`run_end` 标 expired；`resolvePermission` |
| `apps/desktop/src/components/chat/message-bubble.tsx` | Figma 卡片 + 三按钮 |
| `apps/desktop/src/stores/session-store.ts` | `respondPermission` |
| `apps/desktop/src/components/settings/settings-page.tsx` | 删「后续完善」提示 |
| `scripts/smoke-ask-all.ts`（可选）+ `docs/learning/P2-ASK-ALL.md` | 冒烟 / 学习短记 |

**已存在可复用：** `evaluatePermission` ask_all + abort race；Runner emit `permission_request`；`PermissionWsResponse` 形状；Desktop `kind: "permission"` 占位卡片；settings 可保存 `permissions.mode`。

---

### Task 1: Shared `scope` + Core `isPreAllowed`

**Files:**
- Modify: `packages/shared/src/api.ts`
- Modify: `packages/core/src/permissions/permission-gate.ts`
- Modify: `packages/core/src/runner/types.ts`
- Modify: `packages/core/src/runner/runner.ts`
- Modify: `packages/core/src/runner/runner.test.ts`
- Create or modify: `packages/core/src/permissions/permission-gate.test.ts`（若尚无则创建）

**Interfaces:**
- Consumes: 现有 `PermissionRequest` / `PermissionDecision`
- Produces:
  - `PermissionWsResponse.scope?: "once" | "session"`
  - `evaluatePermission({ ..., isPreAllowed?: (toolName: string) => boolean })`
  - `RunnerRunInput.isPreAllowed?: (toolName: string) => boolean`

- [ ] **Step 1: 扩展 shared 类型**

```ts
export type PermissionWsResponse = {
  type: "permission_response";
  requestId: string;
  allow: boolean;
  scope?: "once" | "session";
};
```

- [ ] **Step 2: 写失败测 — ask_all + isPreAllowed 不 emit permission_request**

在 `runner.test.ts`（或 gate 测）增加：

```ts
it("skips permission_request when isPreAllowed returns true", async () => {
  // model yields one tool_call for "echo"
  // permissions: ask_all
  // isPreAllowed: (name) => name === "echo"
  // onPermissionRequest: should NOT be called (or track calls === 0)
  // events must NOT contain permission_request
  // tool must still execute
});
```

- [ ] **Step 3: 实现 gate + runner 接线**

`permission-gate.ts` 在 `ask_all` 分支：

```ts
if (policy.mode === "ask_all") {
  if (input.isPreAllowed?.(toolName)) {
    return { allow: true };
  }
  const requestId = crypto.randomUUID();
  // ... existing onRequest + wait
}
```

`runner.ts` `executeToolCall` 传入：

```ts
isPreAllowed: input.isPreAllowed,
```

- [ ] **Step 4: 跑测**

```bash
pnpm --filter @agent2026/core test
pnpm --filter @agent2026/shared exec tsc --noEmit
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/api.ts packages/core/src/permissions packages/core/src/runner
git commit -m "feat(core): skip ask_all when tool is pre-allowed"
```

---

### Task 2: PermissionBroker

**Files:**
- Create: `packages/server/src/permissions/permission-broker.ts`
- Create: `packages/server/src/permissions/permission-broker.test.ts`

**Interfaces:**
- Consumes: `@agent2026/core` 的 `PermissionDecision` / `PermissionRequest`（或本地等价）
- Produces:

```ts
export type PermissionScope = "once" | "session";

export class PermissionBroker {
  isSessionAllowed(sessionId: string, toolName: string): boolean;
  allowSession(sessionId: string, toolName: string): void;
  wait(
    input: {
      requestId: string;
      sessionId: string;
      toolName: string;
      runId: string;
    },
    signal?: AbortSignal,
  ): Promise<PermissionDecision>;
  respond(input: {
    requestId: string;
    allow: boolean;
    scope?: PermissionScope;
  }): boolean; // true if a waiter was resolved
  cancelRun(runId: string): void; // reject/abort all pending for run
}
```

行为细则：

- `wait`：登记 pending；若 `signal` 已 abort 或之后 abort → 从 pending 删除并以与 gate 一致的方式结束（throw AbortError **或** resolve 由上层 race — **推荐 wait 内部 race abort，abort 时 delete pending 并 reject AbortError**，Runner 的 `racePermissionResponse` 仍会处理 signal；为避免双重路径，wait 在 abort 时 `delete` + `reject` AbortError，且 Runner 已有 signal race — 更简：`wait` 只登记，`respond`/`cancelRun` 收尾；`cancelRun` 在 hub.abort / WS close 时由 runs 路由调用）。
- `respond`：未知 id → `false`；`allow === false` 忽略 scope；`allow && scope === "session"` → `allowSession`；resolve `{ allow }`；delete pending → `true`。
- `isSessionAllowed` / `allowSession`：按 sessionId → Set\<toolName\>。

- [ ] **Step 1: 写 Broker 单测（先红）**

覆盖：wait+respond once；session 豁免；unknown id no-op；cancelRun 使 wait reject/abort。

- [ ] **Step 2: 实现 Broker**

- [ ] **Step 3: 跑测**

```bash
pnpm --filter @agent2026/server exec vitest run src/permissions/permission-broker.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/permissions
git commit -m "feat(server): add in-memory PermissionBroker"
```

---

### Task 3: Wire runs.ts + app + 集成测

**Files:**
- Modify: `packages/server/src/routes/runs.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/runs.test.ts`

**Interfaces:**
- Consumes: `PermissionBroker` from Task 2；`isPreAllowed` from Task 1
- Produces: 端到端 WS `permission_response` 可解开工具执行

- [ ] **Step 1: 扩展 `RunRouteDeps`**

```ts
export type RunRouteDeps = {
  // ...existing
  permissionBroker: PermissionBroker;
};
```

`app.ts`：`const permissionBroker = new PermissionBroker();` 传入 `registerRunRoutes`。

- [ ] **Step 2: 处理 `permission_response`**

替换 no-op：

```ts
if (parsed.type === "permission_response") {
  const scope =
    parsed.allow === false
      ? "once"
      : parsed.scope === "session"
        ? "session"
        : "once";
  deps.permissionBroker.respond({
    requestId: parsed.requestId,
    allow: parsed.allow,
    scope,
  });
  return;
}
```

校验 `scope` 仅接受 `"once" | "session" | undefined`（其他当 once）。

- [ ] **Step 3: `startRun` 注入回调**

```ts
const sessionId = request.sessionId;
const result = await runtime.runner.run({
  // ...existing
  isPreAllowed: (toolName) =>
    deps.permissionBroker.isSessionAllowed(sessionId, toolName),
  onPermissionRequest: (req) =>
    deps.permissionBroker.wait(
      {
        requestId: req.requestId,
        sessionId,
        toolName: req.toolName,
        runId,
      },
      controller.signal,
    ),
});
```

在 `hub.abort` 路径与 WS `close` 里，对每个 runId 调用 `permissionBroker.cancelRun(runId)`（可在 `hub.abort` 成功后、或 close 循环里）。

`wait` 实现必须与 abort 配合：abort 时 pending 被 `cancelRun` reject AbortError，gate 的 signal race 也会触发 — 保证工具不执行。

- [ ] **Step 4: 集成测（mock model 发 tool_call）**

在 `runs.test.ts` 增加（模式对齐现有 inject + ws）：

1. **allow once：** 收到 `permission_request` → 发 `{ type, requestId, allow: true }` → 见 `tool_start`/`tool_end`/`run_end` completed  
2. **session：** 第一次 `scope: "session"`；同 session 第二次 run 同工具 → **无** `permission_request`，仍执行工具  
3. **deny：** `allow: false` → `tool_end` isError（或 result 含 Permission denied），run `completed` 非因拒绝而 `error`  
4. **stop while waiting：** 收到 `permission_request` 后 `POST /runs/:id/stop` → `run_end` stopped，无成功 tool 执行  

Mock model 参考现有 tool 测；可用内置 `read_file`（workspace 写临时文件）或最小 tool。

- [ ] **Step 5: 跑测**

```bash
pnpm --filter @agent2026/server test
```

Expected: PASS（含新增用例）

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/runs.ts packages/server/src/app.ts packages/server/src/routes/runs.test.ts
git commit -m "feat(server): wire PermissionBroker into WS runs"
```

---

### Task 4: Desktop 投影 + 发响应

**Files:**
- Modify: `apps/desktop/src/lib/apply-run-event.ts`
- Modify: `apps/desktop/src/lib/apply-run-event.test.ts`
- Modify: `apps/desktop/src/stores/session-store.ts`
- Modify: `apps/desktop/src/lib/ws-client.ts`（可选 `sendPermissionResponse` 辅助）

**Interfaces:**
- Produces:

```ts
// ChatItem permission
{
  kind: "permission";
  id: string;
  requestId: string;
  toolName: string;
  arguments?: unknown;
  status: "pending" | "allowed" | "session_allowed" | "denied" | "expired";
}

export function resolvePermissionLocally(
  state: RunProjection,
  requestId: string,
  status: "allowed" | "session_allowed" | "denied",
): RunProjection;

// on run_end: all pending permission → expired
```

- [ ] **Step 1: 测 — permission_request 带 pending；resolve；run_end 标 expired**

- [ ] **Step 2: 实现投影辅助**

- [ ] **Step 3: `session-store.respondPermission(requestId, allow, scope?)`**

```ts
respondPermission: (requestId, allow, scope) => {
  socket?.sendJson({
    type: "permission_response",
    requestId,
    allow,
    ...(allow && scope === "session" ? { scope: "session" } : {}),
  });
  set((state) => ({
    run: resolvePermissionLocally(
      state.run,
      requestId,
      !allow ? "denied" : scope === "session" ? "session_allowed" : "allowed",
    ),
  }));
};
```

- [ ] **Step 4: 跑 desktop 相关测**

```bash
pnpm --filter @agent2026/desktop test
```

（若 filter 名不同，用仓库实际 desktop 包名 / vitest 路径）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/apply-run-event.ts apps/desktop/src/lib/apply-run-event.test.ts apps/desktop/src/stores/session-store.ts apps/desktop/src/lib/ws-client.ts
git commit -m "feat(desktop): project permission card status and send responses"
```

---

### Task 5: 权限卡片 UI（对齐 Figma）+ 设置文案

**Files:**
- Modify: `apps/desktop/src/components/chat/message-bubble.tsx`（或拆 `permission-card.tsx`）
- Modify: `apps/desktop/src/components/chat/chat-pane.tsx`（若需把 onRespond 传入）
- Modify: `apps/desktop/src/components/settings/settings-page.tsx`
- Modify: `apps/desktop/src/styles.css`（权限卡片 token，必要时）

**Interfaces:**
- Consumes: `respondPermission` from store；Figma 文案

- [ ] **Step 1: 实现卡片**

- 标题：`工具权限请求 · {toolName}`
- 副文案：`read_file` →「Agent 希望读取本地文件以继续完成任务」；其他 →「Agent 希望调用该工具以继续完成任务」
- 参数块：等宽；object 则 `key: value` 每行，否则 `JSON.stringify`
- 三按钮：允许 / 本会话允许 / 拒绝；`status !== "pending"` 时 disabled
- 颜色：允许 `#2e8dff` 描边字；本会话灰边；拒绝 `#ff453a`
- 终态：可显示一行「已允许 / 本会话已允许 / 已拒绝 / 已失效」

- [ ] **Step 2: 设置页删除「后续版本完善」alert**

- [ ] **Step 3: 手工或组件冒烟**（有浏览器工具则截图对照 Figma 卡片区域）

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/components apps/desktop/src/styles.css
git commit -m "feat(desktop): Figma-aligned ask_all permission card"
```

---

### Task 6: 冒烟脚本 + 学习短记

**Files:**
- Create: `scripts/smoke-ask-all.ts`
- Modify: `package.json`（`smoke:ask-all`）
- Create: `docs/learning/P2-ASK-ALL.md`
- Modify: `docs/superpowers/specs/2026-09-20-ask-all-permission-design.md`（状态 → 实现中/已实现）

**Interfaces:**
- 脚本：启临时 server（或连已有）→ PUT config `ask_all` → WS run 触发 tool → 自动回 `allow: true` → 断言 tool_end（CI 用 mock model 注入困难时，可只文档化手工步骤 + server 集成测已覆盖）

若自动化冒烟成本高：**最低交付** = `P2-ASK-ALL.md` 手工清单 + 规格状态更新；脚本可选。优先保证 Task 3 集成测已覆盖规格 §7 的 1–4。

- [ ] **Step 1: 写 `docs/learning/P2-ASK-ALL.md`**（模式、三按钮、豁免内存、测试命令）

- [ ] **Step 2: 全量测试**

```bash
pnpm test
```

Expected: 全绿

- [ ] **Step 3: Commit**

```bash
git add docs/learning/P2-ASK-ALL.md docs/superpowers/specs/2026-09-20-ask-all-permission-design.md package.json scripts/smoke-ask-all.ts
git commit -m "docs: note ask_all permission slice status"
```

---

## Self-review (plan vs spec)

| Spec 要求 | Task |
|-----------|------|
| `scope` 契约 | 1, 3, 4 |
| `isPreAllowed` / 豁免不出卡片 | 1, 3 |
| PermissionBroker 内存豁免 | 2, 3 |
| WS respond 接线 | 3 |
| Stop/断开清理 | 2 (`cancelRun`), 3 |
| 内联三按钮 + Figma | 5 |
| 设置文案 | 5 |
| 测试 1–5 | 3, 4；冒烟 6 |
| 非目标 MCP 等 | Global Constraints |

无 TBD 占位。`PermissionBroker.wait` 与 abort 的精确 Promise 语义在 Task 2 实现时以「abort 后工具不执行 + pending 不泄漏」为准。
