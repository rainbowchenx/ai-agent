# Agent Runtime P0 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可运行的本地 Agent Runtime：自研 ReAct loop + OpenAI 兼容 Provider + 内置工具 + Fastify Server + Electron 占位工作台（流式对话、工具卡片、SQLite 会话）。

**Architecture:** Electron 壳只负责 UI 与拉起本机 Fastify Server；`packages/core` 持有 Runner/Port；`providers` 实现 ModelPort；builtin tools 挂 ToolPort；`shared` 冻结 HTTP/WS 契约。严格 Ports & Adapters，route 内禁止写 Agent loop。

**Tech Stack:** pnpm workspace · Turborepo · TypeScript · Vitest · Fastify + `@fastify/websocket` · better-sqlite3 · Electron + electron-vite · React 19 · shadcn/ui + Tailwind · Zod · yaml

**Spec:** `docs/superpowers/specs/2026-09-05-agent-runtime-design.md`

## Global Constraints

- 不依赖 Vercel AI SDK / Mastra / OpenAI Agents SDK 作为 runtime
- 密钥只经环境变量 / keychain 引用，禁止明文写入可提交配置
- Renderer 进程禁止调用模型或执行工具
- MCP / Python Sidecar / Anthropic / A2A 实装：**本计划（P0）不做**，只预留类型或空目录说明
- 包名统一 scope：`@agent2026/*`
- 每完成一个 Task：更新该 Task 的 `docs/learning/P0-Txx.md` 断点笔记，再进入下一 Task

---

## 如何使用本计划（学习方法）

每个 Task 都有固定三块，请按顺序做，**不要跳断点**：

| 块 | 含义 |
|----|------|
| **学习目标** | 这一步你在 Agent 体系里学的概念 |
| **断点 Checkpoint** | 必须亲手验证通过才能继续；附「自问三题」 |
| **临时说明** | 写入 `docs/learning/P0-Txx.md` 的短笔记模板（给未来的你） |

**建议节奏：** 一天最多 1～2 个 Task。断点过不去就停，先画数据流再改代码。

**推荐执行方式：** 选下面「执行选项」之一；无论哪种，**每个 Task 结束后停下来让你过断点**。

---

## 文件地图（P0 将创建）

```text
agent2026/
  package.json                 # pnpm workspace root
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  docs/
    learning/                  # 每 Task 断点笔记（实现时创建）
    superpowers/specs/...
    superpowers/plans/...
  packages/
    shared/                    # DTO、WS 事件、配置 Zod
    core/                      # ports、Runner、权限骨架、builtin tools
    providers/                 # OpenAI 兼容 ModelPort
    server/                    # Fastify + SQLite + 装配
    mcp/                       # P0: README only（占位）
    sidecar-python/            # P0: README only（占位）
  apps/
    desktop/                   # Electron + React 占位 UI
```

---

## Task 1: 仓库初始化与 Monorepo 骨架

**学习目标：** 理解「壳 / Server / core 分包」为什么在第一天就要拆开——对应 OpenCode 的 client-server 思想，避免以后 Electron 和业务缠死。

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `README.md`
- Create: `packages/shared/package.json`, `packages/core/package.json`, `packages/providers/package.json`, `packages/server/package.json`, `apps/desktop/package.json`（可先空壳）
- Create: `packages/mcp/README.md`, `packages/sidecar-python/README.md`（仅说明 P2/P3 再用）

**Interfaces:**
- Consumes: 无
- Produces: workspace 可 `pnpm install`；包名 `@agent2026/shared|core|providers|server`

- [ ] **Step 1: `git init` 并写 `.gitignore`**

```gitignore
node_modules/
dist/
.turbo/
*.log
.env
.env.*
!.env.example
~/.agent2026/
.DS_Store
Thumbs.db
*.sqlite
coverage/
out/
release/
```

- [ ] **Step 2: 写根 `package.json` 与 `pnpm-workspace.yaml`**

```json
{
  "name": "agent2026",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "test": "turbo run test",
    "dev:server": "pnpm --filter @agent2026/server dev",
    "dev:desktop": "pnpm --filter @agent2026/desktop dev"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^5.8.0"
  }
}
```

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 3: 写 `tsconfig.base.json` 与最小各包 `package.json`（`private: true`, `"type": "module"`）**

- [ ] **Step 4: 安装并验证**

Run: `pnpm install`
Expected: 成功，无 ERR_PNPM

- [ ] **Step 5: 写根 `README.md` 一句话：本仓库是 Agent Runtime + Electron 工作台；学习笔记在 `docs/learning/`**

- [ ] **Step 6: 断点笔记 + Commit**

Create: `docs/learning/P0-T01.md`（用下方临时说明模板填空）

```bash
git add .
git commit -m "chore: init pnpm monorepo workspace skeleton"
```

### 断点 Checkpoint — Task 1

- [ ] `pnpm -r list` 能看到 `@agent2026/*` 包名  
- [ ] 自问：为什么 Server 不能进 `apps/desktop`？用一句话写进 `P0-T01.md`  
- [ ] 自问：`packages/mcp` 现在为什么只有 README？  

**临时说明模板（`docs/learning/P0-T01.md`）：**

```markdown
# P0-T01 断点笔记
日期：
我理解的分包理由：
还不懂的点：
下一步将做：shared 契约
```

---

## Task 2: `@agent2026/shared` — 配置与事件契约

**学习目标：** 「契约先行」——UI 与 Server 只通过 DTO/事件说话；这是你后续换 UI 不改内核的关键。

**Files:**
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/events.ts`
- Create: `packages/shared/src/config.ts`
- Create: `packages/shared/src/api.ts`
- Create: `packages/shared/package.json`（补全 exports）
- Test: `packages/shared/src/config.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `AppConfig`（Zod infer）
  - `RunEvent` 联合类型：`run_start | message_delta | tool_start | tool_end | permission_request | error | run_end`
  - `CreateSessionResponse`, `PostMessageRequest` 等 API 类型

- [ ] **Step 1: 安装依赖**

Run: `pnpm --filter @agent2026/shared add zod yaml`  
Run: `pnpm --filter @agent2026/shared add -D vitest`

- [ ] **Step 2: 写失败测试 — 非法配置应被拒绝**

```ts
// packages/shared/src/config.test.ts
import { describe, expect, it } from "vitest";
import { parseAppConfig } from "./config.js";

describe("parseAppConfig", () => {
  it("rejects missing providers.entries", () => {
    expect(() =>
      parseAppConfig({
        providers: { default: "openai", entries: {} },
        agents: {
          default: {
            model: "openai/gpt-4.1",
            systemPrompt: "hi",
            tools: { builtin: [], mcpServers: [], sidecars: [] },
          },
        },
        permissions: { mode: "default", allowlist: [] },
        a2a: { enabled: false },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run test — 应 FAIL（模块不存在）**

Run: `pnpm --filter @agent2026/shared exec vitest run`
Expected: FAIL cannot find module / parseAppConfig

- [ ] **Step 4: 实现 `config.ts` / `events.ts` / `api.ts`**

`config.ts` 需覆盖 spec 中的 YAML 形状（P0 至少：`openai_compatible` provider、builtin 工具列表、permissions.mode）。  
`events.ts` 示例：

```ts
export type RunEvent =
  | { type: "run_start"; runId: string; sessionId: string; traceId: string }
  | { type: "message_delta"; runId: string; delta: string }
  | {
      type: "tool_start";
      runId: string;
      toolCallId: string;
      name: string;
      arguments: unknown;
    }
  | {
      type: "tool_end";
      runId: string;
      toolCallId: string;
      name: string;
      result: string;
      isError?: boolean;
    }
  | {
      type: "permission_request";
      runId: string;
      requestId: string;
      toolName: string;
      arguments: unknown;
    }
  | { type: "error"; runId: string; message: string }
  | { type: "run_end"; runId: string; reason: "completed" | "stopped" | "error" };
```

`defaultAppConfig()` 返回一份可本地跑的默认配置（`baseUrl` 可读环境变量，apiKey 只用 `apiKeyEnv` 字段名）。

- [ ] **Step 5: 改测试为「合法默认配置可解析」+ 保留非法用例；跑通**

- [ ] **Step 6: 断点笔记 + Commit**

```bash
git add packages/shared docs/learning
git commit -m "feat(shared): add config zod schemas and run event types"
```

### 断点 Checkpoint — Task 2

- [ ] 打开 `events.ts`，用自己的话解释每个事件谁发、谁收  
- [ ] 自问：为什么 `permission_request` 要有 `requestId`？  
- [ ] 在 `P0-T02.md` 画一张「UI ←WS— Server」箭头草图（文字版即可）  

**临时说明：** 契约一旦被 desktop 引用，**改字段必须涨版本或同步改两端**；P0 期间改契约先改 shared 测试。

---

## Task 3: `@agent2026/core` — 消息类型与 Ports

**学习目标：** Ports & Adapters——`ModelPort` / `ToolPort` 是「洞」，Provider/MCP/Sidecar 是「插头」。先定洞，再写插头。

**Files:**
- Create: `packages/core/src/types/messages.ts`
- Create: `packages/core/src/ports/model-port.ts`
- Create: `packages/core/src/ports/tool-port.ts`
- Create: `packages/core/src/ports/session-store.ts`
- Create: `packages/core/src/ports/trace-port.ts`
- Create: `packages/core/src/ports/agent-peer-port.ts`（stub 接口 + 注释「P4」）
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/ports/ports.types.test.ts`（编译期/形状断言即可）

**Interfaces:**
- Consumes: 无（core 不依赖 shared，避免 UI DTO 污染内核；映射放 server）
- Produces:
  - `AgentMessage`, `ToolDefinition`, `ToolCall`
  - `ModelPort.stream(req): AsyncIterable<ModelStreamEvent>`
  - `ToolPort.list(): ToolDefinition[]` / `execute(name, args, ctx): Promise<string>`
  - `SessionStore`, `TracePort`, `AgentPeerPort`（stub）

- [ ] **Step 1: 定义消息与 Port 接口（完整写出 `ModelPort`）**

```ts
export type ModelStreamEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | { type: "usage"; inputTokens?: number; outputTokens?: number };

export interface ModelPort {
  id: string;
  stream(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
    signal?: AbortSignal;
  }): AsyncIterable<ModelStreamEvent>;
}
```

- [ ] **Step 2: 写 Vitest：用假对象满足 `ModelPort` 形状并能被 `for await` 消费**

- [ ] **Step 3: `AgentPeerPort` 仅空接口 + JSDoc「未实现，P4」**

- [ ] **Step 4: 断点笔记 + Commit**

```bash
git commit -m "feat(core): define message types and ports"
```

### 断点 Checkpoint — Task 3

- [ ] 不看代码，默写 `ModelPort.stream` 返回的三种事件  
- [ ] 自问：为什么 core 不直接 import OpenAI SDK？  
- [ ] 自问：Tool 结果为什么是 `string` 回给模型而不是任意 JSON？（可写进笔记：多数 Chat API 的 tool role content 是文本）  

**临时说明：** 若纠结 Anthropic 与 OpenAI 消息格式差异——**先统一成内部 `AgentMessage`，差异关在 providers 包**。

---

## Task 4: `@agent2026/core` — Runner（Mock Model 驱动）

**学习目标：** ReAct 循环是 Agent 的心脏：模型 →（可选）工具 → 再模型。先用 Mock 把循环跑对，再接真 API。

**Files:**
- Create: `packages/core/src/runner/runner.ts`
- Create: `packages/core/src/runner/types.ts`
- Create: `packages/core/src/tools/registry.ts`
- Create: `packages/core/src/permissions/permission-gate.ts`
- Test: `packages/core/src/runner/runner.test.ts`

**Interfaces:**
- Consumes: `ModelPort`, `ToolPort`（用内存 `ToolRegistry` 实现）
- Produces: `Runner.run({ sessionMessages, userMessage, model, tools, onEvent, signal })`

- [ ] **Step 1: 写失败测试 — 纯文本回复应发出 text 并结束**

```ts
it("streams text-only completion", async () => {
  const events: string[] = [];
  const model: ModelPort = {
    id: "mock",
    async *stream() {
      yield { type: "text_delta", text: "hello" };
    },
  };
  const runner = new Runner({ maxTurns: 4 });
  await runner.run({
    messages: [],
    userMessage: { role: "user", content: "hi" },
    model,
    tools: emptyToolPort(),
    permissions: { mode: "default", allowlist: [] },
    onEvent: (e) => events.push(e.type),
  });
  expect(events).toContain("run_start");
  expect(events).toContain("message_delta");
  expect(events[events.length - 1]).toBe("run_end");
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: 最小 Runner 实现（尚无工具分支）**

- [ ] **Step 4: 第二测试 — Mock 先 tool_call 再文本；`ToolRegistry` 注册 `echo`；断言 `tool_start`/`tool_end` 与最终文本**

- [ ] **Step 5: 实现工具分支 + `maxTurns` 上限**

- [ ] **Step 6: 第三测试 — `AbortSignal` 中止后 `run_end.reason === "stopped"`**

- [ ] **Step 7: 权限闸门骨架：`ask_all` 时通过 `onPermissionRequest` Promise 等待；测试用立即 resolve allow**

- [ ] **Step 8: 全绿后断点笔记 + Commit**

```bash
git commit -m "feat(core): implement ReAct runner with mock model tests"
```

### 断点 Checkpoint — Task 4（最重要）

- [ ] 在纸上画出：一次 tool_call 时 messages 数组如何增长（user → assistant(tool_calls) → tool → assistant）  
- [ ] 跑测试时在 Runner 里临时 `console.log(messages.length)`，看懂再删  
- [ ] 自问：若工具抛错，应崩溃 run 还是把错误字符串当 tool result？（答案：后者，见 spec）  
- [ ] **停！** 若画不出 messages 增长，禁止开始 Task 5  

**临时说明（必须写入 `P0-T04.md`）：**

```markdown
## 我亲手追过的一次 run
turn0: ...
tool: ...
turn1: ...
Abort 时发生了什么: ...
```

---

## Task 5: Builtin Tools — `http_fetch` 与 `read_file`

**学习目标：** 内置工具是「最小能力地板」；MCP 只是另一来源的 ToolDefinition，对 Runner 无差别。

**Files:**
- Create: `packages/core/src/tools/builtin/http-fetch.ts`
- Create: `packages/core/src/tools/builtin/read-file.ts`
- Create: `packages/core/src/tools/builtin/index.ts`
- Test: `packages/core/src/tools/builtin/builtin.test.ts`

**Interfaces:**
- Consumes: `ToolRegistry`
- Produces: `createBuiltinToolPort(names: ("http_fetch"|"read_file")[], options)`

- [ ] **Step 1: 测试 `read_file` 读取临时文件内容**

- [ ] **Step 2: 实现 `read_file`（限制在 `options.workspaceRoot` 下，防路径穿越）**

- [ ] **Step 3: 测试 `http_fetch`（可用 mock `fetch` 或只允许测参数校验；真实网络测标记为可选）**

- [ ] **Step 4: `http_fetch` 实现：仅 http/https；超时；响应体截断到 N 字符**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add read_file and http_fetch builtin tools"
```

### 断点 Checkpoint — Task 5

- [ ] 故意传入 `../` 路径，确认被拒绝  
- [ ] 自问：为什么工具白名单在 config 的 `agents.default.tools.builtin`？  
- [ ] 笔记：工具 schema（JSON Schema）如何变成模型可调用的 function  

---

## Task 6: `@agent2026/providers` — OpenAI 兼容 Provider

**学习目标：** 把厂方 SSE/JSON 差分隔在适配器内；内部永远是 `ModelStreamEvent`。

**Files:**
- Create: `packages/providers/src/openai-compatible.ts`
- Create: `packages/providers/src/index.ts`
- Test: `packages/providers/src/openai-compatible.test.ts`（用 `http` mock server 或 undici MockAgent）

**Interfaces:**
- Consumes: `ModelPort`, `AgentMessage`, `ToolDefinition`
- Produces: `createOpenAICompatibleModel(opts: { id, baseUrl, apiKey, model }): ModelPort`

- [ ] **Step 1: 写 Mock HTTP 服务器，返回一小段 SSE `chat.completions` 流（含 content delta）**

- [ ] **Step 2: 测试消费后得到 `text_delta`**

- [ ] **Step 3: 实现适配器（`fetch` + 解析 SSE）**

- [ ] **Step 4: 第二测试 — SSE 中带 `tool_calls` 片段，聚合为完整 `tool_call` 事件**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(providers): add OpenAI-compatible model port"
```

### 断点 Checkpoint — Task 6

- [ ] 用真实 key（本地）对任意兼容 endpoint 跑一个 5 行脚本 `scripts/smoke-provider.ts`（可本 Task 末尾加），成功打印一段文本  
- [ ] 自问：`baseUrl` 为什么常要带 `/v1`？  
- [ ] 笔记：tool_calls 流式是「分片到达」还是「一次性」——你的聚合策略是什么  

**临时说明：** 各家网关对 tool_calls 流式行为不一致；P0 以 OpenAI 官方形态为准，差异记在 `docs/learning/P0-T06.md`，不要立刻抽象「万能解析器」。

---

## Task 7: SQLite SessionStore + TracePort

**学习目标：** Session/Trace 是 harness 记忆；重启可恢复是「成品感」来源。

**Files:**
- Create: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/db/sqlite.ts`
- Create: `packages/server/src/store/sqlite-session-store.ts`
- Create: `packages/server/src/store/sqlite-trace-port.ts`
- Test: `packages/server/src/store/sqlite-session-store.test.ts`

**Interfaces:**
- Consumes: `SessionStore`, `TracePort`（core ports）
- Produces: 实现类；默认路径 `~/.agent2026/data.sqlite`（测试用 temp 目录）

- [ ] **Step 1: 表结构：`sessions`, `messages`, `traces`, `spans`**

- [ ] **Step 2: 测试 create session → append messages → reload**

- [ ] **Step 3: 实现**

- [ ] **Step 4: Trace：`startTrace` / `startSpan` / `endSpan` 测试**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): sqlite session and trace persistence"
```

### 断点 Checkpoint — Task 7

- [ ] 用 DB Browser 或 `sqlite3` 打开测试库，看清行内容  
- [ ] 自问：消息存在 Server 还是 Electron？为什么？  
- [ ] 笔记：`traceId` 与 `runId` / `sessionId` 的关系  

---

## Task 8: Fastify Server — 健康检查、配置、会话 API

**学习目标：** Server 是「装配根」：读配置 → 创建 Model/Tools → 注入 Runner；HTTP 只是门面。

**Files:**
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/routes/health.ts`
- Create: `packages/server/src/routes/config.ts`
- Create: `packages/server/src/routes/sessions.ts`
- Create: `packages/server/src/config/load-config.ts`
- Create: `packages/server/src/index.ts`
- Create: `.env.example`（根目录：`OPENAI_API_KEY=`, `OPENAI_BASE_URL=`）
- Test: `packages/server/src/app.test.ts`（`app.inject`）

**Interfaces:**
- Consumes: shared `AppConfig`, core `Runner`, providers, sqlite stores
- Produces:
  - `GET /health` → `{ ok: true, version }`
  - `GET/PUT /config`
  - `POST /sessions` → `{ id }`
  - `GET /sessions`, `GET /sessions/:id`

- [ ] **Step 1: Fastify app + `/health` 测试**

- [ ] **Step 2: 配置加载：`~/.agent2026/config.yaml`，无则写 `defaultAppConfig`**

- [ ] **Step 3: sessions CRUD + 测试**

- [ ] **Step 4: `pnpm --filter @agent2026/server dev` 可启动监听 `127.0.0.1:8787`**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): fastify health config and sessions api"
```

### 断点 Checkpoint — Task 8

- [ ] curl `http://127.0.0.1:8787/health` 成功  
- [ ] 自问：为什么绑定 `127.0.0.1` 而不是 `0.0.0.0`？（本机 Agent，减少暴露面）  
- [ ] 笔记：装配顺序（config → db → model → tools → routes）  

---

## Task 9: WebSocket Run 流式 + 停止

**学习目标：** Agent UX 的核心是事件流；停止 = AbortSignal。权限事件可先留接口，P0 默认 auto-allow 只读工具。

**Files:**
- Create: `packages/server/src/routes/runs.ts`
- Create: `packages/server/src/ws/run-hub.ts`
- Create: `packages/server/src/assemble/runtime.ts`（从 config 装配 Runner 依赖）
- Modify: `packages/server/src/app.ts`（注册 `@fastify/websocket`）
- Test: WS 集成测试（或脚本 `scripts/smoke-run.ts`）

**Interfaces:**
- Consumes: `Runner`, shared `RunEvent`
- Produces:
  - `WS /ws` 消息：`{ type: "run", sessionId, content }` 开始跑
  - `WS` 下行：shared `RunEvent`
  - `POST /runs/:runId/stop`
  - `POST /sessions/:id/messages` 可选 REST 触发（若更易测可先 REST+SSE，但 spec 定 WS——以 WS 为准）

- [ ] **Step 1: 装配 `runtime.ts`：读 apiKeyEnv → `process.env` → `createOpenAICompatibleModel` + builtin tools**

- [ ] **Step 2: WS handler：把 core runner 事件 map 成 shared `RunEvent` 发出**

- [ ] **Step 3: stop：保存 `AbortController` 到 Map**

- [ ] **Step 4: 手工 smoke：配置真实 key，发一条「用 read_file 读某文件」或纯聊天**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): websocket run streaming and stop"
```

### 断点 Checkpoint — Task 9

- [ ] 用 websocat / 小脚本看 `message_delta` 逐条到达  
- [ ] 中途 stop，确认不再继续 tool  
- [ ] 自问：map 事件时哪些字段绝对不能丢（`runId`, `toolCallId`）  
- [ ] **停！** 没有至少一次真模型成功 run，不要开始 Electron  

**临时说明：** 若公司网关不是严格 OpenAI SSE，把原始响应片段贴进 `P0-T09.md`，下一迭代再修解析。

---

## Task 10: Electron 壳 — 拉起/守护 Server

**学习目标：** 桌面端是「宿主」：管进程生命周期，不管智能。

**Files:**
- Create: `apps/desktop/`（electron-vite React-TS 模板结构）
- Create: `apps/desktop/electron/main/index.ts`（spawn server）
- Create: `apps/desktop/electron/main/server-manager.ts`
- Create: `apps/desktop/electron/preload/index.ts`
- Modify: root scripts

**Interfaces:**
- Consumes: Server 监听端口；健康检查
- Produces: preload API `getServerBaseUrl()`；窗口加载 renderer

- [ ] **Step 1: scaffold electron-vite + React**

- [ ] **Step 2: `ServerManager`：开发模式可连已有 `8787`；生产模式 spawn `node .../server/dist`**

- [ ] **Step 3: 端口写入 `userData/server.json`**

- [ ] **Step 4: 退出时 kill 子进程**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(desktop): electron shell spawns local agent server"
```

### 断点 Checkpoint — Task 10

- [ ] 只开 Electron、不开手动 server 时，健康检查仍成功（或文档写明 dev 双启方式）  
- [ ] 自问：为什么 preload 要隔离，而不是在 renderer 里 `child_process`？  
- [ ] 笔记：dev 与 prod 启动路径差异  

---

## Task 11: 占位工作台 UI（shadcn）— 对话 / 工具卡 / 停止

**学习目标：** UI 只是事件投影；你后续换皮时，只要还消费 `RunEvent`，内核不动。

**Files:**
- Create: `apps/desktop/src/App.tsx` 等布局
- Create: `apps/desktop/src/lib/ws-client.ts`
- Create: `apps/desktop/src/components/chat/*`
- Create: shadcn primitives：`button`, `input`, `scroll-area`, `dialog`, `sheet`
- Create: `apps/desktop/src/stores/session-store.ts`（Zustand）

**Interfaces:**
- Consumes: shared 类型；`GET /sessions`, WS run
- Produces: 可演示的三区占位布局（列表 / 对话 / 简易 trace 文本）

- [ ] **Step 1: 初始化 Tailwind + shadcn（组件拷贝进仓）**

- [ ] **Step 2: 会话列表 + 新建**

- [ ] **Step 3: 输入框发送 → WS → 流式气泡**

- [ ] **Step 4: `tool_start/end` → 可展开卡片**

- [ ] **Step 5: 停止按钮 → `POST /runs/:id/stop`**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(desktop): placeholder workbench chat with tool cards"
```

### 断点 Checkpoint — Task 11

- [ ] 完成一次：聊天 + 触发 `read_file` 或模型自发 tool（若模型不调工具，可在设置里用固定 demo 按钮调 `POST` 测试工具事件——可选）  
- [ ] 重启 App，会话还在  
- [ ] 自问：换 UI 时哪些文件应保持不动？（`packages/*`）  
- [ ] 在 `P0-T11.md` 列出你准备交给设计师的「必须保留的 DOM/数据绑定点」  

**临时说明：** 视觉以占位为荣；**禁止**本阶段精调主题色浪费时间。

---

## Task 12: P0 验收、学习总复习、占位包收尾

**学习目标：** 对照 spec 成功标准做「发布前清单」；把学习路径收束成一张地图。

**Files:**
- Create: `docs/learning/P0-REVIEW.md`
- Create: `docs/learning/MAP.md`（概念地图：Port / Runner / Event / Session）
- Modify: `README.md`（如何跑 P0）
- Modify: spec 状态 → `P0 已实现`（若通过）

- [ ] **Step 1: 按 spec §7.1 逐条打勾**

- [ ] **Step 2: 填写 `P0-REVIEW.md`：每条标准的证据（截图路径或命令）**

- [ ] **Step 3: 写 `MAP.md`：从用户按回车到 tool_end 的调用链文件列表**

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: P0 acceptance notes and learning map"
```

### 断点 Checkpoint — Task 12（P0 毕业）

- [ ] 五条成功标准全过  
- [ ] 能向他人 5 分钟讲清架构图  
- [ ] 决定是否进入 P1（第二 Provider + 配置 UI + Trace 面板）  

---

## P1–P4 路线图（本文件只定学习断点；开工前另写详细 plan）

| 阶段 | 做什么 | 学习断点（过关题） |
|------|--------|-------------------|
| **P1** | Anthropic Provider；配置 UI；Trace 面板打磨 | 能否不改 Runner 只加 Provider 文件？配置热加载失败是否回滚？ |
| **P2** | MCP Client 多 server；`server__tool` 命名；`ask_all` 真 UI | 能否说明 MCP 与内置工具对 Runner 为何无感？权限为何在 Hooks 前？ |
| **P3** | Python Sidecar JSON-RPC stdio；Hooks 实装 | 能否画清 Supervisor 生命周期？与 MCP stdio 同构点在哪？ |
| **P4** | `AgentPeerPort` stub + 示例文档；可选 CLI | 能否讲清 MCP vs A2A 分层？ |

每个阶段开始时：新建 `docs/superpowers/plans/YYYY-MM-DD-pN-....md`，沿用本文件的「学习目标 / 断点 / 临时说明」模板。

---

## Spec 覆盖自检

| Spec 项 | 对应 Task |
|---------|-----------|
| 自研 ReAct loop | T4 |
| OpenAI 兼容 Provider | T6 |
| 内置工具 | T5 |
| Fastify Server + WS | T8–T9 |
| Electron 壳 + 占位 UI | T10–T11 |
| SQLite sessions + trace 落库 | T7 |
| shared 契约 | T2 |
| A2A 仅 stub | T3 `AgentPeerPort` |
| MCP/Sidecar 延后 | 占位 README + P2/P3 路线图 |
| shadcn 可定制 | T11 |
| 停止 run | T4 + T9 + T11 |
| 学习断点 | 每 Task 专节 |

---

## 执行选项

Plan 已保存到 `docs/superpowers/plans/2026-09-05-agent-runtime-p0.md`。

**1. Subagent-Driven（推荐）** — 每个 Task 开新子代理，Task 间停下给你过断点与学习笔记  

**2. Inline Execution** — 本会话按 Task 连续实现，同样在每个 Checkpoint 暂停  

你选哪一种？选定后从 **Task 1** 开始。
