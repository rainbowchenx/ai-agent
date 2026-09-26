# MCP Client → ToolPort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户可在设置页完整 CRUD / 启停 MCP（stdio + HTTP），经官方 SDK 连接并发现工具，合并进统一 `ToolPort`（`{server}__{tool}`），对话工具卡与 Trace 可见；禁用即断开且不进工具表。

**Architecture:** `packages/mcp` 仅依赖 `@modelcontextprotocol/sdk`，提供 stdio/HTTP session + 命名空间 ToolPort；Server `McpSupervisor` 进程级 reconcile；`assembleRuntime` 合并 builtin ⊕（enabled∩挂载∩ready）；Desktop 设置区展示状态与工具列表；Runner / 权限 / Trace 不感知 MCP 来源。

**Tech Stack:** TypeScript monorepo、pnpm workspace、`@modelcontextprotocol/sdk`、Zod/`AppConfig`、Fastify、Vitest、React/Zustand Electron desktop

**Spec:** `docs/superpowers/specs/2026-09-26-mcp-toolport-design.md`（**已确认**；Q1–Q8 已锁定）

## UI Reference

| 项 | 值 |
|----|-----|
| Figma | https://www.figma.com/design/6mxCXcFGVyupqTTKbZD7GF/myagent?node-id=19-3 |
| `fileKey` | `6mxCXcFGVyupqTTKbZD7GF` |
| 整页 `nodeId` | `19:3` |
| MCP 分区 `nodeId` | `19:379`（Section E: MCP） |
| 对齐范围 | Desktop 设置 → MCP 列表/工具栏视觉；CRUD / enabled / status / 工具展开 / stdio·http 表单字段语义不变；不重做设置壳与后端 |

## Learning goals（本切片带走）

1. MCP Client 与 `ToolPort` 适配：SDK session → `list`/`callTool` → 命名空间。  
2. 装配层合并多工具来源，保持 `core` 无 SDK 依赖。  
3. 配置诚实化：Zod 宽表面必须被 Supervisor / assemble 消费。  
4. 设置 UX：连接状态与发现工具如何经只读 status API 回流。

**断点（完成 Task 5 后建议停一次）：** stdio fixture 已能经 assemble 进 Runner；再开 HTTP + 设置 UI。  
**断点（完成 Task 8 后）：** 设置 CRUD/启停可用；再补 ask_all 回归与冒烟文档。

## Global Constraints

- **禁止**在 `packages/core` 依赖 `@modelcontextprotocol/sdk`。  
- Transport：**stdio + HTTP** 均在本 plan 验收内；可按 Task 顺序实现，不得删 HTTP 范围。  
- HTTP：默认 **Streamable HTTP**；可选 `httpSubtype: streamable | sse`；CI 用 **mock**，不装 OpenViking。  
- `enabled: false` → 不预连 / 断开，不进 ToolPort。  
- `enabled` 未挂载 → **预连**（Q1）；仅 `tools.mcpServers` 挂载者进 Agent。  
- 挂载全 error → **仍允许 run**（仅 builtin）+ 警告（Q2）。  
- 设置页要「刷新工具」（Q3）；不做 `list_changed`。  
- Headers：GET **掩码**敏感 key；UI 警告勿提交密钥（Q6）。  
- 不实现：插件市场、OAuth 完整流、Resources/Prompts、Memory/OpenViking 语义、`default` 权限细分。  
- 每任务单独 commit；实现分支建议 `feat/mcp-toolport`（自最新 `main`；可与本 docs PR 分支分开）。  
- 进行中 run **不**热换工具集（快照）。

---

## File map

| 文件 | 职责 |
|------|------|
| `packages/shared/src/config.ts` | Zod：`stdio` \| `http` 判别联合、`enabled`、`httpSubtype?`、`headers?`、`env?`、`cwd?` |
| `packages/shared/src/config.test.ts` | 合法/非法配置测 |
| `packages/shared/src/api.ts`（或新 DTO） | `McpServerStatusView` 等 status 响应类型 |
| `packages/mcp/package.json` | `@agent2026/mcp`；依赖 SDK + workspace core/shared 类型所需最小面 |
| `packages/mcp/src/*` | session、namespace、supervisor 核心逻辑（或 supervisor 放 server——见 Task 4） |
| `packages/mcp/README.md` | 替换占位；stdio/HTTP 示例 |
| `packages/core/src/tools/composite-tool-port.ts`（建议） | `CompositeToolPort`：list 拼接、execute 路由、冲突检测 |
| `packages/server/src/mcp/supervisor.ts` | 进程级 reconcile / status / shutdown；调 `@agent2026/mcp` |
| `packages/server/src/assemble/runtime.ts` | 合并 MCP ports |
| `packages/server/src/routes/mcp.ts` | `GET /mcp/status`、可选 `POST /mcp/:name/refresh` |
| `packages/server/src/app.ts` | 挂 Supervisor；config onChange → reconcile；shutdown 钩子 |
| `packages/server/src/routes/config.ts` | PUT 后触发 reconcile；GET 时 headers 掩码（若走 config） |
| `apps/desktop/src/components/settings/settings-page.tsx` | MCP CRUD UI |
| `apps/desktop/src/lib/api.ts` / settings-store | config + status API |
| `docs/learning/P2-MCP.md` | 学习短记 + 手工冒烟清单 |

**已存在可复用：** `ToolPort` / `ToolRegistry` / `createBuiltinToolPort`；`assembleRuntime`；ConfigService 热配；设置页 MCP 占位壳；ask_all Broker；`tool_start`/`tool_end` Trace。

---

### Task 1: Zod 配置演进（stdio \| http + enabled）

**Files:**
- Modify: `packages/shared/src/config.ts`
- Modify: `packages/shared/src/config.test.ts`
- Modify: `packages/shared/src/api.ts`（若需导出 status DTO 可放到 Task 6；本任务至少导出 MCP server 配置类型）

**学习点：** 判别联合如何避免「宽 schema、窄装配」再次发生——字段与 Supervisor 能力同步扩展。

**Interfaces:**
- `mcpServerConfigSchema` = discriminatedUnion on `transport`:
  - `stdio`: `command`, `args`, optional `env`, `cwd`, `enabled`（default true）
  - `http`: `url`, optional `headers`, `httpSubtype` (`streamable`\|`sse`, default `streamable`), `enabled`
- 保留 `agents.default.tools.mcpServers` 引用校验

- [x] **Step 1: 写失败测** — 接受 stdio / http；拒 http 缺 url；拒未知 transport；`enabled` 缺省解析为 true

- [x] **Step 2: 跑测期望 FAIL**

```bash
pnpm --filter @agent2026/shared test
```

- [x] **Step 3: 实现 schema + 更新 `defaultAppConfig`（mcpServers 仍可选空）**

- [x] **Step 4: 跑测期望 PASS**

- [x] **Step 5: Commit** `feat(shared): mcpServers stdio|http zod union with enabled`

---

### Task 2: `packages/mcp` 脚手架 + stdio session + 命名空间

**Files:**
- Create: `packages/mcp/package.json`（name `@agent2026/mcp`，dependency `@modelcontextprotocol/sdk`，workspace 依赖按需）
- Create: `packages/mcp/tsconfig.json`（对齐兄弟包）
- Create: `packages/mcp/src/namespace.ts` — `prefixToolName` / `stripToolPrefix`
- Create: `packages/mcp/src/stdio-session.ts`（或 `session.ts`）
- Create: `packages/mcp/src/index.ts`
- Replace: `packages/mcp/README.md`
- Create: `packages/mcp/src/*.test.ts`
- Modify: 根/`pnpm-workspace` 已含 `packages/*`；确保 turbo 能跑 `pnpm --filter @agent2026/mcp test`

**学习点：** 官方 SDK stdio transport 的 initialize → `listTools` → `callTool`；适配为 `ToolPort`。

**Interfaces:**
- `createStdioMcpSession({ name, command, args, env?, cwd? }): Promise<McpServerSession>`
- `session.asToolPort(): ToolPort`（list/execute 使用 `{name}__{tool}`）
- **禁止** core 引用本包中的 SDK 类型泄漏到 core 公共 API

- [x] **Step 1: 脚手架 package + 依赖 SDK；导出空模块可 build/test**

- [x] **Step 2: 命名空间单测**（prefix/strip/冲突边界）

- [x] **Step 3: stdio session — 优先用 mock Client（不强制真 npx）；断言 list 带前缀、execute 去前缀调用**

- [x] **Step 4: README 写清：仅 SDK、示例 filesystem command**

- [x] **Step 5: Commit** `feat(mcp): stdio session and namespaced ToolPort via official SDK`

---

### Task 3: HTTP session（Streamable 默认 + SSE 选项）

**Files:**
- Create/Modify: `packages/mcp/src/http-session.ts`
- Modify: `packages/mcp/src/index.ts`
- Create: `packages/mcp/src/http-session.test.ts`
- Optional fixture: `packages/mcp/src/test/mock-http-mcp.ts`（轻量 mock，供本包与 server 测）

**学习点：** SDK Streamable HTTP vs SSE Client transport 差异；失败时的 status/error 表面。

**Interfaces:**
- `createHttpMcpSession({ name, url, headers?, httpSubtype? })`
- 默认 `httpSubtype: "streamable"`；`"sse"` 走 SSE transport（class 名以安装的 SDK 版本文档为准，实现时写进 README）

- [x] **Step 1: mock HTTP MCP fixture（CI 无外网）**

- [x] **Step 2: 写测 — streamable 连接 → list 带前缀 → callTool**

- [x] **Step 3: 实现 HTTP session；可选：streamable 失败再试 sse（若做，单测覆盖开关）**

- [x] **Step 4: Commit** `feat(mcp): HTTP MCP session (streamable default, sse option)`

---

### Task 4: `CompositeToolPort` + `McpSupervisor`

**Files:**
- Create: `packages/core/src/tools/composite-tool-port.ts` + test（**无 SDK**）
- Export from `packages/core/src/index.ts`
- Create: `packages/server/src/mcp/supervisor.ts` + test  
  （会话创建调用 `@agent2026/mcp`；Supervisor 放 server 以便用 Config/credentials resolve）
- Modify: `packages/server/package.json` — dependency `@agent2026/mcp`

**学习点：** 多 Port 合并与冲突失败；enabled 短路与预连（Q1）。

**Interfaces:**
- `createCompositeToolPort(ports: ToolPort[]): ToolPort` — 构造期或首次 list 检测重名则 throw
- `McpSupervisor.reconcile(config)` / `getStatus()` / `refreshTools(name)` / `getPort(name)` / `shutdown()`
- reconcile：`!enabled` → close + disabled；enabled → 连接（无论是否挂载）；status 含 tools[]

- [x] **Step 1: Composite 单测 — 合并 list、路由 execute、撞名抛错**

- [x] **Step 2: Supervisor 单测 — enabled false 不连；true 预连；shutdown 清理（mock session 工厂注入）**

- [x] **Step 3: 实现**

- [x] **Step 4: Commit** `feat: CompositeToolPort and McpSupervisor reconcile/shutdown`

---

### Task 5: 装配接线 + Server 生命周期  ★ 断点

**Files:**
- Modify: `packages/server/src/assemble/runtime.ts` + `runtime.test.ts`
- Modify: `packages/server/src/app.ts`（创建 Supervisor；`configService.onChange` → reconcile；onClose shutdown）
- Modify: `packages/server/src/routes/runs.ts`（若 assemble 需传入 supervisor 快照）
- Update: `AssembleRuntimeInput` 增加 `mcp?: McpSupervisor` 或 `extraTools?: ToolPort`

**学习点：** 每 run 工具快照 vs 进程级连接池。

**行为：**
- 合并：builtin ⊕ 对每个 `tools.mcpServers` 名取 ready port  
- 挂载全 error：不 throw；仅 builtin（Q2）；可 `console.warn` / 日志  
- PUT config 后 reconcile；**不**打断进行中 run

- [x] **Step 1: runtime 测 — 挂载 mock ready port → list 含 `svc__x`；disabled/未挂载不含**

- [x] **Step 2: 实现 assemble + app 接线**

- [x] **Step 3: `pnpm --filter @agent2026/server test` 相关文件 PASS**

- [x] **Step 4: Commit** `feat(server): assemble MCP tools into runtime ToolPort`

- [x] **Step 5: 断点自检** — 用 fixture stdio 或 mock：新 run 模型 tools 含命名空间名（集成测或临时脚本）

---

### Task 6: `GET /mcp/status` + 刷新 + GET 掩码

**Files:**
- Create: `packages/server/src/routes/mcp.ts` + test
- Modify: `packages/server/src/app.ts` 注册路由
- Modify: `packages/shared/src/api.ts` — `McpServerStatusView` 类型
- Modify: config GET 路径 — 对 `mcpServers.*.headers` 中 Authorization / 匹配 `auth|token|secret` 的 key **掩码**（Q6）

**Interfaces:**
- `GET /mcp/status` → `McpServerStatusView[]`（name, enabled, transport, status, toolCount, tools[{name,description?}], lastError?）
- `POST /mcp/:serverName/refresh` → 调用 `refreshTools`（Q3）

- [x] **Step 1: 路由测 — status 形状；refresh 触发**

- [x] **Step 2: 掩码测 — GET config 不回显明文 Authorization**

- [x] **Step 3: 实现**

- [x] **Step 4: Commit** `feat(server): MCP status/refresh APIs and header masking`

---

### Task 7: 设置页完整 CRUD + 启停 + 展示

**Files:**
- Modify: `apps/desktop/src/components/settings/settings-page.tsx`（替换 MCP 占位）
- Modify: `apps/desktop/src/stores/settings-store.ts`（或等价）
- Modify: `apps/desktop/src/lib/api.ts` — `getMcpStatus` / `refreshMcp`
- Modify: `apps/desktop/src/styles.css`（必要时，保持现有 settings 视觉语言，避免重做整壳）

**学习点：** 设置只调本机 API；Renderer 永不 spawn MCP。

**UI 最低集：**
- 列表：名、transport、摘要（command/url）、enabled 开关、状态、工具数  
- 展开：发现的工具（`server__tool` + description）  
- 新增/编辑表单：stdio vs http 字段；挂载到默认 Agent 勾选  
- 删除；刷新按钮；保存走现有 PUT `/config`  
- 敏感 headers：输入可写；展示掩码/占位；警告文案

- [x] **Step 1: API 客户端 + store 拉 status（保存后/进入分区时刷新）**

- [x] **Step 2: 替换「即将支持」为 CRUD UI**

- [x] **Step 3: Desktop 测或手工清单勾选（组件测能盖 store 即可）**

- [x] **Step 4: Commit** `feat(desktop): MCP settings CRUD, enable toggle, status and tools`

---

### Task 8: 权限 / Trace 回归  ★ 断点

**Files:**
- Extend: `packages/server/src/routes/runs.test.ts`（或新 `mcp-runs.test.ts`）
- 确认 Desktop 工具卡 / 权限卡无需改契约（工具名字符串即可）

**行为：**
- mock model 调 `mcpdemo__echo` → ask_all 收到 `permission_request.toolName === "mcpdemo__echo"`  
- allow → `tool_start`/`tool_end` 同名；Trace span `kind: "tool"`

- [x] **Step 1: 集成测覆盖 ask_all + tool span 名称**

- [x] **Step 2: `pnpm --filter @agent2026/server test` PASS**

- [x] **Step 3: Commit** `test(server): MCP tool names through permission and trace`

---

### Task 9: 冒烟清单 + 学习短记 + 文档回写

**Files:**
- Create: `docs/learning/P2-MCP.md`
- Modify: `packages/mcp/README.md`（补 HTTP mock / OV 手工例 URL）
- Modify: `docs/superpowers/specs/2026-09-26-mcp-toolport-design.md`（状态可加「实现中/已实现」当代码合入时——本 Task 执行时再改）
- Optional: `scripts/smoke-mcp.ts` + root `package.json` `smoke:mcp`（mock HTTP + 可选跳过真 npx）

**手工冒烟（写入学习笔记）：**
1. 设置添加 filesystem stdio → 启用 → 见 ready + 工具列表 → 对话调用 → 工具卡  
2. 禁用 → 工具消失；再启用恢复  
3. 添加 HTTP mock/OV URL → 同上  
4. ask_all 下点允许/拒绝各一次  
5. Server 退出后无残留 MCP 子进程（`ps` 抽查）

- [x] **Step 1: 写 `P2-MCP.md`（架构走读 + 冒烟勾选）**

- [x] **Step 2: 全量 `pnpm test` 期望全绿**

- [x] **Step 3: Commit** `docs: P2 MCP learning notes and smoke checklist`

---

### Task 10: 收尾（README 占位清理 + 规格状态）

**Files:**
- 确认无「即将支持」残留于 MCP 分区  
- 规格状态 → 已实现（合入 main 时）  
- 总规格 §7 P2 行如需勾选说明可一句回写

- [x] **Step 1: 文档一致性检查**

- [x] **Step 2: Commit** `docs: mark MCP toolport slice implemented`（仅在代码已合入后）

---

## 建议执行顺序（给用户确认）

```text
1 Zod
2 mcp stdio + 命名空间
3 mcp HTTP
4 CompositeToolPort + Supervisor
5 assemble + Server 生命周期     ← 断点：后端主路径可测
6 status/refresh API + 掩码
7 设置页 CRUD/启停/展示
8 权限 + Trace 回归               ← 断点：产品环可演示
9 学习笔记 + 冒烟
10 文档收尾（随代码合入）
```

并行机会：Task 1 ∥ 起盘 Task 2 脚手架；Task 7 可在 Task 6 契约冻结后与 Task 8 部分并行。

---

## Self-review (plan vs spec)

| Spec 要求 | Task |
|-----------|------|
| 官方 SDK only in `packages/mcp` | 2, 3 |
| stdio + HTTP 验收 | 2, 3, 5, 9 |
| 命名空间 ToolPort + 合并 | 2, 4, 5 |
| enabled 启停 / 预连 Q1 / 全 error Q2 | 4, 5, 7 |
| 设置 CRUD + 状态 + 工具列表 + 刷新 | 6, 7 |
| Headers 掩码 Q6；httpSubtype Q7；mock Q8 | 1, 3, 6, 9 |
| 权限 / Trace | 8 |
| 配置诚实、无静默忽略 | 5 |
| 非目标 Memory/市场/OAuth | Global Constraints |

无 TBD 阻塞实现。SDK 具体 class 名在 Task 2/3 按锁定版本写入 README，不反向改规格决策。
