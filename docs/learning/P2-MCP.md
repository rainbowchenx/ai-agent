# P2 — MCP Client → ToolPort

**日期：** 2026-09-26  
**规格：** `docs/superpowers/specs/2026-09-26-mcp-toolport-design.md`  
**计划：** `docs/superpowers/plans/2026-09-26-mcp-toolport.md`

## 架构走读（带走）

1. **官方 SDK 只在 `packages/mcp`**  
   `@modelcontextprotocol/sdk` 的 `Client` + `StdioClientTransport` / `StreamableHTTPClientTransport` / `SSEClientTransport` 全部关在 mcp 包。`core` 只有 `ToolPort` / `CompositeToolPort`，不知道 MCP。

2. **命名空间**  
   对外工具名 `{serverName}__{toolName}`。Runner / 权限闸门 / Trace 只看见字符串，不感知来源。

3. **进程级 Supervisor + per-run 快照**  
   `McpSupervisor` 在 Server 进程里 reconcile：`enabled:false` 断开；`enabled:true` **预连**（即使未挂载，设置页可看工具）。`assembleRuntime` 只合并 `enabled ∩ agents.default.tools.mcpServers ∩ ready`。进行中 run 不热换工具集。

4. **配置诚实**  
   Zod 判别联合 `stdio | http` + `enabled`；装配真正消费 `mcpServers`。挂载全 error 仍允许 run（仅 builtin）+ 警告（Q2）。HTTP headers GET 掩码，PUT 回写时保留未改动的密钥。

5. **设置页**  
   Desktop 只调 `GET/PUT /config`、`GET /mcp/status`、`POST /mcp/:name/refresh`；Renderer 永不 spawn MCP。

```text
Desktop 设置 CRUD
    → PUT /config → ConfigService.onChange → McpSupervisor.reconcile
    → GET /mcp/status（状态 + 发现工具）
assembleRuntime
    → builtin ⊕ mounted ready MCP ports → CompositeToolPort → Runner
```

## 手工冒烟清单

- [ ] 设置添加 filesystem stdio（`npx -y @modelcontextprotocol/server-filesystem <workspace>`）→ 启用 → 见 ready + 工具列表 → 对话调用 → 工具卡显示 `filesystem__…`
- [ ] 禁用 → 工具消失；再启用恢复
- [ ] 添加 HTTP：CI mock 或本机 OpenViking `http://localhost:1933/mcp` → 同上
- [ ] 权限模式 `ask_all` 下点允许 / 拒绝各一次（工具名为 `server__tool`）
- [ ] Server 退出后无残留 MCP 子进程（`ps` 抽查）

## 最短试用路径

### stdio

1. 启动 Server + Desktop。  
2. 设置 → MCP → 添加：transport=`stdio`，command=`npx`，args 每行：`-y` / `@modelcontextprotocol/server-filesystem` / `<绝对路径>`；勾选启用 + 挂载 Agent。  
3. 保存 → 看状态 `就绪` → 展开工具。  
4. 新开对话，让模型调用某个 `filesystem__…` 工具。

### HTTP

1. 本机有 MCP HTTP endpoint（例：OpenViking `http://localhost:1933/mcp`），或跑包内 mock。  
2. 设置 → 添加：transport=`http`，url=…，方言默认 Streamable；可选 headers。  
3. 启用 + 挂载 → 刷新工具 → 对话调用 `name__tool`。

## 参考了谁 / 为何如此

| 参考 | 取舍 |
|------|------|
| MCP 官方 TypeScript SDK | 不自研 wire；transport 跟 SDK 走 |
| DeepSeek Harness「编排可观测」理念 | Trace/权限沿用既有环，不另造 MCP 仪表盘 |
| 产品原则「轻量核心 + Port」 | SDK 不进 core；Supervisor 在 server |

## 自动化覆盖

- `packages/shared`：stdio/http Zod  
- `packages/mcp`：namespace、stdio mock、HTTP streamable fixture  
- `packages/core`：CompositeToolPort 冲突  
- `packages/server`：Supervisor、assemble、status/refresh、掩码、ask_all+Trace 集成
