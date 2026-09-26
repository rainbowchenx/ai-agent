# MCP Client → ToolPort — 设计规格

**日期：** 2026-09-26  
**状态：** 待用户确认（本 PR 仅规格，无实现代码）  
**关联：**  
- `2026-09-05-agent-runtime-design.md` §4.1 `packages/mcp`、§4.2–4.3 配置/装配、§5.2 权限、§5.4 错误、§6.5 OpenViking、§7 P2  
- `2026-09-12-settings-design.md`（MCP 分区占位 → 本规格做实）  
- `2026-09-20-ask-all-permission-design.md`（权限闸门已通；MCP 工具名走同一环）  
- `2026-09-19-rsi-memory-design.md` / §6.5（记忆 **后置**，经 MCP；本规格不实现记忆）  
**基线：** `origin/main` @ `408c1e9`（审核见 Project Context `main-feature-audit.md`）  
**范围说明：** 交付用户可感知的 MCP **主路径闭环**（配置 → 连接 → 命名空间工具 → 权限/Trace → 对话调工具），保持轻量核心 + Port 扩展；**不做**插件市场与重量级一体系统。

---

## 1. 目标与非目标

### 1.1 目标（本规格「完整 MCP」切片 = P2 可演示闭环）

1. **`packages/mcp` 落地 MCP Client**（官方 SDK），作为工具来源适配器，**不**把 MCP SDK 渗进 `packages/core`。
2. **统一 `ToolPort`**：MCP 工具与 builtin 经装配合并；对 Runner 只见一个 `ToolPort`。
3. **命名空间**：对外工具名 `{serverName}__{toolName}`，避免多 server / 与 builtin 冲突。
4. **配置闭环**：与现有 `AppConfig` Zod / `PUT /config` / 设置页 MCP 分区对齐；`agents.default.tools.mcpServers` 引用生效（消解「schema 宽于装配」）。
5. **生命周期**：stdio 子进程连接、失败可观测、优雅关闭、配置热更后下一 run 用新连接策略（见 §5）。
6. **权限与 Trace**：MCP 工具名走既有闸门（含 `ask_all`）与 `tool` span；连接级错误可被用户看见，不静默吞掉。
7. **可演示**：挂至少一个真实 stdio MCP（如 filesystem）→ Agent 调到命名空间工具 → UI 工具卡 + Trace 可见。

### 1.2 非目标（明确不做 / 推迟）

| 不做 | 理由 |
|------|------|
| 插件市场 / 远程目录 / 一键安装商店 | 违背「最小内核可扩展」；配置手写 + 设置 CRUD 足够 |
| 一次做完所有 transport（SSE / Streamable HTTP / WebSocket 等） | 现有 Zod 仅 `stdio`；HTTP 留给 P2.1，服务 OpenViking |
| OpenViking / `MemoryPort` / RSI 记忆提炼 | P2.5；本切片只保证「MCP 管道」可接 |
| Resources / Prompts / Sampling / Roots 完整 MCP 面 | 第一刀只做 **Tools** 发现与调用 |
| OAuth / 远程鉴权 MCP | 本机 stdio 优先；远程 auth 后置 |
| 改 `default` 模式「写/网络/MCP 细分询问」 | 独立权限切片；本规格只要求 MCP 名进入现有三种模式 |
| Hooks 生命周期 / Sidecar / A2A | 总规格后续阶段 |
| 任意第三方 Agent SDK 内核 | 自研 Runner 不变 |
| 重量级 Harness 一体观测站、图编排 | 产品原则禁止 |

### 1.3 成功判据（一句话）

用户在设置里添加并启用一个 stdio MCP server → 保存后新 run 能列出并调用 `server__tool` → 权限卡 / 工具卡 / Trace 行为与 builtin 一致；未配置 MCP 时行为与今日完全相同。

---

## 2. 已确认决策（写入规格，实现不得静默改）

| 项 | 决策 |
|----|------|
| 包边界 | MCP 逻辑在 `packages/mcp`；`core` 只认识 `ToolPort` / `ToolDefinition`；`server` 负责装配与子进程生命周期 |
| 合并方式 | **Composite / 合并 `ToolPort`**：builtin + 各 MCP 来源；冲突时 **装配失败**（拒绝启动该 run 的工具集），不静默覆盖 |
| 命名空间 | `{serverName}__{originalToolName}`；`serverName` = 配置 key（`[a-zA-Z0-9_-]+`） |
| 本切片 transport | **仅 stdio**（对齐现有 Zod）；HTTP/SSE 标为 P2.1 |
| 连接时机 | **Server 进程级**持有 `McpSupervisor`（连接池）；每次 `assembleRuntime` **读当前已连接且健康**的工具快照，不在每次 run 里重新 spawn（热更策略见 §5） |
| Agent 选用 | 仅挂载 `agents.default.tools.mcpServers` **列出的** server；顶层 `mcpServers` 可配置但未引用则 **不**进该 Agent 工具表（仍可预连，见开放问题 Q1） |
| 权限 | 工具名用 **完整命名空间名**；`ask_all` / `allowlist` / `default` 语义不变；`allowlist` 条目须写全名如 `filesystem__read_file` |
| Trace | 沿用 `tool_start`/`tool_end` → `kind: "tool"`；span `name` = 命名空间工具名；可选 metadata 记 `mcpServer`（若现有 span 字段易扩展则加，否则 P2.1） |
| 配置诚实 | 引用了 MCP 但 Client 未实现 / 连接失败：装配或 run 启动时 **显式错误或警告**，禁止「配置合法、运行时无工具且无声」 |
| SDK | `@modelcontextprotocol/sdk`（官方）；版本锁在 `packages/mcp` |
| 桌面 | MCP 设置分区从「即将支持」改为可 CRUD；Renderer **不**直连 MCP 进程 |

---

## 3. 架构

### 3.1 分层

```text
apps/desktop
  设置：MCP Server CRUD · 启用/禁用 · 连接状态展示
  对话：工具卡 / 权限卡（工具名为 server__tool）
        │ HTTP/WS
packages/server
  ConfigService · McpSupervisor（连接 / 重连 / shutdown）
  assembleRuntime：builtin ToolPort ⊕ MCP ToolPort(s) → 统一 ToolPort
        │
packages/mcp                 packages/core
  McpClientAdapter             ToolPort · ToolRegistry · Runner
  （SDK session + list/call）   PermissionGate（按工具名）
        │ stdio
  外部 MCP Server 进程
```

### 3.2 关键类型（逻辑形状；实现时落在 `packages/mcp`）

```ts
/** 单 server 适配为 ToolPort；list() 返回已加命名空间的 ToolDefinition */
interface McpServerSession {
  readonly name: string;
  readonly status: "connecting" | "ready" | "error" | "closed";
  readonly lastError?: string;
  asToolPort(): ToolPort; // execute 内部 strip 前缀再 callTool
  refreshTools(): Promise<void>;
  close(): Promise<void>;
}

interface McpSupervisor {
  /** 按当前 AppConfig.mcpServers 对齐连接集 */
  reconcile(config: AppConfig): Promise<void>;
  getPort(serverName: string): ToolPort | undefined;
  getStatus(): Record<string, { status: string; toolCount: number; lastError?: string }>;
  shutdown(): Promise<void>;
}
```

`core` **不**引入上述类型；仅接收最终合并的 `ToolPort`。

### 3.3 合并 ToolPort

偏好最小实现（二选一，plan 定稿）：

1. **`CompositeToolPort`**：`list()` 拼接；`execute` 按名路由到子 Port。  
2. **装配期灌入一个 `ToolRegistry`**：把 MCP handler 注册进同一 registry。

约束：

- builtin 名保持裸名（`read_file`）；MCP 必须带前缀。  
- 若 MCP 原始工具名已含 `__`，仍只加 **一层** `{server}__` 前缀。  
- 同名冲突（两 server 配置错误导致合并撞车、或与 builtin 撞车）：**装配抛错**，该 run 不启动。

### 3.4 与 builtin 共存

```text
createBuiltinToolPort(builtin[])
  ⊕
McpSupervisor ports for each name in agents.default.tools.mcpServers
  →
tools: ToolPort  →  Runner
```

未在 `tools.mcpServers` 引用的 server：**不**出现在该 Agent 的 `list()`（即使 Supervisor 已连接——取决于 Q1）。

---

## 4. 配置模型

### 4.1 现状（保持兼容）

```yaml
agents:
  default:
    tools:
      builtin: [read_file, http_fetch]
      mcpServers: [filesystem]   # 引用顶层 key
      sidecars: []

mcpServers:
  filesystem:
    transport: stdio
    command: npx
    args: [-y, "@modelcontextprotocol/server-filesystem", "/path"]
```

Zod 已校验：引用必须存在于顶层 `mcpServers`。本切片 **继续仅 `transport: stdio`**。

### 4.2 建议增补字段（可选，plan 可裁）

| 字段 | 位置 | 用途 |
|------|------|------|
| `env?: Record<string, string>` | 每 server | 传给子进程；**禁止**在 UI 回显敏感值（写后可读「已设置」） |
| `enabled?: boolean`（默认 true） | 每 server | 禁用而不删配置 |
| `cwd?: string` | 每 server | stdio 工作目录 |

不在本切片加：`url` / `headers`（HTTP）、OAuth、超时细项（可用合理默认常量）。

### 4.3 设置页

把 MCP 分区从占位改为可操作：

| 能力 | 行为 |
|------|------|
| 列表 | 展示已配置 server：名、command 摘要、状态（来自 `GET` 状态 API 或嵌入 config GET 扩展） |
| 新增 / 编辑 / 删除 | 写回 `mcpServers` + 可选更新 `agents.default.tools.mcpServers` |
| 挂到默认 Agent | 勾选 = 写入 `tools.mcpServers` 数组 |
| 保存 | 现有 `PUT /config`；Zod 失败则拒绝并提示 |
| 状态 | `ready` / `error` / `connecting`；error 显示 `lastError` 摘要 |

**不**在设置页内嵌「MCP 市场」或自动 `npx` 推荐商店 UI（文档可给示例 command）。

### 4.4 API 表面（Server）

| 面 | 说明 |
|----|------|
| 现有 `GET/PUT /config` | 继续承载 MCP 配置；PUT 成功后触发 `McpSupervisor.reconcile` |
| 建议 `GET /mcp/status`（或 config 旁路字段） | 只读连接状态与工具数量，供设置页刷新；**不含**工具完整 schema 亦可 |

桌面仍只走 HTTP；不新增 WS 事件类型（除非后续要做 live 状态推送——非本切片必做）。

### 4.5 Schema ↔ 装配诚实化

| 情况 | 行为 |
|------|------|
| `tools.mcpServers` 非空且 `packages/mcp` 已实现 | 装配合并工具；某 server `error` → 见 §5（默认：该 server 工具不进入 list，run 可启动但设置页标红；**首次调用缺失工具**由模型侧自然失败——或装配时若引用 server 全部 error 则拒绝 run，见 Q2） |
| 旧二进制 / 未实现时（本规格合入前） | 不适用；合入后不得再忽略引用 |
| `sidecars` / `a2a` | **仍可**宽 schema；本切片只诚实化 **MCP**；sidecar 继续忽略并（建议）在装配 log warn |

---

## 5. 生命周期

### 5.1 连接

```text
Server 启动
  → load config
  → McpSupervisor.reconcile(config)
       对每个 enabled stdio server：spawn → initialize → tools/list → status=ready
  → 就绪服务 HTTP/WS
```

失败：单个 server `status=error` + `lastError`；**不**阻断整个 Server 启动（无 MCP 时产品仍可用）。

### 5.2 热配置（`PUT /config`）

| 变更 | 策略 |
|------|------|
| 新增 server | spawn + list tools |
| 删除 / 禁用 | `close()` 子进程；从池移除 |
| command/args/env 变更 | 重启该 server 连接 |
| 仅改 `tools.mcpServers` 引用 | **不必**重连；下次 assemble 换合并集 |
| 进行中的 run | **不打断**（与现网模型热配一致）；该 run 继续用装配时的 ToolPort 快照 |

实现要点：`assembleRuntime` 拿到的应是 **immutable 工具快照**（或 per-run 绑定的 Composite），避免 run 中途 list 突变。

### 5.3 重连

- 子进程非预期退出 → 标记 `error`；可选 **有限次**自动重连（建议：指数退避，最多 3 次，常量写死）。  
- 重连成功 → `refreshTools()`。  
- 进行中 run 已持有的旧 Port：调用返回明确 tool error（「MCP server unavailable」），不崩 Runner。

### 5.4 工具列表刷新

- 连接成功时 `tools/list` 一次。  
- 设置页「刷新」按钮 → `refreshTools()`（可选本切片；若做，只刷新该 server）。  
- **不**实现 MCP `notifications/tools/list_changed` 订阅（可列为增强）。

### 5.5 关闭

- Server shutdown / 进程信号 → `McpSupervisor.shutdown()`：**杀掉进程树**（防泄漏，总规格 §9）。  
- Desktop 退出拉停 Server 时走同一路径。

### 5.4 错误策略（对齐总规格 §5.4）

| 场景 | 策略 |
|------|------|
| initialize / list 失败 | 该 server error；其它 server 与 builtin 不受影响 |
| `callTool` 抛错 / 超时 | 捕获为 tool result 字符串回模型；记 Trace；run 继续 |
| 未知工具名 | `ToolPort.execute` 抛错 → Runner 既有路径 |
| 配置非法 | `PUT /config` 拒绝；保留上一份有效配置 |

---

## 6. 权限与 Trace 挂钩

### 6.1 权限

```text
模型 tool_call name = "filesystem__read_file"
  → evaluatePermission({ toolName: "filesystem__read_file", ... })
  → ask_all：权限卡标题「工具权限请求 · filesystem__read_file」
  → allowlist：须包含完整名
  → default：当前仍 auto-allow（与 builtin 相同；细分策略另案）
  → allow → ToolPort.execute("filesystem__read_file", args)
```

- 「本会话允许」按 **完整工具名** 豁免（既有 Broker），不按 server 整包豁免（避免过宽；若产品要「信任整个 server」列为后续）。  
- MCP 不新增 permission WS 类型。

### 6.2 Trace / UI

| 事件 | 期望 |
|------|------|
| `tool_start` / `tool_end` | `name` = 命名空间名；Desktop 工具卡原样展示 |
| Trace Timeline | `kind: "tool"` span，名称可读 |
| 连接失败 | 设置页状态；**不必**为连接失败写 trace span（非 run 内） |
| permission | 沿用 ask_all；permission span 仍为既有半落地债，本切片不强制修 |

---

## 7. 与 Memory / OpenViking 的边界

| 层 | 本切片 | P2.1 / P2.5 |
|----|--------|-------------|
| MCP Tools 管道 | ✅ | — |
| HTTP/SSE transport | ❌ | P2.1（OpenViking 默认 `http://localhost:1933/mcp`） |
| 配置示例 `mcpServers.openviking` | 文档可预留注释；**本切片不实现 HTTP** | P2.5 做实 |
| `MemoryPort` / RSI 提炼 / Hooks auto-recall | ❌ | 见 `2026-09-19-rsi-memory-design.md` |
| `packages/core` 依赖 OpenViking | **禁止**（总规格已定） | 永远禁止直依赖 |

原则：**记忆是 MCP 之上的产品能力**；本规格只保证「能挂任意 MCP 工具源」，不实现记忆语义。

---

## 8. 分阶段交付

### 8.1 P2（本规格）— 可演示的「完整」主路径

1. `packages/mcp`：stdio Client + `McpServerSession` + 命名空间 ToolPort。  
2. `McpSupervisor` + Server 启动/关闭/reconcile。  
3. `assembleRuntime` 合并 builtin ⊕ MCP。  
4. Zod 小扩展（`env` / `enabled` 等，按需）+ 配置诚实。  
5. 设置页 MCP CRUD + 状态。  
6. 测试：单元（命名空间、合并冲突）+ Server 集成（mock 或 fixture stdio server）+ 手工/脚本挂真实 filesystem MCP。  
7. 短学习笔记：走读 MCP → ToolPort。

### 8.2 P2.1 — transport 增强（独立小规格/plan）

- Streamable HTTP / SSE（或 SDK 当时推荐的远程 transport）。  
- 为 OpenViking 铺路；设置页 URL 字段。

### 8.3 P2.5 — OpenViking 记忆（既有意向）

- 文档 + 示例配置；可选 `MemoryPort` 薄门面。  
- **不**阻塞在 P2 验收之外宣称「记忆已完成」。

### 8.4 更后

- `tools/list_changed`、Resources/Prompts、整 server 信任、OAuth、Sidecar 同构 Supervisor 复用。

---

## 9. 验收标准

### 9.1 功能

1. 配置一个 stdio MCP（示例：filesystem）并加入 `tools.mcpServers`，保存成功。  
2. 新 run 中模型可见 `server__…` 工具（经 Provider 的 tools 列表）。  
3. 成功调用至少一次；Desktop 出现工具卡；Trace 有对应 tool span。  
4. `ask_all` 下对 MCP 工具弹出权限卡，允许后执行、拒绝后 tool error 回模型。  
5. 删除/禁用 server 后，新 run 不再暴露其工具；子进程被回收。  
6. 无 MCP 配置时，行为与合入前一致（回归 `pnpm test` 全绿）。  
7. Server 退出无残留 MCP 子进程（抽查）。

### 9.2 工程

1. `packages/core` 的 `package.json` **无** `@modelcontextprotocol/sdk` 依赖。  
2. `assembleRuntime`（或等价）消费 `tools.mcpServers`；不再静默忽略。  
3. 默认测试套件含 MCP 相关单测/集成测（可用 mock transport 或轻量 fixture，避免强制外网 `npx`）。

### 9.3 非验收（本切片不要求）

- OpenViking 读写记忆。  
- HTTP MCP。  
- 设置页美化为「市场」。  
- `default` 权限对 MCP 更严。

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| stdio 子进程泄漏 / 僵尸 | shutdown 钩子 + 进程树；集成测或手工 `ps` 抽查 |
| `npx` 冷启动慢 | 设置页展示 connecting；超时后 error；文档建议全局安装或固定路径 |
| 工具名过长 / Provider 限制 | 保持 `{server}__{tool}`；server key 宜短；遇硬限制再开别名机制（后置） |
| 热更与进行中 run 竞态 | per-run 工具快照；reconcile 不杀正在被旧 Port 使用的进程直到 run 结束（或 close 后 execute 返回明确错误） |
| Schema 再变宽（HTTP 字段） | P2.1 再扩 Zod；本切片不提前加 URL 以免再次「宽于装配」 |
| SDK API 变动 | 锁版本；适配集中在 `packages/mcp` |
| 安全：MCP 等同本地代码执行 | 文档警告；依赖 ask_all / 日后 default 细分；不自动信任未知 command |

---

## 11. 开放问题（需用户拍板）

| ID | 问题 | 建议默认 |
|----|------|----------|
| **Q1** | 未加入 `tools.mcpServers` 的顶层 server：是否仍预连接？ | **预连接**（设置页能看到 ready/error）；仅引用者进入 Agent `list()` |
| **Q2** | 引用的 server 全部 `error` 时，新 run 是否拒绝启动？ | **允许启动**（仅 builtin），设置页/日志警告；避免因一个坏 MCP 完全不能聊 |
| **Q3** | P2 是否包含设置页「刷新工具列表」按钮？ | **要**（低成本）；`list_changed` 订阅不要 |
| **Q4** | `env` 敏感值存储：进 `config.yaml` 还是 credentials 侧？ | **非密钥 env 可进 config**；类 API Key 的值走现有 credentials 引用机制（若 P2 来不及，可先只支持非密 env，密钥后置） |
| **Q5** | 示例 MCP：文档默认推荐哪个？ | `@modelcontextprotocol/server-filesystem` + 用户 workspace 路径 |

未回复前，实现 plan 按「建议默认」锁定；用户异议再改规格。

---

## 12. 供 writing-plans 分期（预告，非本 PR 任务）

> 以下仅拆期提示；**不要**在本 PR 实现。确认规格后另开 `docs/superpowers/plans/2026-09-26-mcp-toolport.md`（或当日）。

| Task | 内容 | 建议测试 |
|------|------|----------|
| 1 | `packages/mcp` 脚手架：依赖 SDK、`McpServerSession` stdio、命名空间 list/execute | 单测 mock |
| 2 | `McpSupervisor` reconcile / shutdown | 单测 |
| 3 | `assembleRuntime` 合并 + 冲突检测；Server 启动挂 Supervisor | Server 集成 |
| 4 | Zod 可选字段 + PUT 后 reconcile；status API | shared + server 测 |
| 5 | 设置页 MCP CRUD + 状态 | Desktop 组件测 / 手工 |
| 6 | ask_all + Trace 回归（MCP 名） | 扩展现有 runs 测或 fixture |
| 7 | 文档：README `packages/mcp`、学习短记、总规格状态回写 | — |
| 8 | 手工冒烟清单：filesystem MCP 真连 | 学习笔记勾选 |

合入策略：分支 `feat/mcp-toolport`（或 `cursor/…`），自最新 `main`；合并前 `pnpm test` 全绿。

---

## 13. 后续（明确不在本规格交付）

- P2.1 HTTP transport → P2.5 OpenViking  
- Resources / Prompts / Sampling  
- 整 server 会话级信任、OAuth  
- Sidecar Supervisor 与 MCP 进程管理复用  
- `default` 权限细分（含「MCP 默认询问」）
