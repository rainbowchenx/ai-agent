# MCP Client → ToolPort — 设计规格

**日期：** 2026-09-26  
**状态：** 待用户确认（本 PR 仅规格，无实现代码）  
**修订：** 2026-09-26（用户补充：设置完整 CRUD、**stdio + HTTP** 并列、官方 SDK、状态/工具展示、per-server 启停）  
**关联：**  
- `2026-09-05-agent-runtime-design.md` §4.1 `packages/mcp`、§4.2–4.3 配置/装配、§5.2 权限、§5.4 错误、§6.5 OpenViking、§7 P2  
- `2026-09-12-settings-design.md`（MCP 分区占位 → 本规格做实完整 CRUD）  
- `2026-09-20-ask-all-permission-design.md`（权限闸门已通；MCP 工具名走同一环）  
- `2026-09-19-rsi-memory-design.md` / §6.5（记忆 **后置**，经 MCP；本规格不实现记忆）  
**基线：** `origin/main` @ `408c1e9`（审核见 Project Context `main-feature-audit.md`）  
**范围说明：** 交付用户可感知的 MCP **主路径闭环**（设置配置 → 启停 → 连接 → 发现工具 → 命名空间进 ToolPort → 权限/Trace → 对话可见），**stdio 与 HTTP 并列**；轻量核心 + Port 扩展；**不做**插件市场与重量级一体系统。

---

## 1. 目标与非目标

### 1.1 目标（本规格「完整 MCP」= P2 可演示闭环）

1. **官方 SDK（写死）：** `packages/mcp` 仅依赖 **`@modelcontextprotocol/sdk`** 实现 Client；版本锁在该包；**禁止**自研 wire protocol 或引入第二套 MCP 客户端库；**禁止**把 SDK 渗进 `packages/core`。
2. **统一 `ToolPort`：** MCP 工具与 builtin 经装配合并；对 Runner 只见一个 `ToolPort`。
3. **命名空间：** 对外工具名 `{serverName}__{toolName}`，避免多 server / 与 builtin 冲突。
4. **用户可配置（设置页完整 CRUD）：** 在设置中心 MCP 分区完成新增 / 编辑 / 删除 / 保存；与现有 `AppConfig` Zod、`GET/PUT /config` 热配对齐；`agents.default.tools.mcpServers` 引用生效（消解「schema 宽于装配」）。
5. **双 transport（本切片必做）：** **stdio** 与 **HTTP**（含 SDK 支持的 Streamable HTTP / SSE 形态，见 §4.2）并列纳入目标与验收；实现 plan 可分 Task，**不得**把 HTTP 整段推到后续规格。
6. **可启停：** 每个 MCP server 有 `enabled`；**禁用 → 立即断开（或不预连）、不进入 ToolPort**；启用且满足挂载条件后才连接并暴露工具。
7. **有展示处：**  
   - **设置页：** server 列表、启用状态、连接状态、**已发现工具列表**（命名空间名 + 摘要）。  
   - **对话侧：** 调用时既有工具卡 / 权限卡展示完整工具名（`server__tool`）；Trace 侧 `tool` span 同名。
8. **生命周期：** 连接 / 有限重连 / 错误可观测 / 优雅关闭 / 热更下一 run 用新快照（见 §5）。
9. **权限与 Trace：** MCP 工具名走既有闸门（含 `ask_all`）与 `tool` span；连接级错误在设置页可见，不静默吞掉。
10. **可演示：** 至少各跑通 **一条 stdio**（如 filesystem）与 **一条 HTTP** MCP → Agent 调到命名空间工具 → UI 工具卡 + Trace 可见。

### 1.2 非目标（明确不做 / 推迟）

| 不做 | 理由 |
|------|------|
| 插件市场 / 远程目录 / 一键安装商店 | 手写配置 + 设置 CRUD 足够 |
| WebSocket 等 SDK 未作为一等 Client transport 的通道 | 本切片锁定 SDK 已支持的 stdio + HTTP(SSE/Streamable)；其余后置 |
| OAuth / 完整远程 IdP 流程 | 本切片 HTTP 仅支持可选静态 headers / Bearer 引用（见 Q6）；完整 OAuth 后置 |
| OpenViking / `MemoryPort` / RSI 记忆提炼 | P2.5；本切片提供可挂 HTTP MCP 的管道（含可连本机 OpenViking URL），**不**实现记忆语义 |
| Resources / Prompts / Sampling / Roots | 第一刀只做 **Tools** 发现与调用 |
| 改 `default` 模式「写/网络/MCP 细分询问」 | 独立权限切片 |
| Hooks / Sidecar / A2A | 总规格后续阶段 |
| 第三方 Agent SDK 作内核 | 自研 Runner 不变 |
| 重量级 Harness 一体观测站、图编排 | 产品原则禁止 |

### 1.3 成功判据（一句话）

用户在设置里 **CRUD** 并 **启用** stdio 或 HTTP MCP → 看见连接状态与发现的工具 → 新 run 能调用 `server__tool`（对话工具卡可见）→ **禁用**后断开且不再出现在 ToolPort；未配置 MCP 时行为与今日相同。

---

## 2. 已确认决策（写入规格，实现不得静默改）

| 项 | 决策 |
|----|------|
| SDK | **必须** `@modelcontextprotocol/sdk`（官方）；仅 `packages/mcp` 依赖；`core` / `desktop` 不直连 SDK |
| 包边界 | MCP 逻辑在 `packages/mcp`；`server` 装配 + Supervisor 生命周期；`desktop` 只经 HTTP API |
| Transport | **本切片：`stdio` + `http`（SDK 的 Streamable HTTP / SSE，见 §4.2）** |
| 合并方式 | **Composite / 合并 `ToolPort`**；冲突时 **装配失败**，不静默覆盖 |
| 命名空间 | `{serverName}__{originalToolName}`；`serverName` = 配置 key（`[a-zA-Z0-9_-]+`） |
| `enabled` | 默认 `true`；`false` → **不预连 / 断开现有连接**，**不进 ToolPort**，设置页仍显示该行（灰态） |
| 连接时机 | **Server 进程级** `McpSupervisor`；仅对 **enabled** 的 server reconcile；assemble 读健康快照 |
| Agent 挂载 | 进入 Agent `list()` 须同时：`enabled === true` **且** 名在 `agents.default.tools.mcpServers` **且** `status === ready`（见 Q1 关于「仅配置未挂载」是否预连） |
| 权限 | 完整命名空间名；`ask_all` / `allowlist` / `default` 语义不变 |
| Trace | `tool_start`/`tool_end` → `kind: "tool"`；`name` = 命名空间工具名 |
| 配置诚实 | 禁止「配置合法、运行时无工具且无声」；失败在设置页 `error` + `lastError` |
| 用户配置 | **设置页完整 CRUD 为一等交付**，不是占位；也可手改 `config.yaml`，以 Zod 为准 |
| 展示 | 设置页必须能看清：列表 · 启用 · 连接状态 · 发现的工具；对话侧靠既有工具卡 |

### 2.1 开放问题状态

**Q1–Q5 用户尚未逐条回复。** 实现 plan **暂按 §11「建议默认」锁定**；用户异议后再改规格。本节新增的 HTTP 相关开放点见 **Q6–Q8**。

---

## 3. 架构

### 3.1 分层

```text
apps/desktop
  设置 MCP 分区：
    CRUD · enable 开关 · 连接状态 · 已发现工具列表 · 刷新
  对话：工具卡 / 权限卡（server__tool）
        │ HTTP/WS（仅调本机 Agent Server API）
packages/server
  ConfigService · McpSupervisor（stdio 子进程 + HTTP 会话）
  assembleRuntime：builtin ⊕（enabled∩挂载∩ready 的 MCP ports）→ ToolPort
        │
packages/mcp                          packages/core
  仅依赖 @modelcontextprotocol/sdk      ToolPort · Runner · PermissionGate
  McpServerSession（stdio | http）
        │ stdio spawn          │ HTTP(S) 到远程/本机 MCP endpoint
  外部 MCP Server 进程 / 服务
```

### 3.2 关键类型（逻辑形状；实现落在 `packages/mcp`）

```ts
type McpTransportKind = "stdio" | "http"; // http = SDK Streamable HTTP 和/或 SSE，见 §4.2

interface McpServerSession {
  readonly name: string;
  readonly status: "connecting" | "ready" | "error" | "closed" | "disabled";
  readonly lastError?: string;
  readonly tools: ToolDefinition[]; // 已加命名空间，供设置页展示
  asToolPort(): ToolPort;
  refreshTools(): Promise<void>;
  close(): Promise<void>;
}

interface McpServerStatusView {
  name: string;
  enabled: boolean;
  transport: McpTransportKind;
  status: McpServerSession["status"];
  toolCount: number;
  tools: Array<{ name: string; description?: string }>; // 发现的工具，供 UI
  lastError?: string;
}

interface McpSupervisor {
  reconcile(config: AppConfig): Promise<void>;
  getPort(serverName: string): ToolPort | undefined;
  getStatus(): McpServerStatusView[];
  refreshTools(serverName: string): Promise<void>;
  shutdown(): Promise<void>;
}
```

`core` **不**引入上述类型。

### 3.3 合并 ToolPort

偏好（plan 二选一）：`CompositeToolPort` 或装配期灌入 `ToolRegistry`。

约束：

- builtin 裸名；MCP 必须带 `{server}__` 前缀。  
- 原始工具名已含 `__` 仍只加一层 server 前缀。  
- 与 builtin 或其它 server 合并撞名 → **装配抛错**，该 run 不启动。  
- **`enabled: false` 的 server 不得出现在合并结果中。**

### 3.4 与 builtin 共存

```text
createBuiltinToolPort(builtin[])
  ⊕
ports for servers where:
  enabled && in agents.default.tools.mcpServers && ready
  → tools: ToolPort → Runner
```

---

## 4. 配置模型

### 4.1 Zod 演进（相对今日 `transport: z.literal("stdio")`）

今日 schema **仅 stdio**。本切片必须扩展为 **判别联合**，与 SDK 能力对齐，例如：

```yaml
mcpServers:
  filesystem:
    transport: stdio
    enabled: true
    command: npx
    args: [-y, "@modelcontextprotocol/server-filesystem", "/path"]
    env: {}
    cwd: null

  openviking:           # 示例：本机 HTTP MCP（记忆仍属 P2.5）
    transport: http
    enabled: true
    url: http://localhost:1933/mcp
    headers: {}         # 可选；敏感值见 Q6
```

逻辑形状（实现时以 Zod 为准，字段名可微调但语义不变）：

| `transport` | 必填 | 可选 |
|-------------|------|------|
| `stdio` | `command`, `args` | `env`, `cwd`, `enabled` |
| `http` | `url`（绝对 URL） | `headers`（`Record<string, string>`）、`enabled`；具体用 Streamable HTTP 还是 SSE 见 **Q7** |

`agents.default.tools.mcpServers: string[]` 继续引用顶层 key；superRefine：引用必须存在。

**兼容：** 缺省 `enabled` → `true`；旧仅 stdio 的配置文件继续合法。

### 4.2 HTTP 与 SDK transport 映射

| 规格层 `transport: http` | SDK（`@modelcontextprotocol/sdk`） | 说明 |
|--------------------------|-------------------------------------|------|
| HTTP MCP endpoint | Streamable HTTP Client transport 和/或 SSE Client transport | **必须以官方 SDK 导出为准**；plan 锁定具体 class 名与推荐默认 |
| 本切片 | 至少一种可连通的远程/本机 HTTP MCP | 验收可用本机 mock 或真实服务（如 OpenViking 的 `/mcp`） |

禁止：手写 JSON-RPC over fetch 绕过 SDK。

### 4.3 设置页（完整 CRUD + 展示 + 启停）— **一等交付**

MCP 分区从「即将支持」改为 **完整可操作**，至少包含：

| 能力 | 行为 |
|------|------|
| **列表** | 所有已配置 server：名称、transport 类型、URL 或 command 摘要、`enabled`、连接状态、工具数量 |
| **新增** | 表单：名称、transport（stdio / http）、对应字段（command/args 或 url/headers）、是否挂到默认 Agent |
| **编辑** | 改字段后保存 → `PUT /config` → reconcile |
| **删除** | 从 `mcpServers` 移除；同步清理 `tools.mcpServers` 引用；断开连接 |
| **启用 / 禁用** | 开关写 `enabled`；**关：断开且不进 ToolPort**；开：按 §5 连接（若亦在挂载列表则进 Agent） |
| **连接状态** | `disabled` / `connecting` / `ready` / `error`（+ `lastError` 摘要） |
| **已发现工具** | 展开或子列表：展示 `server__tool` 与短 description；`ready` 时必有（可为空列表） |
| **刷新工具** | 每 server「刷新」→ `refreshTools`（Q3 建议默认：要） |
| **挂到默认 Agent** | 勾选 ⇄ `agents.default.tools.mcpServers` |
| **保存校验** | Zod 失败拒绝并提示；成功后状态区更新 |

**不**做：插件市场、应用商店式推荐墙（文档给 stdio / HTTP 各一示例即可）。

### 4.4 API 表面（Server）

| 面 | 说明 |
|----|------|
| `GET/PUT /config` | 承载完整 MCP 配置；PUT 成功 → `McpSupervisor.reconcile` |
| `GET /mcp/status`（推荐独立路由） | 返回 `McpServerStatusView[]`（含 **tools 列表**），供设置页轮询或保存后拉取 |

桌面 Renderer **不**直连 MCP；不强制新增 WS 推送（设置页拉取即可）。

### 4.5 Schema ↔ 装配诚实化

| 情况 | 行为 |
|------|------|
| enabled + 挂载 + ready | 工具进入合并 ToolPort |
| enabled + 挂载 + error | 不进 list；设置页标红；run 策略见 Q2 |
| `enabled: false` | 不连接；不进 ToolPort；UI 显示 disabled |
| `sidecars` / `a2a` | 本切片仍可不实现；建议装配 log warn |

---

## 5. 生命周期

### 5.1 连接

```text
Server 启动 / PUT /config
  → McpSupervisor.reconcile(config)
       for each server:
         if !enabled → close if open; status=disabled; skip
         if stdio → spawn → SDK initialize → tools/list → ready|error
         if http  → SDK HTTP/SSE transport → initialize → tools/list → ready|error
  → Agent Server 继续服务
```

单 server 失败 **不**阻断整个 Agent Server。

### 5.2 热配置

| 变更 | 策略 |
|------|------|
| 新增且 enabled | 连接 + list tools |
| `enabled: true → false` | **立即 close/断开**；移出 ToolPort 池 |
| `enabled: false → true` | 连接（若需进 Agent 另看挂载列表；预连策略见 Q1） |
| 删除 | close + 配置移除 |
| stdio command/args/env 或 http url/headers 变更 | 重启该会话 |
| 仅改挂载列表 | 可不重连；下次 assemble 换合并集 |
| 进行中 run | **不打断**；沿用装配时工具快照 |

### 5.3 重连

- stdio 子进程意外退出或 HTTP 会话断开 → `error`；**有限次**自动重连（建议退避最多 3 次）。  
- `enabled: false` 期间 **禁止**自动重连。  
- 旧 Port 上的 `execute` → 明确 tool error，不崩 Runner。

### 5.4 工具列表刷新

- 连接成功时 `tools/list`。  
- 设置页「刷新」→ `refreshTools`（建议默认要做）。  
- **不**做 `notifications/tools/list_changed` 订阅（增强项）。

### 5.5 关闭

- Server shutdown → `McpSupervisor.shutdown()`：关掉所有 HTTP 会话并 **杀掉 stdio 进程树**。

### 5.6 错误策略

| 场景 | 策略 |
|------|------|
| initialize / list 失败 | 该 server `error` + `lastError` |
| `callTool` 失败 / 超时 | tool result 回模型；记 Trace |
| URL 不可达 / TLS 失败 | `error`，设置页可见 |
| 配置非法 | `PUT /config` 拒绝，保留上一份有效配置 |

---

## 6. 权限与 Trace 挂钩

### 6.1 权限

```text
tool_call name = "filesystem__read_file"
  → evaluatePermission({ toolName: 完整名, ... })
  → ask_all 权限卡标题含完整名
  → allowlist 须写完整名
  → default：仍 auto-allow（细分另案）
```

「本会话允许」按 **完整工具名**；不做整 server 一键信任（后置）。

### 6.2 Trace / 对话展示

| 面 | 期望 |
|----|------|
| 工具卡 | 展示命名空间工具名（既有 `tool_start`/`tool_end`） |
| Trace | `kind: "tool"`，名称可读 |
| 设置页 | 连接失败不必写 run trace |
| permission span | 半落地债不强制本切片修 |

---

## 7. 与 Memory / OpenViking 的边界

| 层 | 本切片 | P2.5 |
|----|--------|------|
| stdio + HTTP MCP Tools 管道 | ✅ | — |
| 配置/连接 `http://localhost:1933/mcp` 类 endpoint | ✅（作为普通 HTTP MCP） | — |
| OpenViking 记忆语义 / RSI / `MemoryPort` / Hooks auto-recall | ❌ | ✅ |
| `packages/core` 依赖 OpenViking | **禁止** | 永远禁止 |

原则：本切片让用户 **能配置并启用** HTTP MCP（含未来的 OpenViking）；**不**在产品层宣称「长期记忆已完成」。

---

## 8. 分阶段交付

### 8.1 P2（本规格）— 目标与验收含 stdio **与** HTTP

实现 plan 可拆 Task（先 stdio 再 HTTP，或并行），但 **规格完成定义同时包含两者**。

建议实现顺序（供 writing-plans，非本 PR）：

1. Zod 判别联合（stdio | http）+ `enabled`  
2. `packages/mcp` + **官方 SDK**：stdio session + 命名空间 ToolPort  
3. 同包 HTTP session（SDK Streamable HTTP / SSE）  
4. `McpSupervisor` reconcile（尊重 enabled）+ shutdown  
5. `assembleRuntime` 合并 + 冲突检测  
6. `GET /mcp/status`（含 tools 列表）  
7. 设置页完整 CRUD + 启停 + 状态 + 工具展示 + 刷新  
8. 测试与双 transport 冒烟  

### 8.2 不再单列「P2.1 = HTTP」

原「HTTP 整段推到 P2.1」**作废**。若需文档分期，仅作为 **同一规格下的 Task 顺序**，不是范围外。

### 8.3 P2.5 — OpenViking 记忆（既有意向）

- 记忆语义、示例与可选 `MemoryPort`；依赖本切片 HTTP 管道已通。

### 8.4 更后

- `list_changed`、Resources/Prompts、OAuth 完整流、整 server 信任、Sidecar 复用 Supervisor。

---

## 9. 验收标准

### 9.1 功能

1. **设置 CRUD：** 可新增/编辑/删除 stdio 与 HTTP server，保存进 `config.yaml`（经 API），刷新后仍在。  
2. **启停：** 禁用后状态为 disabled、进程/会话断开、新 run 的 ToolPort **无**其工具；再启用可恢复连接（在挂载前提下进入 ToolPort）。  
3. **展示：** 设置页可见连接状态与 **发现的工具列表**；对话中调用后工具卡显示 `server__tool`。  
4. **stdio 冒烟：** 至少一个真实或 fixture stdio MCP 调用成功 + Trace tool span。  
5. **HTTP 冒烟：** 至少一个 HTTP MCP（本机 mock 或真实 endpoint）调用成功 + Trace tool span。  
6. **`ask_all`：** 对 MCP 工具弹出权限卡，允许/拒绝行为与 builtin 一致。  
7. **挂载：** 仅 `tools.mcpServers` 中且 enabled+ready 的工具进模型 tools 列表。  
8. **无 MCP：** 与合入前行为一致；`pnpm test` 全绿。  
9. **退出：** 无残留 stdio MCP 子进程（抽查）。

### 9.2 工程

1. MCP 客户端 **只**通过 `@modelcontextprotocol/sdk`；`packages/core/package.json` **无**该依赖。  
2. `assembleRuntime`（或等价）消费 MCP 配置；不再静默忽略。  
3. Zod 接受 `transport: stdio | http`（及对应字段）；非法组合拒绝保存。  
4. 默认测试套件含命名空间 / enabled / 合并冲突，以及 stdio与 HTTP 的 mock/fixture 测（避免强制外网）。

### 9.3 非验收

- OpenViking 记忆读写语义、RSI 提炼。  
- OAuth 授权码流 / 动态 client registration。  
- 插件市场 UI。  
- `default` 权限对 MCP 加严。

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| stdio 子进程泄漏 | shutdown + 进程树；禁用即 kill |
| HTTP 方言不一（SSE vs Streamable） | 只走官方 SDK；Q7 锁定默认；验收用一种稳定方言 + 文档注明 |
| `npx` 冷启动慢 | UI `connecting`；超时 → error |
| 热更与进行中 run | per-run 工具快照 |
| headers / 密钥进 config | Q6；UI 不回显明文 |
| 安全：stdio≈本地代码执行；HTTP≈信任远端 | 文档警告；ask_all；不自动启用未知 server |
| SDK API 变动 | 锁版本；适配仅在 `packages/mcp` |

---

## 11. 开放问题（需用户拍板）

### 11.1 仍待逐条确认（暂按建议默认）

| ID | 问题 | 建议默认 | 状态 |
|----|------|----------|------|
| **Q1** | `enabled` 但未加入 `tools.mcpServers`：是否仍预连接以便设置页展示工具？ | **预连接**（便于看发现的工具）；仅挂载者进入 Agent `list()`。`enabled: false` 一律不连 | 用户未逐条回复；**暂按此默认** |
| **Q2** | 挂载的 server 全部 `error` 时是否拒绝新 run？ | **允许启动**（仅 builtin）+ 设置页/日志警告 | 同上 |
| **Q3** | 设置页「刷新工具列表」？ | **要**；不做 `list_changed` 订阅 | 同上 |
| **Q4** | stdio `env` 敏感值存哪？ | 非密进 config；类 Key 走 credentials 引用（来不及可先只支持非密） | 同上 |
| **Q5** | 文档默认 stdio 示例？ | `@modelcontextprotocol/server-filesystem` + workspace 路径 | 同上 |

### 11.2 本轮新增（HTTP / 鉴权）

| ID | 问题 | 建议默认 |
|----|------|----------|
| **Q6** | HTTP `headers`（如 `Authorization`）存在哪？UI 如何编辑？ | **写路径：** 敏感 header 值优先走 credentials 引用（如 `Authorization: Bearer ${ref:OV_TOKEN}` 或并列 `headerRefs`）；若 P2 实现预算紧，可先允许 config 内明文 headers + UI 警告「勿提交密钥」，但 GET 配置对敏感 key **掩码**。完整钥匙串后置 |
| **Q7** | `transport: http` 默认用 SDK 的 Streamable HTTP 还是 SSE？ | **优先 Streamable HTTP**（SDK 现行推荐）；若 initialize 失败且 URL 像经典 SSE endpoint，可再尝试 SSE——或设置页增加子选项 `httpSubtype: streamable | sse`（默认 streamable）。plan 按 SDK 版本文档锁死 class |
| **Q8** | HTTP 验收用什么服务？ | **优先：** 测试用轻量 mock HTTP MCP（CI 友好）；文档另给 OpenViking `http://localhost:1933/mcp` 作手工示例，不把 OV 安装纳入 CI |

未回复前，writing-plans / 实现 **按上表建议默认**；异议只改规格再动代码。

---

## 12. 供 writing-plans 分期（预告，非本 PR 任务）

> 确认规格后另开 `docs/superpowers/plans/2026-09-26-mcp-toolport.md`。**不要**在本 PR 实现。

| Task | 内容 | 建议测试 |
|------|------|----------|
| 1 | Zod：`stdio` \| `http` 判别联合 + `enabled`；shared 单测 | shared |
| 2 | `packages/mcp` 脚手架 + **仅** `@modelcontextprotocol/sdk`；stdio session + 命名空间 | 单测 mock |
| 3 | 同包 HTTP session（按 Q7） | 单测 mock |
| 4 | `McpSupervisor`（enabled 短路、reconcile、shutdown） | 单测 |
| 5 | `assembleRuntime` 合并；Server 挂 Supervisor | Server 集成 |
| 6 | `GET /mcp/status`（含 tools） | server 测 |
| 7 | 设置页完整 CRUD + 启停 + 状态 + 工具列表 + 刷新 | Desktop / 手工 |
| 8 | ask_all + Trace 回归 | 扩展 runs 测 |
| 9 | 冒烟：stdio filesystem + HTTP mock/真实 | 学习笔记勾选 |
| 10 | 文档：`packages/mcp` README、学习短记、总规格回写 | — |

合入：自最新 `main` 出实现分支；合并前 `pnpm test` 全绿。

---

## 13. 后续（明确不在本规格交付）

- P2.5 OpenViking **记忆语义** / RSI / `MemoryPort`（HTTP 管道已在本切片）  
- Resources / Prompts / Sampling  
- 完整 OAuth  
- 整 server 会话级信任  
- Sidecar 与 MCP Supervisor 复用  
- `default` 权限细分（含「MCP 默认询问」）
