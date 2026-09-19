# Trace Panel (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台会话下可开关的右侧「调用轨迹」面板：live 跟 WS 事件画 Timeline，并可切换本会话最近 run 从 SQLite 只读加载历史 spans。

**Architecture:** Server 在 `startRun` 的事件适配层写入 `traces`/`spans`（不改 Runner 语义）；新增 `GET /sessions/:id/runs` 与 `GET /runs/:runId/trace`；Desktop 将 `RunEvent` 投影为 `TraceNode[]`，升级 `RunDetails` 为可折叠 Timeline；视觉对齐留到用户提供 Figma 后再做。

**Tech Stack:** TypeScript monorepo、Fastify、better-sqlite3、Vitest、React/Zustand Electron desktop

**Spec:** `docs/superpowers/specs/2026-09-19-trace-panel-design.md`

## UI Reference（待补链接）

> 用户出稿后把链接填到这里；**Task 7** 在链接就位前不要做像素级对齐。

| 项 | 值 |
|----|-----|
| Figma / 设计稿 | _（待用户补充）_ |
| 备注 | 功能 UI（Task 5–6）先按规格 §4 与现有 `workbench`/`panel` 样式落地；Task 7 再对照稿微调 |

## Global Constraints

- 本切片 **仅 Trace**；不做 `ask_all`、第二 Provider、独立观测导航页、Usage 图表。
- span 写入失败 **不阻断** run（try/catch 吞掉并可选 log）。
- Desktop **不写** trace 库；只读 HTTP + WS。
- 默认右侧 Trace **展开**；若 UI 稿改为默认收起则 Task 7 跟稿。
- generation = **每次模型调用一条 span**（首个 `message_delta` 开、遇 `tool_start`/`run_end`/`error` 关），不是每个 delta 一条。
- `metadata.summary` 为可选短字符串（tool 结果截断至 ≤200 字符）。
- 不提交设计 zip / `Agent 工作台 等 5 个设计/`。
- 每任务单独 commit；Windows 用 PowerShell here-string 提交。
- 建议在 `feat/trace-panel` 分支工作。

---

## File map

| 文件 | 职责 |
|------|------|
| `packages/server/src/db/schema.ts` | `traces` 增加 `status`/`ended_at`；迁移辅助 |
| `packages/server/src/db/migrate-traces.ts` | 幂等 `ALTER TABLE`（若列不存在） |
| `packages/server/src/store/sqlite-trace-port.ts` | 扩展：updateTraceEnd、listRunsBySession、getTraceByRunId、查询 spans |
| `packages/server/src/trace/run-trace-recorder.ts` | 根据 RunnerEvent 写 span/trace status |
| `packages/server/src/routes/runs.ts` | 挂 recorder；注册 GET trace |
| `packages/server/src/routes/sessions.ts` 或新 `routes/traces.ts` | `GET /sessions/:id/runs` |
| `packages/server/src/app.ts` | 注册路由 / 启动迁移 |
| `packages/shared/src/api.ts` (+ export) | `ListSessionRunsResponse`、`GetRunTraceResponse` |
| `apps/desktop/src/lib/trace-nodes.ts` | `TraceNode` + `applyTraceEvent` / `spansToNodes` |
| `apps/desktop/src/lib/api.ts` | `listSessionRuns`、`getRunTrace` |
| `apps/desktop/src/stores/session-store.ts` | `tracePanelOpen`、`selectedTraceRunId`、历史加载 |
| `apps/desktop/src/components/chat/run-details.tsx` | Timeline UI（功能版） |
| `apps/desktop/src/components/chat/workbench.tsx` | 会话下 Trace 开关；折叠时隐藏右栏 |
| `apps/desktop/src/components/chat/trace-timeline.tsx` | 节点列表展示（可从 run-details 拆出） |

**已存在可复用：** `SqliteTracePort.startTrace/startSpan/endSpan`、`RunEvent`、`apply-run-event.ts`、`RunDetails` 占位、`data-trace-panel`。

---

### Task 1: Schema 迁移 + TracePort 查询/结束

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/db/migrate-traces.ts`
- Modify: `packages/server/src/db/sqlite.ts`（open 后调用 migrate）
- Modify: `packages/server/src/store/sqlite-trace-port.ts`
- Modify: `packages/server/src/store/sqlite-session-store.test.ts`（或新建 `sqlite-trace-port` 查询测）

**Interfaces:**
- Produces:
  - `migrateTracesSchema(db): void` — 若缺列则 `ALTER TABLE traces ADD COLUMN status TEXT` / `ended_at TEXT`
  - `SqliteTracePort.updateTraceEnd({ runId, status, endedAt })`
  - `SqliteTracePort.listRunsBySession(sessionId, limit): TraceRunSummary[]`
  - `SqliteTracePort.getByRunId(runId): { trace, spans } | null`
  - `startTrace` 插入时 `status='running'`，`ended_at=NULL`

```ts
export type TraceRunStatus = "running" | "completed" | "stopped" | "error";

export type TraceRunSummary = {
  runId: string;
  traceId: string;
  status: TraceRunStatus;
  createdAt: string;
  endedAt?: string;
};

export type TraceSpanRow = {
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: "generation" | "tool" | "permission";
  status?: "ok" | "error";
  startedAt: string;
  endedAt?: string;
  summary?: string;
};
```

- [ ] **Step 1: Write failing tests**

在 `packages/server/src/store/sqlite-session-store.test.ts` 的 SqliteTracePort describe（或新文件）增加：

```ts
it("startTrace sets status running; updateTraceEnd + listRunsBySession + getByRunId roundtrip", async () => {
  // open db with migrate
  const port = new SqliteTracePort(db);
  const { traceId } = await port.startTrace({ runId: "r1", sessionId: "s1" });
  const { spanId } = await port.startSpan({
    traceId,
    name: "generation",
    kind: "generation",
  });
  await port.endSpan({ spanId, status: "ok" });
  await port.updateTraceEnd({
    runId: "r1",
    status: "completed",
    endedAt: new Date().toISOString(),
  });
  const runs = await port.listRunsBySession("s1", 20);
  expect(runs[0]).toMatchObject({ runId: "r1", traceId, status: "completed" });
  const full = await port.getByRunId("r1");
  expect(full?.spans).toHaveLength(1);
  expect(full?.spans[0]?.kind).toBe("generation");
});
```

- [ ] **Step 2: Run test — expect FAIL**（方法不存在）

```bash
pnpm --filter @agent2026/server exec vitest run src/store/sqlite-session-store.test.ts
```

- [ ] **Step 3: Implement schema + migrate + port methods**

`schema.ts` 的 `CREATE TABLE traces` 含 `status`/`ended_at`（新库）。  
`migrateTracesSchema`：`PRAGMA table_info(traces)` 检查列，缺失则 ALTER。  
`getByRunId`：join spans，`metadata` JSON 解析出 `summary` 若存在。

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```powershell
git add packages/server/src/db packages/server/src/store
git commit -m @"
feat(server): extend traces schema and query APIs for run timeline
"@
```

---

### Task 2: RunTraceRecorder（事件 → spans）

**Files:**
- Create: `packages/server/src/trace/run-trace-recorder.ts`
- Create: `packages/server/src/trace/run-trace-recorder.test.ts`

**Interfaces:**
- Consumes: `SqliteTracePort`（startSpan/endSpan/updateTraceEnd）
- Produces:

```ts
export function createRunTraceRecorder(port: SqliteTracePort): {
  onEvent(event: RunnerEvent): void; // sync fire-and-forget; internal void promises
};
```

**规则：**

| 事件 | 动作 |
|------|------|
| `run_start` | 记录 `traceId`（trace 行已由 routes 创建） |
| 首个 `message_delta`（无 open generation） | `startSpan(kind=generation, name="generation")` |
| `tool_start` | 若有 open generation → `endSpan(ok)`；`startSpan(kind=tool, name=toolName)`，记下 toolCallId→spanId |
| `tool_end` | `endSpan`；`metadata: { summary: result.slice(0,200) }`；`status` 随 `isError` |
| `error` | 结束 open spans（error）；`updateTraceEnd(status=error)` 可延后到 run_end |
| `run_end` | 结束残余 open spans；`updateTraceEnd({ runId, status: reason, endedAt })` |

所有 port 调用包在 try/catch，失败不影响调用方。

- [ ] **Step 1: Write failing unit tests** with in-memory fake TracePort collecting calls；驱动假事件序列：run_start → deltas → tool_start/end → deltas → run_end，断言 span 顺序与 updateTraceEnd。

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @agent2026/server exec vitest run src/trace/run-trace-recorder.test.ts
```

- [ ] **Step 3: Implement recorder**

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```powershell
git add packages/server/src/trace
git commit -m @"
feat(server): record generation and tool spans from run events
"@
```

---

### Task 3: 接线 startRun + HTTP 只读 API + shared DTO

**Files:**
- Modify: `packages/shared/src/api.ts`、`packages/shared/src/index.ts`
- Modify: `packages/server/src/routes/runs.ts`
- Create or Modify: `packages/server/src/routes/traces.ts`（推荐独立）并在 `app.ts` 注册
- Modify: `packages/server/src/routes/runs.test.ts`（或新 `traces.test.ts`）

**Interfaces:**
- Produces shared types:

```ts
export type ListSessionRunsResponse = {
  runs: Array<{
    runId: string;
    traceId: string;
    status: "running" | "completed" | "stopped" | "error";
    createdAt: string;
    endedAt?: string;
  }>;
};

export type GetRunTraceResponse = {
  runId: string;
  traceId: string;
  status: "running" | "completed" | "stopped" | "error";
  createdAt: string;
  endedAt?: string;
  spans: Array<{
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: "generation" | "tool" | "permission";
    status?: "ok" | "error";
    startedAt: string;
    endedAt?: string;
    summary?: string;
  }>;
};
```

- Routes:
  - `GET /sessions/:sessionId/runs?limit=20` → 404 if session missing（可选：session 不存在仍返回 `runs: []`；**本计划：session 不存在 404**）
  - `GET /runs/:runId/trace` → 404 if unknown runId

- [ ] **Step 1: Write failing route tests**

在现有 mock WS run（含 tool）结束后：

```ts
const runs = await app.inject({ method: "GET", url: `/sessions/${sessionId}/runs` });
expect(runs.json().runs.length).toBeGreaterThanOrEqual(1);
const runId = runs.json().runs[0].runId;
const trace = await app.inject({ method: "GET", url: `/runs/${runId}/trace` });
expect(trace.statusCode).toBe(200);
expect(trace.json().spans.some((s: { kind: string }) => s.kind === "tool")).toBe(true);
```

另测 `GET /runs/nope/trace` → 404。

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @agent2026/server exec vitest run src/routes/runs.test.ts
```

- [ ] **Step 3: Wire recorder in `startRun`**

在已有 `startTrace` 之后：

```ts
const recorder = createRunTraceRecorder(deps.tracePort);
// inside onEvent, after mapping/send (or before persist skip):
recorder.onEvent(event);
```

注意：`run_end` 仍先 persist messages 再 send；recorder 应在收到 runner 的每个事件时调用（含被 pending 的 run_end）。对 `pendingEnd` 在 send 前也 `recorder.onEvent(pendingEnd)`。

注册 GET handlers；export shared types。

- [ ] **Step 4: Run server + shared tests — expect PASS**

```bash
pnpm --filter @agent2026/shared test
pnpm --filter @agent2026/server test
```

- [ ] **Step 5: Commit**

```powershell
git add packages/shared packages/server
git commit -m @"
feat(server): expose session runs and run trace APIs with live span recording
"@
```

---

### Task 4: Desktop TraceNode 投影

**Files:**
- Create: `apps/desktop/src/lib/trace-nodes.ts`
- Create: `apps/desktop/src/lib/trace-nodes.test.ts`
- Modify: `apps/desktop/src/lib/apply-run-event.ts` — `RunProjection` 增加 `traceNodes: TraceNode[]`（可保留 `traceLines` 暂时兼容或删除，**本计划：用 `traceNodes` 替换 `traceLines`**，同步改测试）

**Interfaces:**

```ts
export type TraceNode =
  | { id: string; kind: "run_start"; at?: string }
  | { id: string; kind: "run_end"; reason: "completed" | "stopped" | "error" }
  | { id: string; kind: "generation"; status: "running" | "ok" | "error"; name?: string }
  | {
      id: string;
      kind: "tool";
      name: string;
      toolCallId: string;
      status: "running" | "ok" | "error";
      summary?: string;
    }
  | { id: string; kind: "error"; message: string };

export function applyTraceEvent(nodes: TraceNode[], event: RunEvent): TraceNode[];
export function spansToNodes(spans: GetRunTraceResponse["spans"], meta: {
  status: GetRunTraceResponse["status"];
}): TraceNode[];
```

Live 规则与 recorder 对称：`run_start` 推节点；首 delta 推/保持 generation running；`tool_*` 成对；`run_end`/`error` 收尾。

- [ ] **Step 1: Write failing tests** for applyTraceEvent sequence + spansToNodes

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @agent2026/desktop exec vitest run src/lib/trace-nodes.test.ts
```

- [ ] **Step 3: Implement + update `applyRunEvent` to maintain `traceNodes`**

- [ ] **Step 4: Fix `apply-run-event.test.ts`；全 desktop 单测 PASS**

```bash
pnpm --filter @agent2026/desktop test
```

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/lib
git commit -m @"
feat(desktop): project RunEvents and spans into TraceNode timeline
"@
```

---

### Task 5: session-store + API 客户端（开关 / 选 run / 拉历史）

**Files:**
- Modify: `apps/desktop/src/lib/api.ts`
- Modify: `apps/desktop/src/stores/session-store.ts`

**Interfaces:**
- `listSessionRuns(baseUrl, sessionId, limit?: number)`
- `getRunTrace(baseUrl, runId)`
- Store 字段：
  - `tracePanelOpen: boolean`（默认 `true`）
  - `selectedTraceRunId: string | null`（null = 跟随 live `run.runId`）
  - `historicalTrace: GetRunTraceResponse | null`
  - `historicalTraceLoading: boolean`
  - `historicalTraceError: string | null`
- Actions：`setTracePanelOpen`、`selectTraceRun(runId | null)`、`refreshSessionRuns`、加载历史（选中非 live 时）

当 `selectedTraceRunId === run.runId` 或 `null` 时 UI 用 live `traceNodes`；否则用 `spansToNodes(historicalTrace)`。

- [ ] **Step 1: 若有纯函数可测则补测；否则以手工 + 类型编译为准。优先给 `selectTraceRun` 加载逻辑抽 `resolveTraceView(state)` 单测。**

- [ ] **Step 2: Implement API + store**

- [ ] **Step 3: `pnpm --filter @agent2026/desktop test` PASS**

- [ ] **Step 4: Commit**

```powershell
git add apps/desktop/src/lib/api.ts apps/desktop/src/stores/session-store.ts
git commit -m @"
feat(desktop): wire trace panel state and history fetch APIs
"@
```

---

### Task 6: 功能 UI（Timeline + 开关 + run 下拉）

**Files:**
- Create: `apps/desktop/src/components/chat/trace-timeline.tsx`
- Modify: `apps/desktop/src/components/chat/run-details.tsx`
- Modify: `apps/desktop/src/components/chat/workbench.tsx`（及必要时 session 标题行组件）
- Modify: CSS / 现有 `panel` 类（仅够用的结构类，不做精美视觉）

**行为（对照规格 §4，功能优先）：**

1. 会话标题旁或主栏顶：`[Trace]` toggle → `setTracePanelOpen`  
2. `tracePanelOpen === false` 时不渲染右栏，`workbench-grid` 变单主栏（改 class 或条件）  
3. 右栏：标题「调用轨迹」、元信息、run `<select>`（`listSessionRuns` + 当前 live）、`<TraceTimeline nodes={...} />`  
4. 空态 / 加载 / 错误 + 重试按钮  
5. 可暂时保留「演示工具卡」在开发区或删除（**本计划：移到仅 `import.meta.env.DEV` 显示**）

- [ ] **Step 1: 实现组件与接线**

- [ ] **Step 2: 手工或 dev 启动验证开关与 live 节点出现**

```bash
pnpm dev:desktop
```

预期：发消息后 Timeline 出现 run/generation；有工具则有 tool 节点；下拉可见该 run；切历史（需至少两次 run）能加载。

- [ ] **Step 3: Commit**

```powershell
git add apps/desktop/src/components/chat apps/desktop/src
git commit -m @"
feat(desktop): add collapsible session trace timeline panel
"@
```

---

### Task 7: UI 稿 / Figma 视觉对齐（**阻塞：待链接**）

**Files:** 以稿为准，通常改 `run-details.tsx`、`trace-timeline.tsx`、相关 CSS。

**前置：** 本文档顶部「UI Reference」表中 Figma 链接已由用户填写。

- [ ] **Step 1: 用户补充链接后**，实现者读取 Figma（`figma-design-to-code` / `get_design_context`）对照规格 §4  
- [ ] **Step 2: 仅调视觉与间距/字体/轴样式；不改 API 契约**  
- [ ] **Step 3: 若稿规定默认收起，将 `tracePanelOpen` 默认改为 `false`**  
- [ ] **Step 4: Commit**

```powershell
git commit -m @"
style(desktop): align trace panel with design mock
"@
```

若链接长期未到：**跳过本任务**，功能版即可合并；视觉作 follow-up。

---

### Task 8: 文档勾选 + 可选 smoke 断言

**Files:**
- Modify: `docs/superpowers/specs/2026-09-19-trace-panel-design.md`（状态 → 实现中/完成）
- Modify: `docs/learning/P0-REVIEW.md` 或短笔记 `docs/learning/P1-TRACE.md`（可选）
- Optional: `scripts/smoke-p0.ts` 增加「tool run 后 GET trace spans.length ≥ 1」（可新建 `scripts/smoke-trace.ts`）

- [ ] **Step 1: 写简短验收笔记**（命令 + 结果）  
- [ ] **Step 2: Commit docs**

```powershell
git add docs scripts
git commit -m @"
docs: note P1 trace panel implementation status
"@
```

---

## Spec coverage checklist

| 规格项 | Task |
|--------|------|
| Live Timeline | 4, 6 |
| 历史 run + SQLite | 1, 3, 5, 6 |
| 会话下开关 + 右侧展开 | 5, 6 |
| 最近 N=20 run | 3, 5 |
| 写入 spans | 2, 3 |
| traces status/ended_at | 1, 2 |
| 写入失败不挡 run | 2 |
| 非目标排除 | Global Constraints |
| UI 稿对齐 | 7（待链接） |

## Self-review notes

- 无「TBD」实现步骤；UI 链接显式隔离在 Task 7。  
- generation span 开闭规则在 Task 2/4 一致。  
- `traceLines` → `traceNodes` 替换，避免双轨。  
- session 不存在时 runs API 返回 404（已写明）。
