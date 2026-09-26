# 第 2 块：`packages/shared` 契约层

**目的：** 钉死跨进程「线上形状」——`RunEvent`、HTTP/WS DTO、`AppConfig` Zod、密钥引用约定——再读 Runner / Provider / UI 投影时共用同一本词典。  
**建议先读：** [第 1 块：总览与分层](./01-overview-and-layers.md)。  
**断点对照：** [`docs/learning/P0-T02.md`](../learning/P0-T02.md)（契约谁发谁收）；调用链见 [`MAP.md`](../learning/MAP.md) 步骤 13–16。

---

## 1. 设计意图

### 1.1 为何独立 `@agent2026/shared`

产品形态是 **Electron 工作台 ↔ 本机 Agent Server**：UI 与编排不在同一进程，也不能互相 import 实现。若各自手写事件字段与配置形状，一次改名就会让气泡/工具卡静默错位。

因此抽出极薄的共享包，只做三件事：

1. **冻结线上契约**——WS 下行 `RunEvent`、REST/WS 上行 DTO、配置与密钥元数据。
2. **让壳可替换**——desktop 只消费类型；换 CLI / 另一 UI 时，只要仍认同一契约，core / server 不必跟着改皮。
3. **与内核解耦**——`packages/core` **不依赖** `@agent2026/shared`（见 `packages/core/package.json`）。Runner 发的是本地 `RunnerEvent`；跨进程形状由 server 映射到 shared。

依赖边界一句话：

| 包 | 对 shared |
|----|-----------|
| `apps/desktop` | 类型 + 客户端校验（如 `parseRunEvent`） |
| `packages/server` | 路由返回类型、Zod 解析配置、WS `toRunEvent` 目标形 |
| `packages/core` | **零依赖**；结构上可映射，但不 import |
| `packages/providers` | 不直接吃 shared；模型由 server 按 `AppConfig` 装配 |

包本身只有 `zod` + `yaml`（`packages/shared/package.json`），无 Fastify / Electron——避免契约层拖进传输栈。

### 1.2 轻量核心 + Port 扩展，在契约上怎么体现

规格里大量能力（Anthropic、MCP、Sidecar、A2A）是 **Port / 阶段预留**。shared 的策略是：

- **配置 schema 先宽一点**：合法 YAML 能表达未来接线，交叉校验（如 MCP 名引用）也能提前拦住烂配置。
- **运行时装配仍窄**：P0 只接 OpenAI 兼容 + builtin 工具（见第 1 章质疑点；本章用真实路径钉死「宽/窄」差在哪）。

学习视角：读 shared 时区分「**契约允许写什么**」与「**assemble 会不会用**」——二者不等价。

### 1.3 双目标如何落在本包

| 目标 | 在 shared 的体现 |
|------|------------------|
| 产品 | desktop 与 server 共用 DTO，设置页 / 会话列表 / 流式气泡不各写一套 |
| 学习 | 先背事件名与配置字段，再下钻 Runner；对照 MAP「契约冻结于 packages/shared」 |

---

## 2. 关键路径

工作区入口：`packages/shared/src/`；对外桶文件 `index.ts`。

```text
packages/shared/src/
├── index.ts          # 再导出（config / credentials / events / api）
├── events.ts         # RunEvent 联合类型（WS 下行）
├── api.ts            # REST + WS 上行 DTO（无 Zod，纯 type）
├── config.ts         # AppConfig Zod + defaultAppConfig / parse*
├── credentials.ts    # 密钥元数据 Zod + 路径响应类型
└── config.test.ts    # schema 交叉校验单测
```

`package.json` 的 `exports` 还暴露子路径：`.`、`./config`、`./events`、`./api`（credentials 经主入口导出）。

### 2.1 谁在 import 什么（建立坐标）

| 消费者 | 典型路径 | 用到的契约 |
|--------|----------|------------|
| Server 映射 | `packages/server/src/ws/map-run-event.ts` | `RunEvent` |
| Server 跑会话 | `packages/server/src/routes/runs.ts` | `RunEvent`、`RunWsRequest` / `PermissionWsResponse` |
| Server 配置 | `packages/server/src/config/*`、`routes` 的 GET/PUT config | `AppConfig`、`parseAppConfig` |
| Server 密钥 | `packages/server/src/routes/credentials.ts`、`credentials/store.ts` | `CredentialInfo`、`putCredentialRequestSchema` |
| Desktop WS | `apps/desktop/src/lib/ws-client.ts` | `RunEvent`、`WsClientMessage` |
| Desktop 投影 | `apps/desktop/src/lib/apply-run-event.ts` | `RunEvent`、`MessageDto` |
| Desktop HTTP | `apps/desktop/src/lib/api.ts`、settings stores | sessions / config / credentials DTO |

内核对照（**不在 shared 包内**，但读契约必须知道）：

- `packages/core/src/runner/types.ts` — `RunnerEvent`
- `packages/server/src/ws/map-run-event.ts` — `toRunEvent(RunnerEvent): RunEvent`

---

## 3. 数据流 / 控制流（契约视角）

### 3.1 `RunEvent`：线上词典

定义在 `packages/shared/src/events.ts`，是可辨识联合类型（`type` 字段）：

| `type` | 主要字段 | 产品含义 |
|--------|----------|----------|
| `run_start` | `runId`, `sessionId`, `traceId` | 本轮开始；UI 绑定过滤与 Trace 面板 |
| `message_delta` | `runId`, `delta` | 助手文本流式增量 |
| `tool_start` | `runId`, `toolCallId`, `name`, `arguments` | 工具卡展开参数 |
| `tool_end` | `…`, `result`, `isError?` | 工具结果 / 错误态 |
| `permission_request` | `runId`, `requestId`, `toolName`, `arguments` | 权限闸门询问（与上行 `permission_response` 配对） |
| `error` | `runId`, `message` | 本轮错误文案 |
| `run_end` | `runId`, `reason` | `completed` \| `stopped` \| `error` |

`RunEndReason` 由 `Extract<RunEvent, { type: "run_end" }>["reason"]` 导出，避免与字符串字面量散落两处。

**注意：** shared **没有**对 `RunEvent` 做 Zod 运行时校验；desktop 的 `parseRunEvent` 只检查 `type` 是否落在已知集合（`ws-client.ts`）。契约靠 TypeScript + 测试约定，而不是每帧 schema parse。

### 3.2 与 core `RunnerEvent` 的分工

两边字段目前 **结构同构**（对照 `packages/core/src/runner/types.ts` 与 `events.ts`）。分工不在「形状不同」，而在 **所有权与依赖方向**：

```text
Runner（core）
  emit RunnerEvent
       │
       ▼
routes/runs.ts  onEvent → toRunEvent(...)   ← 映射点（server）
       │
       ▼
WebSocket JSON = RunEvent（shared）
       │
       ▼
desktop parseRunEvent → applyRunEvent → 气泡 / tool-card
```

`map-run-event.ts` 的注释写明：**Never drop runId / toolCallId**。当前实现基本是按 case 逐字段拷贝；`tool_end` 对可选 `isError` 做了条件展开。同构并不等于「可以合并成一个类型」——合并会迫使 core 依赖 shared，或迫使 shared 依赖 core 消息模型，破坏「内核无传输、契约无编排」边界。

Server 还有一个控制细节（本章只点到，细节留给第 5 块）：`routes/runs.ts` 可能 **暂缓** 发出内核的 `run_end`，先 `appendMessagesBatch` 再发，保证 UI 收到结束事件时库已落盘。映射函数本身不负责该时序。

### 3.3 API DTO（HTTP 面 + WS 上行）

`packages/shared/src/api.ts` 全是 `export type`，**没有 Zod**。可按通道分组：

**REST（会话 / 健康 / 配置）**

| 类型 | 用途 |
|------|------|
| `HealthResponse` | `{ ok: true, version }` |
| `CreateSessionRequest` / `CreateSessionResponse` | 建会话（可选 title → id） |
| `SessionSummary` / `ListSessionsResponse` | 列表项（含 `createdAt` / `updatedAt` ISO 字符串） |
| `MessageDto` / `GetSessionResponse` | 历史消息（`role`: user \| assistant \| system \| tool） |
| `PostMessageRequest` | REST 追加消息（`{ content }`）；主路径对话走 WS `run` |
| `GetConfigResponse` / `PutConfigRequest` | 均为 `AppConfig`（整份配置读写） |
| `StopRunResponse` | `POST /runs/:runId/stop` → `{ ok: true }` |

**WS 上行（客户端 → Server）**

| 类型 | 形状 |
|------|------|
| `RunWsRequest` | `{ type: "run", sessionId, content }` |
| `PermissionWsResponse` | `{ type: "permission_response", requestId, allow }` |
| `WsClientMessage` | 二者联合 |

下行是 `RunEvent` 流，不放进 `api.ts`——事件有独立模块，避免「REST 清单」与「流式事件」搅在一起。

### 3.4 `AppConfig` Zod 与默认值

权威 schema：`packages/shared/src/config.ts` 的 `appConfigSchema`。

顶层骨架：

- `providers.default` + `providers.entries`（`openai_compatible` \| `anthropic` 判别联合）
- `agents.default`：`model`、`systemPrompt`、`tools`、`maxTurns?`、`maxToolCalls?`
- `tools`：`builtin`（仅 `"http_fetch"` \| `"read_file"`）、`mcpServers: string[]`、`sidecars: string[]`
- `mcpServers?`：顶层 record，条目目前只允许 `transport: "stdio"` + `command` / `args`
- `permissions`：`mode` ∈ `default` \| `ask_all` \| `allowlist` + `allowlist: string[]`
- `a2a.enabled: boolean`

`superRefine` 做的交叉校验（单测在 `config.test.ts`）：

1. `providers.default` 必须存在于 `entries`
2. `agents.default.model` 的 `/` 前半段必须是已知 provider 名
3. 若 `tools.mcpServers` 非空：必须有顶层 `mcpServers`，且每个名字可解析

解析入口：`parseAppConfig` / `parseAppConfigYaml`；产品默认：`defaultAppConfig()`（可读 `OPENAI_BASE_URL`，默认 openai 兼容条目与两个 builtin）。

### 3.5 Credentials：引用约定，不承载密钥值

配置里 **不写明文 Key**，只写引用名：

- Provider 字段：`apiKeyEnv: string`（如 `"OPENAI_API_KEY"`）——名字沿用 env 习惯，实际解析顺序是 **进程环境优先，其次 credentials 文件**（server `credentials/store.ts` 的 `resolve` / `describe`）。

shared 侧类型（`credentials.ts`）：

| 符号 | 角色 |
|------|------|
| `CredentialInfo` | `{ ref, configured, source?: "env"\|"credentials", writable }` —— **列表/详情不回传秘密** |
| `putCredentialRequestSchema` | PUT body：`{ value: string }`（唯一携带明文的请求体形状） |
| `ListCredentialsResponse` | `{ items: CredentialInfo[] }` |
| `SystemPathsResponse` | `configPath` / `credentialsPath` / `version` |

装配接线（契约如何被用，实现细节留给第 7 块）：`assemble/runtime.ts` 用 `entry.apiKeyEnv` 调 `resolveCredential?.(ref) ?? env[ref]`；`routes/credentials.ts` 从 `providers.entries[*].apiKeyEnv` 收集 refs 做列表。

### 3.6 Schema 宽于装配：真实字段例子

承接第 1 章质疑点 1——下面每条都是 **schema 合法（或可写进 YAML）但 P0 装配未接 / 无效** 的对照：

| Schema 路径（`packages/shared/src/config.ts`） | 装配现实（`packages/server/src/assemble/runtime.ts`） | 用户侧症状（预期） |
|-----------------------------------------------|------------------------------------------------------|--------------------|
| `providers.entries.*.type: "anthropic"`（约 L13–L17） | `entry.type !== "openai_compatible"` → `throw Unsupported provider type`（约 L75–L77） | 保存配置可能成功；**开跑时**装配失败 → WS `error` / run 起不来 |
| `agents.default.tools.mcpServers` + 顶层 `mcpServers`（约 L26、L53；且有 refine） | `tools` 只 `createBuiltinToolPort(agent.tools.builtin)`（约 L48–L50） | 交叉校验通过也 **不会** 拉起 MCP；工具列表里看不到 MCP 工具 |
| `agents.default.tools.sidecars`（约 L27） | 无读取、无 Sidecar Port 接线 | 数组可非空，**静默无效** |
| `a2a.enabled`（约 L58–L60） | 装配不读该字段；`AgentPeerPort` 仍为空接口 | 打开开关无运行时效果 |
| `permissions.mode: "allowlist"`（schema 允许） | 权限对象原样传入 Runner；gate **会**按名单判（core） | 此条其实已接通——对比上几行，说明「宽 schema」里也有已接线字段，读代码时要逐项核 |

另：`maxTurns` / `maxToolCalls` 在 schema 为 optional/nullable，装配会读入并交给 `new Runner(...)`——属于 **已接线的宽字段**，与 anthropic/MCP 预留不同。

---

## 4. 潜在问题 / 可质疑点

1. **`RunEvent` 无 Zod，只有 TS + 宽松 `parseRunEvent`。** 未知字段、缺 `runId`、错误 `reason` 字面量仍可能被 `as RunEvent` 放行。产品上依赖 server 诚实发送；学习上要问：契约「冻结」到什么程度才算冻结？
2. **`RunnerEvent` 与 `RunEvent` 双份同构。** 改事件必须同步改 core types、shared events、`toRunEvent`、desktop 投影与测试。映射层几乎是恒等拷贝——收益是依赖隔离，成本是漂移风险。有没有生成或单测「结构相等」断言？
3. **配置 Zod 严格校验 MCP 引用，却不校验「装配是否支持」。** 用户填齐 `mcpServers` 能通过 `parseAppConfig`，却在运行时无 MCP。**校验成功 ≠ 能力就绪**——设置 UI 若只显示「保存成功」，容易误导。
4. **`apiKeyEnv` 命名暗示「只来自环境变量」。** 实际还有 `~/.agent2026/credentials.yaml`；env 命中则 `writable: false`。名称与双源解析略拧——读设置页/文档时要解释「ref 名」，不是「只能 export」。
5. **`api.ts` 无运行时 schema，config/credentials 有 Zod。** 会话 DTO 靠 Fastify 处理器与测试约束；配置写入则强制 parse。边界不一致：是有意（高频消息少开销）还是历史缺口？
6. **`MessageDto.content: string` 压平多模态。** 工具参数在事件里是 `unknown`，消息内容却是纯字符串。后续若 Provider 返回结构化块，shared 消息面是否过早收窄？

---

## 5. 读完自检

1. 用一句话说明：为何 `packages/core` 不依赖 `@agent2026/shared`，却仍能与 desktop 对上事件名？
2. 指出 `RunnerEvent` → `RunEvent` 的映射文件路径；说明当前映射是否改变字段语义。
3. 列出 WS **上行**两种客户端消息类型，以及 **下行**事件模块路径。
4. 打开 `config.ts`：举出一处 **schema 允许、assemble 未接** 的字段，再举一处 **schema 允许且 assemble 已读** 的字段。
5. 解释 `CredentialInfo` 为何没有 `value` 字段；PUT 时明文走哪个 schema？
6. 若合并 `RunnerEvent` 与 `RunEvent` 成单一类型，会破坏哪条依赖边界？

---

## 6. 建议下一章

**第 3 块：`packages/core` Ports + Runner**（`ModelPort` / `ToolPort` / 权限闸门 / ReAct 循环 / 内置工具）。

理由：契约词典已齐；下一步应看这些事件 **从哪 emit**、工具调用如何过 `permission-gate`、以及为何 builtin 仍住在 core。读 Runner 时带着本章的 `run_start`…`run_end` 清单，对照 `runner.ts` 的 `emit` 点即可闭环。
