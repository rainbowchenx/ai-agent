# 记忆写路径（任务后提炼）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** run 正常结束后异步用短 LLM 提炼结构化记忆，校验通过后经 OpenViking MCP 写入；设置可关；失败不影响对话。

**Architecture:** Server `MemoryConsolidator` 串行队列；`runs.ts` 在 `run_end completed` 且消息落库后 `enqueue`；用默认 `ModelPort.stream` 拼文本再解析 JSON；`mcp.getPort("openviking")` 白名单调用 `openviking__write`（失败再 `openviking__remember`）。Desktop 在既有「长期记忆」分区加 `autoDistill` 子开关。

**Tech Stack:** TypeScript monorepo、Zod、Vitest、Fastify、既有 ModelPort / MCP ToolPort、React/Zustand

**Spec:** `docs/superpowers/specs/2026-09-27-memory-distill-design.md`（**已确认**）

## Global Constraints

- **禁止** `packages/core` 依赖 OpenViking 或放入提炼实现。  
- 仅 **写路径**；不做 MemoryPort、auto-recall、探索、记忆浏览器、手动 POST 沉淀。  
- 门控三者同时：`mcpServers.openviking.enabled === true`、OV status `ready`、`openviking?.autoDistill !== false`（缺省为开）。  
- 仅 `run_end` `reason === "completed"` 提炼；`stopped`/`error` 不 enqueue。  
- Consolidator 调 MCP **绕过** PermissionBroker；**仅** `openviking__write` / `openviking__remember`（可选 health 禁止本切片调用）。**禁止** `forget` 与其它 server。  
- 写入顺序写死：先 `openviking__write`，失败再 `openviking__remember`；**0** 次额外重试。  
- 队列串行；未完成 job > 3 时跳过本 job，`lastStatus=skipped`（`skipped_busy` 记在 `lastMessage`）。  
- CI 不装真实 OV、不调真实 LLM；全部 mock。  
- 提炼异常不得影响 WS / run 响应。  
- 每任务单独 commit（PowerShell：`git commit -m "message"`，不用 bash heredoc）。

**常量（全 plan 统一）：**

```ts
export const DISTILL_MAX_ITEMS = 5;
export const DISTILL_CONFIDENCE_MIN = 0.5;
export const DISTILL_DO_MIN_LENGTH = 8;
export const DISTILL_MSG_TRUNCATE = 2000;
export const DISTILL_TOTAL_CHARS = 12000;
export const DISTILL_QUEUE_MAX = 3;
export const DISTILL_TIMEOUT_MS = 60_000;
export const DISTILL_DEDUPE_CACHE = 50;
export const OPENVIKING_SERVER_NAME = "openviking"; // 已有 constants.ts，server 侧复用
```

URI：`viking://~/memories/agent2026/{yyyy-mm-dd}/{runId}-{index}.md`（UTC 日期）。

---

## File map

| 文件 | 职责 |
|------|------|
| `packages/shared/src/memory-item.ts` | Zod `MemoryItem` / distill JSON / `DistillStatusView` |
| `packages/shared/src/config.ts` | `openviking.autoDistill` |
| `packages/shared/src/api.ts` + `index.ts` | 导出 status DTO |
| `packages/server/src/memory/constants.ts` | 上表常量 |
| `packages/server/src/memory/validate.ts` | promote / 密钥 / 去重指纹 |
| `packages/server/src/memory/distill-prompt.ts` | 裁剪输入 + prompt + 解析 JSON |
| `packages/server/src/memory/write-openviking.ts` | Markdown + 白名单 MCP 写 |
| `packages/server/src/memory/consolidator.ts` | 门控、队列、LLM、校验、写 |
| `packages/server/src/routes/memory.ts` | `GET /memory/distill/status` |
| `packages/server/src/routes/runs.ts` | completed 后 enqueue |
| `packages/server/src/app.ts` | 创建 consolidator；shutdown |
| `apps/desktop/.../memory-settings-panel.tsx` | 子开关 + 上次结果 |
| `apps/desktop/src/lib/api.ts` / settings-store | fetch + save autoDistill |
| `docs/learning/P3-MEMORY-DISTILL.md` | 冒烟清单 |

---

### Task 1: Shared — MemoryItem + `autoDistill`

**Files:**
- Create: `packages/shared/src/memory-item.ts`
- Modify: `packages/shared/src/config.ts`
- Modify: `packages/shared/src/config.test.ts`
- Modify: `packages/shared/src/api.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `memoryItemSchema` / `type MemoryItem`
  - `distillModelOutputSchema` `{ items: Array<{ kind, when, do, outcome, confidence }> }`（无 status/source；consolidator 补）
  - `DistillStatusView`（与 api 导出同一形状）
  - `AppConfig.openviking?.autoDistill?: boolean`，Zod `.default(true)` 在 openviking **对象内**

- [ ] **Step 1: 写失败测试**

在 `config.test.ts` 增加：

```ts
it("defaults autoDistill to true when openviking block omits it", () => {
  const config = parseAppConfig({
    ...defaultAppConfig(),
    openviking: { embeddingModel: "text-embedding-3-small" },
  });
  expect(config.openviking?.autoDistill).toBe(true);
});

it("accepts autoDistill false", () => {
  const config = parseAppConfig({
    ...defaultAppConfig(),
    openviking: { autoDistill: false },
  });
  expect(config.openviking?.autoDistill).toBe(false);
});
```

另建 `packages/shared/src/memory-item.test.ts`：合法 item parse；confidence 越界失败。

- [ ] **Step 2: Run 确认失败**

Run: `pnpm --filter @agent2026/shared test`  
Expected: FAIL（未知字段 / 缺模块）

- [ ] **Step 3: 实现**

`memory-item.ts`：

```ts
import { z } from "zod";

export const memoryKindSchema = z.enum([
  "fact",
  "procedure",
  "preference",
  "boundary",
]);

export const memoryStatusSchema = z.enum([
  "candidate",
  "frozen",
  "rejected",
]);

export const memoryItemSchema = z.object({
  kind: memoryKindSchema,
  when: z.string().min(1),
  do: z.string().min(1),
  outcome: z.string().min(1),
  confidence: z.number().min(0).max(1),
  status: memoryStatusSchema,
  sourceRunId: z.string().min(1),
  sourceSessionId: z.string().min(1),
  sourceTraceId: z.string().min(1).optional(),
});

export type MemoryItem = z.infer<typeof memoryItemSchema>;

export const distillDraftItemSchema = z.object({
  kind: memoryKindSchema,
  when: z.string(),
  do: z.string(),
  outcome: z.string(),
  confidence: z.number(),
});

export const distillModelOutputSchema = z.object({
  items: z.array(distillDraftItemSchema),
});

export type DistillDraftItem = z.infer<typeof distillDraftItemSchema>;

export type DistillLastStatus =
  | "idle"
  | "running"
  | "ok"
  | "error"
  | "skipped";

export type DistillStatusView = {
  enabled: boolean;
  lastAt?: string;
  lastRunId?: string;
  lastStatus: DistillLastStatus;
  lastMessage?: string;
  lastWritten?: number;
};
```

`config.ts` 的 `openviking` 对象增加 `autoDistill: z.boolean().default(true)`。

`api.ts`：`export type { DistillStatusView, DistillLastStatus } from "./memory-item.js";` 或再导出一遍同名 type（二选一，**只从 memory-item 单源导出**）。

`index.ts` 导出 MemoryItem、DistillStatusView、schemas。

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @agent2026/shared test`  
Expected: PASS

- [ ] **Step 5: Commit**

```
git add packages/shared
git commit -m "feat(shared): memory item schema and autoDistill config"
```

---

### Task 2: 校验 + prompt 解析

**Files:**
- Create: `packages/server/src/memory/constants.ts`
- Create: `packages/server/src/memory/validate.ts`
- Create: `packages/server/src/memory/validate.test.ts`
- Create: `packages/server/src/memory/distill-prompt.ts`
- Create: `packages/server/src/memory/distill-prompt.test.ts`

**Interfaces:**
- Consumes: `DistillDraftItem`、`MemoryItem` from shared
- Produces:
  - `normalizeDoFingerprint(do: string): string`
  - `looksLikeSecret(text: string): boolean`
  - `evaluateDraft(draft, ctx): { ok: true, item: MemoryItem } | { ok: false, reason: string }`
  - `trimDistillMessages(messages): { role, content }[]`（无 system；单条 2000；总计 12000）
  - `buildDistillPrompt(job): AgentMessage[]`（system + user，user 含 JSON 轨迹）
  - `parseDistillModelText(text): DistillDraftItem[]`（剥 \`\`\`json；最多 5 条；失败 throw）

`evaluateDraft` ctx：`{ sourceRunId, sourceSessionId, sourceTraceId?, acceptedDoFingerprints: Set<string> }`。通过则 `status: "frozen"`。

密钥正则至少：`/\bsk-[A-Za-z0-9]{8,}\b/i`、`/api[_-]?key\s*=/i`。

- [ ] **Step 1: 写失败测试**

`validate.test.ts`：空 when 失败；do 长度 < 8 失败；confidence 0.49 失败；指纹重复失败；`sk-` 失败；合法 draft → frozen item。

`distill-prompt.test.ts`：剥围栏 JSON；items>5 slice；非法 JSON throw；system 消息被丢掉；超长截断。

- [ ] **Step 2: Run 确认失败**

Run: `pnpm --filter @agent2026/server test -- src/memory/validate.test.ts src/memory/distill-prompt.test.ts`  
Expected: FAIL

- [ ] **Step 3: 实现 constants / validate / distill-prompt**

Prompt 要点写死（规格 §5.2）：只抽跨会话偏好/约定/教训；不要闲聊/密钥/大段代码；只输出 JSON `{ items: [...] }`。

- [ ] **Step 4: 测试通过 + Commit**

```
git add packages/server/src/memory
git commit -m "feat(server): distill prompt parsing and memory item validation"
```

---

### Task 3: OpenViking 白名单写入

**Files:**
- Create: `packages/server/src/memory/write-openviking.ts`
- Create: `packages/server/src/memory/write-openviking.test.ts`

**Interfaces:**
- Consumes: `ToolPort` from core；`MemoryItem`；`OPENVIKING_SERVER_NAME` from `packages/server/src/openviking/constants.ts`
- Produces:
  - `memoryItemToMarkdown(item: MemoryItem): string` — YAML front matter（kind/status/confidence/sourceRunId/sourceSessionId/sourceTraceId）+ `when`/`do`/`outcome` 正文
  - `memoryWriteUri(runId: string, index: number, now?: Date): string`
  - `writeFrozenMemory(input): Promise<{ ok: boolean; via: "write" | "remember"; error?: string }>`

```ts
export type WriteFrozenMemoryInput = {
  port: ToolPort;
  item: MemoryItem;
  index: number;
  ctx: { sessionId: string; runId: string };
};
```

**白名单：** `execute` 只许 `openviking__write` 与 `openviking__remember`。先 write：

```ts
{
  uri: memoryWriteUri(runId, index),
  content: markdown,
  mode: "replace",
}
```

write throw 或返回明显错误字符串（实现：catch 即失败）→ remember：

```ts
{ messages: [{ role: "user", content: markdown }] }
```

再失败 → `{ ok: false, error }`。

- [ ] **Step 1: 测试**

- write 成功：只调 write，uri 含 `viking://~/memories/agent2026/` 与 runId。  
- write throw：再调 remember。  
- 两者都失败：ok false。  
- mock port 若被叫到其它 name → 测试失败（实现不得调用）。

- [ ] **Step 2–4: 实现、跑通、commit**

```
git add packages/server/src/memory/write-openviking.ts packages/server/src/memory/write-openviking.test.ts
git commit -m "feat(server): write frozen memories via OpenViking MCP whitelist"
```

---

### Task 4: `MemoryConsolidator`

**Files:**
- Create: `packages/server/src/memory/consolidator.ts`
- Create: `packages/server/src/memory/consolidator.test.ts`

**Interfaces:**
- Consumes: Task 2–3；`AppConfig`；`OpenVikingStatusView`；`ModelPort`
- Produces: `createMemoryConsolidator(deps): MemoryConsolidator`

```ts
export type DistillJob = {
  runId: string;
  sessionId: string;
  traceId: string;
  messages: Array<{ role: string; content: string }>;
  toolSummaries?: Array<{ name: string; ok: boolean; snippet?: string }>;
};

export type MemoryConsolidatorDeps = {
  getConfig: () => AppConfig;
  getOpenVikingStatus: () => { status: string; enabled: boolean };
  getOpenVikingPort: () => ToolPort | undefined;
  getModel: () => ModelPort;
};

export type MemoryConsolidator = {
  enqueue(job: DistillJob): void;
  getLastResult(): DistillStatusView;
  shutdown(): Promise<void>;
};
```

`getLastResult()` 初始 `{ enabled: false, lastStatus: "idle" }`（enabled 按当前门控计算：`ov.enabled && ov.status==="ready" && autoDistill!==false`）。

**算法：** 规格 §3.2。`enqueue` 同步入队后 `void pump()`。`pending` 计数：已排队未开始 + 进行中；若 `pending >= DISTILL_QUEUE_MAX` **且** 当前又来一个 → **不入队**，设 `skipped` + `lastMessage=skipped_busy`。

LLM：`AbortSignal.timeout(DISTILL_TIMEOUT_MS)` + `model.stream({ messages: buildDistillPrompt(job), tools: [] })` 拼接所有 `text_delta`。

进程内 `doFingerprints: string[]` 最多 50；写入成功后 push `normalizeDoFingerprint(item.do)`。

`shutdown`：设 flag 不再泵新 job；等待当前 job（最多 5s）后清空队列。

- [ ] **Step 1: 测试矩阵（全 mock）**

| 用例 | 期望 |
|------|------|
| autoDistill false | 不调 model / port |
| OV not ready | skipped 或直接 return；lastStatus skipped |
| OV disabled | 同上 |
| mock JSON 一条合法 | write 被调用；lastStatus ok；lastWritten 1 |
| 坏 JSON | error；不 write |
| 低 confidence | ok，written 0 |
| enqueue 立即返回（model hang + 短 await 0） | enqueue 在 hang 前返回 |
| 队列满 | 第 4 个 skipped_busy |
| model throw | error，不冒泡到 enqueue 调用方 |

测 hang：`enqueue` 后 `await Promise.resolve()`，`getLastResult().lastStatus` 可为 `running` 或仍 idle（若 pump 微任务未进）；用 deferred Promise 卡住 stream，断言 enqueue 调用栈已结束。

- [ ] **Step 2–4: 实现、跑通、commit**

```
git add packages/server/src/memory/consolidator.ts packages/server/src/memory/consolidator.test.ts
git commit -m "feat(server): MemoryConsolidator serial distill queue"
```

---

### Task 5: 挂 `runs.ts` + status 路由 + app shutdown

**Files:**
- Create: `packages/server/src/routes/memory.ts`
- Create: `packages/server/src/routes/memory.test.ts`
- Modify: `packages/server/src/routes/runs.ts`
- Modify: `packages/server/src/routes/runs.test.ts`（或新 `runs-distill.test.ts`）
- Modify: `packages/server/src/app.ts`

**Interfaces:**
- `GET /memory/distill/status` → `consolidator.getLastResult()` 并把 `enabled` 用当前门控刷新（或 consolidator 每次 get 时现算 enabled）。  
- `RunRouteDeps.memory?: MemoryConsolidator`  
- `createApp` 默认 `createMemoryConsolidator`：`getModel` 用与 runs 相同的 `assembleRuntime(...).model` **或** 注入的 `options.model`；`getOpenVikingPort` = `mcp.getPort("openviking")`；`getOpenVikingStatus` = `openViking.getStatus()`。  
- `onClose`：`await memory.shutdown()`（可在 mcp/ov shutdown 前后，不阻塞过久）。

**runs 接线（写死位置）：** 在 `appendMessagesBatch` 成功之后、`pendingEnd` 发给客户端之后：

```ts
if (pendingEnd?.reason === "completed" && deps.memory) {
  try {
    const newMessages = result.messages.slice(skip);
    deps.memory.enqueue({
      runId,
      sessionId: request.sessionId,
      traceId,
      messages: newMessages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    });
  } catch (err) {
    console.warn("[memory] enqueue failed:", err instanceof Error ? err.message : err);
  }
}
```

检查 `AgentMessage.content` 实际类型（core `messages.ts`）：若已是 string，直接用。tool 消息一并纳入 messages（规格允许）。

error/stop 路径 **不得** enqueue。

- [ ] **Step 1: 路由测试** — inject GET，mock consolidator 返回固定 DistillStatusView。  

- [ ] **Step 2: runs 集成** — 仿 `runs.test.ts` 造 completed mock model（无 tool call 只回文本）；注入 memory mock，`enqueue` 被调一次。再测 stop/error 不被调。测试须 `skipOpenVikingReconcile` / `skipMcpReconcile`。  

- [ ] **Step 3: 接线 app.ts**  

- [ ] **Step 4: `pnpm --filter @agent2026/server test` PASS**  

- [ ] **Step 5: Commit**

```
git add packages/server/src/app.ts packages/server/src/routes
git commit -m "feat(server): enqueue memory distill after completed runs"
```

---

### Task 6: Desktop 子开关 + 学习短记

**Files:**
- Modify: `apps/desktop/src/lib/api.ts` — `fetchDistillStatus(baseUrl)`
- Modify: `apps/desktop/src/stores/settings-store.ts` — `distillStatus`；`setAutoDistill(baseUrl, enabled)`（**必须**把 `autoDistill: false` 写进 `openviking` 块，不得因无模型覆盖而删掉整个 openviking）
- Modify: `apps/desktop/src/components/settings/memory-settings-panel.tsx`
- Create: `docs/learning/P3-MEMORY-DISTILL.md`

**UI 文案（写死）：**

- 开关：`run 结束后自动提炼`  
- 副文案：`将本轮对话要点写入 OpenViking（需服务就绪）`  
- OV 非 ready：`当前未生效：OpenViking 未就绪`  
- 只读：上次 `lastStatus` / `lastWritten` / `lastMessage`（`hydrate` 时并行 GET `/memory/distill/status`）

放在「启用 OpenViking」开关行与状态行之间。

**注意：** 现有 `saveOpenVikingOverrides` 在无 embedding/vlm 时把 `openviking` 设为 `undefined`，会丢掉 `autoDistill: false`。`setAutoDistill` 用独立 PUT：保留 embedding/vlm，并显式写 `autoDistill`。必要时修 overrides 保存，使已有 `autoDistill` 不被擦掉。

- [ ] **Step 1–2: api + store + 面板**  

- [ ] **Step 3: 学习短记** — 规格 §9.2 三条冒烟；链本规格与 OV README。  

- [ ] **Step 4: `pnpm --filter @agent2026/desktop test` 与 server 回归**  

- [ ] **Step 5: Commit**

```
git add apps/desktop docs/learning/P3-MEMORY-DISTILL.md
git commit -m "feat(desktop): auto-distill toggle and distill status"
```

---

## Spec coverage

| 规格 | Task |
|------|------|
| autoDistill + MemoryItem | 1 |
| 校验 / prompt / JSON | 2 |
| MCP write→remember 白名单 | 3 |
| 队列 / 门控 / LLM | 4 |
| run completed 接线 + GET status | 5 |
| 设置 UI + 冒烟文档 | 6 |
| MemoryPort / recall / 探索 | 不做 |

## 执行断点

- Task 4 后：consolidator 单测必须绿再接线。  
- Task 5 后：可用 curl GET status。  
- Task 6 后：本机 OV 冒烟（可选）。

---

## 执行方式

Plan 已保存到 `docs/superpowers/plans/2026-09-27-memory-distill.md`。

**1. Subagent-Driven（推荐）** — 每任务新开子代理，任务间审查  
**2. Inline Execution** — 本会话按 executing-plans 连续做  

选哪个？
