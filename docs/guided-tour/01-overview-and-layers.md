# 第 1 块：总览与分层

**目的：** 建立整仓心智模型——产品是什么、进程怎么拆、包各自干什么、Port 洞在哪——再往下钻共享契约与 Runner。  
**建议先读：** [如何跟读](./00-how-to-read.md)。  
**快览对照：** [`docs/learning/MAP.md`](../learning/MAP.md)（Enter → `tool_end` 文件级调用链）。

---

## 1. 设计意图

### 1.1 产品定位（双目标）

本仓库（包名 **agent2026**）同时服务两件事：

1. **产品：** 本地可插拔 Agent Runtime + Electron 工作台——对话、工具过程可视化、本机配置与密钥。
2. **学习：** 自研 Agent loop、Provider 适配、权限/Trace、壳与 Server 分离；扩展能力走 Port，核心保持轻量。

规格开篇写得很清楚：不绑定第三方 Agent SDK 作内核；第一成品形态是桌面壳，协议优先级是 Provider + MCP，A2A 仅扩展点。详见：

- [`docs/superpowers/specs/2026-09-05-agent-runtime-design.md`](../superpowers/specs/2026-09-05-agent-runtime-design.md) §1–§2  
- 项目级偏好摘要：学习参考（Harness / Trace / 可插拔记忆）落在「扩展而非塞进 core」。

### 1.2 刻意约束（读代码时别找错层）

| 约束 | 含义（落到实现） |
|------|------------------|
| Runtime **不**跑在 Electron renderer | 编排在 `packages/server` + `packages/core`；UI 只消费 HTTP/WS |
| Server **只做传输与装配** | `packages/server/src/assemble/runtime.ts` 组装 Runner / Model / Tools；业务循环在 core |
| 第一版不做 A2A / 图编排 | `AgentPeerPort` 为空接口；无 LangGraph 式引擎 |
| 壳可替换 | 桌面是第一壳；同一 Server API 理论上可挂 CLI（规格中 `apps/cli` 后置，仓内尚未有该 app） |

### 1.3 进程模型：Electron ↔ Server ↔ core ↔ providers

```text
┌──────────────────────────────────────────────┐
│  apps/desktop                                │
│  · main：ServerManager 守护/复用本机 Server    │
│  · preload：暴露 getServerBaseUrl()          │
│  · renderer：Composer → session-store → WS   │
└─────────────────────┬────────────────────────┘
                      │ HTTP REST + WebSocket（默认 127.0.0.1:8787）
┌─────────────────────▼────────────────────────┐
│  packages/server（装配根）                     │
│  routes / sqlite store / RunHub / map-run-event│
│  assembleRuntime → Runner + ModelPort + Tools │
└─────────────────────┬────────────────────────┘
                      │ 调用 Port，不绑死具体厂商
┌─────────────────────▼────────────────────────┐
│  packages/core                               │
│  Runner（ReAct）· PermissionGate · builtin tools│
│  ports/*.ts（洞）                              │
└───────────┬────────────────────┬─────────────┘
            │ ModelPort          │ ToolPort（P0：builtin）
┌───────────▼──────────┐   ┌─────▼─────────────────────────┐
│ packages/providers   │   │ 未来：packages/mcp、sidecar…   │
│ openai-compatible.ts │   │ （现为占位 README）              │
└──────────────────────┘   └───────────────────────────────┘

契约冻结：packages/shared（RunEvent、API DTO、AppConfig Zod）
```

**进程边界一句话：** Electron 负责 UI 与「Server 在不在」；Agent Server 持有会话与编排入口；`core` 跑循环；`providers` 填模型洞。共享类型在 `shared`，避免 desktop 与 server 各写一套事件。

---

## 2. 关键路径（monorepo）

工作区：根目录 `pnpm-workspace.yaml`（`packages/*`、`apps/*`）+ `turbo` 脚本（根 `package.json`：`dev:server` / `dev:desktop` / `test`）。

### 2.1 包职责一览

| 路径 | npm 名 | 职责 | 依赖边界（读代码时盯住） |
|------|--------|------|-------------------------|
| `packages/shared` | `@agent2026/shared` | Zod 配置、`RunEvent`、HTTP DTO、credentials 类型 | 无 Electron / Fastify；被 server 与 desktop 共用 |
| `packages/core` | `@agent2026/core` | Ports、Runner、权限闸门、内置 ToolPort 实现 | **不**依赖 server / Electron；P0 内置工具在本包 `tools/builtin/` |
| `packages/providers` | `@agent2026/providers` | `ModelPort` 的 OpenAI 兼容实现 | 只依赖 `@agent2026/core` |
| `packages/server` | `@agent2026/server` | Fastify HTTP/WS、SQLite、装配、配置/密钥 | 依赖 core + providers + shared；**不**依赖 Electron |
| `apps/desktop` | `@agent2026/desktop` | Electron 壳 + React 工作台 | 仅经 HTTP/WS 与 preload 拿 baseUrl |
| `packages/mcp` | （占位） | P2+ MCP Client → `ToolPort` | 仅 `README.md` |
| `packages/sidecar-python` | （占位） | P3 Python Tool Sidecar | 仅 `README.md` |

根 README 的「包结构」表与上表一致；旧 Vue + FastAPI 实现在分支 `legacy-vue-fastapi`，不在本走读主路径。

### 2.2 各层「打开这些文件就够建立坐标」

**壳与 UI**

- `apps/desktop/electron/main/index.ts` — 启动主进程、拉起 `ServerManager`
- `apps/desktop/electron/main/server-manager.ts` — 健康检查 8787；无则 spawn，有则 reuse；写 `userData/server.json`
- `apps/desktop/electron/preload/index.ts` — `contextBridge` 暴露 Server base URL
- `apps/desktop/src/components/chat/composer.tsx` — 用户 Enter 入口
- `apps/desktop/src/stores/session-store.ts` / `src/lib/ws-client.ts` / `src/lib/apply-run-event.ts` — 发送 run、解析事件、投影到气泡/工具卡

**Server 装配与传输**

- `packages/server/src/app.ts` — Fastify 创建：CORS、WS、挂 routes、注入 SQLite store / Trace / RunHub
- `packages/server/src/assemble/runtime.ts` — **装配根**：`createOpenAICompatibleModel` + `createBuiltinToolPort` + `new Runner(...)`
- `packages/server/src/routes/runs.ts` — WS `run` / `permission_response`；调用 Runner；`appendMessagesBatch` 后发 `run_end`
- `packages/server/src/ws/map-run-event.ts` — 内核 `RunnerEvent` → shared `RunEvent`
- `packages/server/src/ws/run-hub.ts` — 按 `runId` 持有 `AbortController`（stop）
- `packages/server/src/store/sqlite-session-store.ts` / `sqlite-trace-port.ts` — SessionStore / TracePort 适配器

**内核与 Port**

- `packages/core/src/ports/model-port.ts`、`tool-port.ts`、`session-store.ts`、`trace-port.ts`、`agent-peer-port.ts`
- `packages/core/src/runner/runner.ts` — ReAct：`model.stream` → 可选 `tools.execute` → 再流
- `packages/core/src/permissions/permission-gate.ts` — 工具执行前强制闸门
- `packages/core/src/tools/registry.ts` + `tools/builtin/*` — P0 `ToolPort` 实现（`read_file`、`http_fetch`）

**契约与 Provider**

- `packages/shared/src/events.ts`、`api.ts`、`config.ts`
- `packages/providers/src/openai-compatible.ts`

### 2.3 与 `docs/learning/`、设计规格的关系

| 材料 | 关系 |
|------|------|
| [`docs/learning/MAP.md`](../learning/MAP.md) | **调用链特写**：与本章分层图同构，但逐步点到函数级（Enter → `tool_end`）。本章讲「为什么这样拆」；MAP 讲「一次发送经过哪些文件」。 |
| `docs/learning/P0-T01.md` … `P0-T11.md` | 按 Task 的断点笔记；学完一块后可按 MAP 末尾学习路径回填。 |
| [`docs/learning/P0-REVIEW.md`](../learning/P0-REVIEW.md) | P0 对照规格 §7.1 的验收结论（自动化为主；真 Key / GUI 冒烟另计）。 |
| [`docs/superpowers/specs/2026-09-05-agent-runtime-design.md`](../superpowers/specs/2026-09-05-agent-runtime-design.md) | **权威设计意图**（目标/非目标、分层图、阶段）。本系列引用路径，不复制整篇。 |
| [`docs/superpowers/specs/2026-09-12-settings-design.md`](../superpowers/specs/2026-09-12-settings-design.md) | 设置/配置 UI 与 runtime 的后续规格；总览章点到即可，细节留给第 7 块。 |
| `docs/superpowers/plans/*` | 分阶段实现计划；走读时用来分辨「已落地」vs「仍属计划」。 |

**一句话分工：** 规格说「要建成什么样」；learning 记「怎么验、断点在哪」；guided-tour 按块讲解「如何理解与质疑」。

---

## 3. 数据流 / 控制流（总览级）

### 3.1 一次用户发送（主路径）

与规格 §3.3、MAP 调用链一致，压缩为控制视角：

1. **UI：** `composer` → `session-store.sendMessage`（乐观 user 气泡）→ `ws-client` 发 `{ type: "run", sessionId, content }`。
2. **Server：** `routes/runs.ts` 校验会话 → 写 user 消息 → `TracePort.startTrace` → `assembleRuntime` → `RunHub.create` 得到 AbortSignal。
3. **Runner：** `run_start` → `ModelPort.stream`（providers SSE）→ 纯文本则结束；有 `tool_calls` 则 `evaluatePermission` → `ToolPort.execute` → 继续循环直至上限或完成。
4. **事件上行：** 内核 `RunnerEvent` 经 `map-run-event` 变成 shared `RunEvent`，WS 推给 renderer；`apply-run-event` 投影为消息气泡 / `tool-card`。
5. **收口：** Server 在发最终 `run_end` 前用 `appendMessagesBatch` 持久化本轮 assistant/tool；失败则走 `error` + `run_end reason=error`（见 MAP / P0-T09 笔记）。

### 3.2 停止路径（并行控制面）

`composer` 停止 → `POST /runs/:runId/stop`（`apps/desktop/src/lib/api.ts`）→ `RunHub.abort` → Runner 见 `signal.aborted` → 必要时补 cancelled 的 tool 结果 → `run_end reason=stopped`。

### 3.3 配置如何进入循环

- 磁盘：`~/.agent2026/config.yaml`（及 credentials）；加载逻辑在 `packages/server/src/config/`。
- Zod 契约：`packages/shared/src/config.ts`（含 `anthropic` / `mcpServers` 等** schema 预留**）。
- 装配：`assembleRuntime` 读 `agents.default.model`（`provider/model`）、`tools.builtin`、`permissions`、`systemPrompt`；**当前只实例化 OpenAI 兼容 ModelPort + builtin ToolPort**。

---

## 4. Ports & Adapters 在本仓如何体现

理念：core 定义「洞」（Port），外侧用适配器填洞；Runner 只依赖接口，不 import Fastify / Electron / 具体厂商 SDK。

### 4.1 Port 一览（定义 → P0 适配器）

| Port | 定义 | P0 / 现状适配器 |
|------|------|-----------------|
| `ModelPort` | `packages/core/src/ports/model-port.ts` | `packages/providers/src/openai-compatible.ts`（`createOpenAICompatibleModel`） |
| `ToolPort` | `packages/core/src/ports/tool-port.ts` | `packages/core/src/tools/registry.ts` + `createBuiltinToolPort`（`tools/builtin/`） |
| `SessionStore` | `packages/core/src/ports/session-store.ts` | `packages/server/src/store/sqlite-session-store.ts` |
| `TracePort` | `packages/core/src/ports/trace-port.ts` | `packages/server/src/store/sqlite-trace-port.ts` |
| `AgentPeerPort` | `packages/core/src/ports/agent-peer-port.ts` | **空接口 stub**（注释写明 P4） |

规格图中的 **MemoryPort**、Hooks、MCP/Sidecar 适配器属于路线图：配置 Zod 与文档已部分预留，**`packages/core/src/ports/` 下尚无 `memory-port.ts`**；`packages/mcp`、`packages/sidecar-python` 仅占位 README。

### 4.2 装配点（Adapter 接线处）

真正的「把洞焊上」发生在 Server，而不是 desktop：

```32:54:packages/server/src/assemble/runtime.ts
export function assembleRuntime(input: AssembleRuntimeInput): AssembledRuntime {
  const { config, workspaceRoot } = input;
  // ...
  return {
    runner: new Runner({ maxTurns, maxToolCalls }),
    model:
      input.model ??
      createModelFromConfig(config, env, input.resolveCredential),
    tools: createBuiltinToolPort(agent.tools.builtin as BuiltinToolName[], {
      workspaceRoot,
    }),
    permissions: config.permissions,
    systemPrompt: agent.systemPrompt,
  };
}
```

测试可注入假 `ModelPort`（`CreateAppOptions.model`），CI 不必真 Key——这是 Port 带来的可测性收益。

### 4.3 事件也是一种「边界契约」

- 内核：`packages/core/src/runner/types.ts` 的 `RunnerEvent`
- 跨进程：`packages/shared/src/events.ts` 的 `RunEvent`
- 映射：`packages/server/src/ws/map-run-event.ts`
- UI 投影：`apps/desktop/src/lib/apply-run-event.ts`

把「内核事件」与「线上事件」分开，是为了 core 不依赖 WS 形状，同时 desktop/server 共享同一 Zod/类型面。

---

## 5. 潜在问题 / 可质疑点（基于现状代码）

以下不是空泛「以后要注意」，而是读仓时值得盯住的张力：

1. **配置 schema 宽于装配能力。** `packages/shared/src/config.ts` 允许 `type: "anthropic"` 与 `tools.mcpServers` / `sidecars`；但 `assemble/runtime.ts` 对非 `openai_compatible` 直接 `throw`，且 tools 只走 `createBuiltinToolPort`。用户按规格示例填 anthropic/MCP 会在运行时失败或静默无效——**契约预留 vs 装配未接**。
2. **builtin 工具住在 `core` 包内。** 规格写 core「无具体 I/O 实现」，P0 却把 `read_file` / `http_fetch` 放在 `packages/core/src/tools/builtin/`。学习上便于一个包讲完 ToolPort；产品上则让「纯内核」边界变糊——后续 MCP/Sidecar 是否应全部迁出 core？
3. **`SessionStore` Port 与 SQLite 实现能力不对齐。** 接口只有 `appendMessage`；`SqliteSessionStore.appendMessagesBatch` 与 `routes/runs.ts` 的批量落库是实现扩展。Port 消费者若只认接口，看不到「单事务写完再发 `run_end`」这一关键不变量。
4. **权限默认模式是全放行。** `permission-gate.ts` 注明 `default` 在 P0 auto-allow；`ask_all` 虽有 WS `permission_request` / `permission_response` 路径，但规格中的 Hooks（before/after tool）未实装，写操作/网络/MCP 分级仍是 TODO。安全叙事与默认配置之间有落差。
5. **MemoryPort 在规格图中出现，代码 ports 目录未落地。** 长期记忆候选 OpenViking via MCP；短期会话在 SQLite。读规格容易以为已有 Port 文件——实际只有文档与阶段表（P2.5），避免「找文件找不到」的挫败。
6. **桌面端与真模型冒烟仍偏「工程完成、体验未闭环」。** `P0-REVIEW.md`：自动化 67 项通过，但带真实 API Key 的 Electron 全链路、live spawn 集成测不在默认 `pnpm test`。走读时勿把「单测绿」等同于「本机对话已验」。

（可选观察）`AgentPeerPort` 为空接口：扩展点诚实，但也几乎无类型约束——P4 实装前要靠注释与规格防止误用。

---

## 6. 读完自检

1. 用自己的话画出：**Electron / Server / core / providers / shared** 五块各自「可以依赖谁、绝不能依赖谁」。
2. 指出一次 Enter 之后，**第一个**进入 `packages/core` 的调用点在哪个 Server 文件、什么函数链上。
3. 说出至少一个 **Port 名 + 定义路径 + 一个适配器路径**；再说一个「有配置/规格、尚无适配器」的例子。
4. 解释为何 Runtime 不放进 renderer：若放进去，哪些能力（会话持久化、stop、多壳）会变难？
5. 打开 `assemble/runtime.ts` 与 `shared` 的 `appConfigSchema`：举出一处 **schema 已允许、装配尚未支持** 的字段，并说明用户侧会看到什么症状。
6. 本系列下一块更适合先读 **shared 契约** 还是 **Runner**？你的选择依据是什么？（建议见下。）

---

## 7. 建议下一章

**第 2 块：`packages/shared` 契约层**（`RunEvent`、API DTO、`AppConfig` Zod、密钥引用约定）。

理由：先把「线上形状」钉死，再读 Runner / Provider / UI 投影时，所有事件名与配置字段都有同一本词典；也直接承接本章指出的「schema 宽于装配」张力。
