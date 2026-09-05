# Agent Runtime + Electron 工作台 — 设计规格

**日期：** 2026-09-05  
**状态：** 已确认；P0 实现计划已就绪（见 `docs/superpowers/plans/2026-09-05-agent-runtime-p0.md`）  
**定位：** 可插拔 Agent Runtime / 框架；桌面端为第一成品形态

---

## 1. 目标与非目标

### 1.1 目标

- 交付可用的 **本地 Agent 运行时**，支持可配置的 **LLM Provider** 与 **MCP** 工具协议。
- 以 **Electron Agent 工作台** 作为第一对外成品（对话 + 工具过程可视化 + 配置）。
- 架构可扩展：预留 **A2A / AgentPeer** 扩展点；Python 作为可选 **Tool Sidecar**。
- 开发过程本身是学习路径：自研 Agent loop、Provider 适配、MCP、权限/Hooks、跨语言工具、桌面壳与 Server 分离。

### 1.2 非目标（v1 整段不做）

- 不绑定 Vercel AI SDK / Mastra / OpenAI Agents SDK 作为内核（可参考其思路，不依赖其 runtime）。
- 不做 A2A 实装（仅 Port + stub）。
- 不做图编排引擎（LangGraph 风格后置）。
- 不做重度编程 Agent / LSP 闭环。
- 不做多用户账号、云同步、插件市场、应用商店级自动更新体系。

---

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| 产品形态 | Agent 运行时 / 框架 + Electron 工作台 |
| 协议优先级 | Provider + MCP 先行；A2A 仅扩展点 |
| 语言 | TypeScript 主运行时；Python 可选 Tool Sidecar |
| 进程模型 | Electron 壳 ↔ 本地 Agent Server（HTTP/WS） |
| 内核策略 | 尽量自研 loop；官方 MCP SDK + 各厂 HTTP API |
| 默认 Agent | 通用对话 + MCP + 少量内置工具（非编程主打） |
| 架构路线 | 方案 1：分层内核（Ports & Adapters）+ 分阶段交付 |
| 本机 Server | **Fastify**（HTTP + WebSocket 插件）；只做传输与装配，业务在 `core` |
| 桌面 UI 组件库 | **shadcn/ui + Radix + Tailwind**；组件源码进仓，以可定制为主 |
| 桌面 UI 实现方 | 视觉/页面由用户后续提供；工程侧先定栈与 API 契约，可用占位 UI |

---

## 3. 总体架构与数据流

### 3.1 原则

Electron **只做 UI 与进程守护**；本机 **Agent Server** 持有会话与编排；`core` 跑自研 ReAct 循环，经 Port 调用模型与工具。MCP 与 Python Sidecar 均挂到统一 `ToolPort`。A2A 预留 `AgentPeerPort`。

### 3.2 结构图

```text
┌─────────────────────────────────────────────────────────┐
│  apps/desktop (Electron)                                 │
│  对话 · 流式展示 · 工具调用时间线 · Provider/MCP 配置 UI   │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP + WebSocket (本机)
┌──────────────────────────▼──────────────────────────────┐
│  packages/server                                         │
│  REST: sessions/config · WS: run events · 组装 core       │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  packages/core                                           │
│  Runner(ReAct) · Permissions · Hooks · Session · Trace   │
│  Ports: ModelPort │ ToolPort │ SessionStore │ TracePort  │
│         AgentPeerPort (stub)                             │
└─────────────┬────────────────────────────┬───────────────┘
              │                            │
     ┌────────▼────────┐          ┌────────▼────────────┐
     │ packages/       │          │ Tool 适配器聚合      │
     │ providers       │          │ · builtin           │
     │                 │          │ · packages/mcp      │
     └─────────────────┘          │ · sidecar-python    │
                                  └─────────┬───────────┘
                                            │ stdio JSON-RPC
                                   ┌────────▼────────┐
                                   │ Python Worker   │
                                   └─────────────────┘
```

### 3.3 主路径（一次用户发送）

1. UI 经 HTTP/WS 提交消息 → Server 创建/恢复 Session。  
2. Runner 组装 messages（系统提示 + 历史 + 工具 schema）。  
3. 经 `ModelPort` 流式调用当前 Provider。  
4. 若有 `tool_calls`：权限闸门 → Hooks → `ToolPort.execute` → 结果写回 Session → 继续循环。  
5. 全程推送 Trace/事件到 UI。  
6. 最终助手文本结束本轮并持久化。

### 3.4 刻意约束

- Runtime **不**跑在 Electron renderer。  
- 第一版 **不**实装 A2A。  
- 第一版 **不**上图编排引擎。

---

## 4. 包/模块职责与配置模型

### 4.1 Monorepo

建议：**pnpm workspace + Turborepo**。

| 包/应用 | 职责 | 依赖边界 |
|--------|------|----------|
| `packages/core` | Agent 定义、Runner、权限、Hooks、消息类型、Port 接口 | 无具体 I/O 实现 |
| `packages/providers` | `ModelPort` 实现（OpenAI 兼容、Anthropic 等） | 只依赖 core 类型/Port |
| `packages/mcp` | MCP Client：多 server、发现、命名空间、传输 | `@modelcontextprotocol/sdk` |
| `packages/sidecar-python` | TS Supervisor + Python worker 脚手架 | 对 core 表现为 Tool 来源 |
| `packages/server` | **Fastify** 本机 HTTP/WS、装配、配置热加载、子进程生命周期 | 不依赖 Electron；不承载 Agent 业务逻辑 |
| `packages/shared` | DTO、事件 schema、配置 Zod 类型 | server + desktop 共用 |
| `apps/desktop` | Electron 壳 + 工作台 UI | 仅经 HTTP/WS 通信 |
| `apps/cli` | 可选后置；证明壳可替换 | 同一 Server API |

### 4.2 配置模型

配置根：全局 `~/.agent2026/config.yaml`；可选项目覆盖 `<workspace>/.agent2026/config.yaml`。

示意：

```yaml
providers:
  default: openai
  entries:
    openai:
      type: openai_compatible
      baseUrl: https://api.openai.com/v1
      apiKeyEnv: OPENAI_API_KEY
      models: [gpt-4.1]
    anthropic:
      type: anthropic
      apiKeyEnv: ANTHROPIC_API_KEY

agents:
  default:
    model: openai/gpt-4.1
    systemPrompt: "..."
    tools:
      builtin: [http_fetch, read_file]
      mcpServers: [filesystem, brave]
      sidecars: []

mcpServers:
  filesystem:
    transport: stdio
    command: npx
    args: [-y, "@modelcontextprotocol/server-filesystem", "/path"]

permissions:
  mode: default   # default | ask_all | allowlist
  allowlist: []

a2a:
  enabled: false
```

### 4.3 装配规则

- 启动：读配置 → Provider 注册表 → 连接 MCP → 合并 `ToolRegistry`。  
- MCP 工具名：`{server}__{tool}`，避免冲突。  
- UI 保存配置 → `POST /config` → Zod 校验 → 热重载（尽量保留 Session）。  
- 密钥：环境变量 / OS 密钥库引用；**禁止**明文密钥进入可提交的项目配置。

---

## 5. 核心循环、权限、Hooks、错误与可观测性

### 5.1 Runner

```text
用户消息入 Session
  → while turn < maxTurns:
       model.stream(messages, tools)
       → 纯文本：emit deltas → break
       → tool_calls：
            before_tool → permission
            → deny: 错误/拒绝结果写回模型
            → allow: execute → after_tool
            append tool messages → continue
  → persist · emit run_end
```

- **Turn**：一次模型调用 +（可选）一批工具执行。  
- 硬上限：`maxTurns` / `maxToolCalls`。  
- 统一事件：`run_start` · `message_delta` · `tool_start` · `tool_end` · `permission_request` · `error` · `run_end`。  
- 内部统一 `ToolDefinition`（name / description / JSON Schema）；Provider 负责映射到各厂 API。

### 5.2 权限

| 模式 | 行为 |
|------|------|
| `default` | 只读内置可自动；写/网络/MCP 可配置询问或白名单 |
| `ask_all` | 每次工具经 UI 确认（WS 请求/响应） |
| `allowlist` | 仅名单内可执行 |

权限是 **Hooks 之前的强制闸门**；Hooks 不可绕过 deny。

### 5.3 Hooks（第一版）

- `before_model` / `after_model`  
- `before_tool` / `after_tool`  
- 进程内注册 + 配置声明启用；用于日志、红线、谨慎改参。  
- 不做远程插件市场。

### 5.4 错误策略

| 场景 | 策略 |
|------|------|
| Provider 超时/429 | 有限重试 + 退避；失败发 `error`，可重试本轮 |
| 工具抛错 | 捕获为 tool result 回模型；记 Trace；不崩整个 run |
| MCP/Sidecar 宕机 | 标记来源不可用；调用返回明确错误；Supervisor 可重启 sidecar |
| 配置非法 | 拒绝热加载，保留上一份有效配置并提示 |

### 5.5 可观测性

- 每次 run 一个 `traceId`；span：`generation` / `tool` / `permission`。  
- Server 落 SQLite（或 JSONL）；Electron「运行详情」读同一数据。  
- UI 时间线：文本流、工具入参/出参（可折叠）、耗时、token（若有）。

延后：完整 Guardrails 产品化、OpenTelemetry 导出、人机图谱 checkpoint。

---

## 6. Electron 工作台、前端技术栈、持久化

### 6.1 信息架构

```text
┌────────────┬──────────────────────────────┬─────────────────┐
│ 会话列表    │  对话主区（流式）              │ 运行详情 / Trace │
│            │  工具调用卡片 · 输入 · 停止    │ 权限请求         │
├────────────┴──────────────────────────────┴─────────────────┤
│ 设置：Providers · MCP · Agent · 权限 · 数据目录              │
└─────────────────────────────────────────────────────────────┘
```

第一视口以对话为主；配置进设置，避免仪表盘堆砌。

### 6.2 后端与前端技术栈（已定）

**Server（`packages/server`）**

| 层 | 选型 | 说明 |
|----|------|------|
| HTTP 框架 | **Fastify** | 成熟插件生态、类型友好；本地 Agent Server 足够 |
| WebSocket | Fastify 官方/常用 WS 插件（如 `@fastify/websocket`） | 推送 run 事件、权限请求 |
| 校验 | Zod（与 `shared` 配置/DTO 一致）或 Fastify schema | 配置热加载与 API 入参 |
| 边界 | 路由 → 调用 `core` / 适配器 | **禁止**在 route 里写 Agent loop |

**Desktop（`apps/desktop`）**

| 层 | 选型 | 说明 |
|----|------|------|
| 桌面壳 | **Electron** | 守护本地 Server、窗口生命周期 |
| 构建 | **electron-vite**（Vite） | 与 monorepo TS 一致，HMR 友好 |
| UI 框架 | **React 19 + TypeScript** | 流式对话、时间线组件生态成熟 |
| 组件库 | **shadcn/ui（Radix 底层）+ Tailwind CSS** | **源码进仓库**，按需拷贝、可深度改样式与结构；不以「主题皮肤」凑合，而以自定义能力为主 |
| 路由/状态 | 轻量即可（如 React Router + Zustand 或等价） | 不做过早的大型状态框架 |
| 与 Server 通信 | `fetch` + WebSocket；类型来自 `packages/shared` | UI 与协议契约先行 |

**shadcn 使用约定：** 优先改 `components/ui` 源码与 CSS 变量适配工作台视觉；不依赖 Ant Design 等重主题库。占位阶段只用少量 primitives（Button、Input、Dialog、ScrollArea、Sheet 等）。

**协作约定：** 用户后续提供前端 UI（视觉/页面结构）。在此之前：

1. 先稳定 **Server API + WS 事件契约**（`packages/shared`）。  
2. Desktop 使用 **最小可用占位 UI**（能验证流式、工具卡片、配置保存、权限弹层）。  
3. 用户 UI 到位后，按契约替换视图层并继续用 shadcn 做定制，**不改 core/server 行为**。

### 6.3 Electron 职责

- 启动时拉起或探测本机 Agent Server（固定端口或动态端口写入本地状态文件）。  
- Server 崩溃可重启；退出时优雅关闭（含 MCP/Sidecar 子进程）。  
- 密钥优先系统密钥库 / 环境变量。  
- Renderer 不执行模型调用或工具。

### 6.4 持久化

| 数据 | 位置 | 说明 |
|------|------|------|
| 全局配置 | `~/.agent2026/config.yaml` | 热加载；Zod 校验 |
| 密钥 | OS keychain / env | 不进明文可提交配置 |
| Sessions / Messages / Traces | `~/.agent2026/data.sqlite` | Server 写入 |
| 项目覆盖 | `<workspace>/.agent2026/config.yaml` | 可选 |

---

## 7. 分阶段交付

| 阶段 | 范围 | 学习重点 | 可演示结果 |
|------|------|----------|------------|
| **P0 MVP** | 自研 loop + OpenAI 兼容 Provider + 1～2 内置工具 + Server + Electron 占位对话/流式 | Agent 循环、流式、进程拆分 | 能聊并能调内置工具 |
| **P1** | 第二 Provider + 配置 UI + Session 持久化 + Trace 面板 | Provider 适配、配置驱动 | 切换模型、回看历史 |
| **P2** | MCP 多 server + 命名空间 + 权限 ask | MCP 与安全闸门 | 挂真实 MCP 干活 |
| **P3** | Python Sidecar + Hooks | 跨语言工具协议 | TS/Python 工具共存 |
| **P4** | `AgentPeerPort` stub + 文档/示例 | 扩展点设计 | 框架边界清晰 |

### 7.1 P0 成功标准

1. 启动桌面端可打开工作台，并自动拉起本地 Server。  
2. 配置一个 OpenAI 兼容 endpoint 即可流式对话。  
3. 至少一个内置工具跑通，UI 可见 tool 卡片。  
4. 停止按钮可中断当前 run。  
5. Sessions 写入 SQLite；重启 App 后会话与消息仍在。

说明：Trace 面板的完整 UI 可在 P1 打磨，但 P0 必须已落库 `traceId` 与基本 span，便于联调。

---

## 8. 从开源吸收的要点（设计约束）

- **MCP ≠ A2A**：工具协议与 Agent 协作协议分层。  
- **Harness 即产品**：loop、权限、事件、可观测性是一等公民。  
- **少原语**：Agent / Tools / Permissions / Hooks / Trace（对齐 OpenAI Agents SDK 的克制）。  
- **最小内核可扩展**：对齐 Pi 的扩展哲学，避免第一天插件宇宙。  
- **壳与 Server 分离**：对齐 OpenCode，便于日后 CLI/其他客户端。  
- **Sidecar**：JSON-RPC + stdio（与 MCP 传输同构），Supervisor 管生命周期。  
- **Memory**：需要时作为可插拔模块，不把整个 runtime 锁成 memory OS（Letta 教训）。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 自研 Provider 适配工作量大 | P0 只做 OpenAI 兼容（覆盖多数网关）；P1 再加 Anthropic |
| Electron + Server 双进程调试复杂 | 统一日志目录；server 可独立 `pnpm dev:server` |
| 用户 UI 后到导致返工 | `shared` 事件/DTO 先冻结；占位 UI 只依赖契约 |
| MCP 子进程泄漏 | Server shutdown 钩子 + 进程树清理 |
| 过度抽象 | 坚持方案 1；不为「万物 Adapter」重构 Port |

---

## 10. 下一步

1. ~~用户确认本 spec。~~  
2. 初始化 git 仓库并提交 docs（实现 Task 1 时完成）。  
3. ~~writing-plans~~ → 执行 `docs/superpowers/plans/2026-09-05-agent-runtime-p0.md`（按 Task 断点推进）。
