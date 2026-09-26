# P0 概念地图：从 Enter 到 `tool_end`

**目的：** 5 分钟内讲清「用户按回车 → 工具卡片出现」的文件级调用链。  
**架构关键词：** Port / Runner / Event / Session

---

## 架构分层（一图）

```text
┌─────────────────────────────────────────────────────────────┐
│  apps/desktop (Electron Renderer)                           │
│  Composer → session-store → ws-client → apply-run-event     │
│  tool-card / message-bubble (RunEvent 投影)                 │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP REST + WS /ws
┌───────────────────────────▼─────────────────────────────────┐
│  packages/server (Fastify 装配根)                            │
│  routes/runs → assemble/runtime → ws/map-run-event        │
│  store/sqlite-session-store + sqlite-trace-port             │
└───────────────────────────┬─────────────────────────────────┘
                            │ ModelPort / ToolPort
┌───────────────────────────▼─────────────────────────────────┐
│  packages/core (内核)                                        │
│  runner/runner (ReAct) → tools/registry + builtin/*         │
└───────────────────────────┬─────────────────────────────────┘
                            │ SSE / fetch
┌───────────────────────────▼─────────────────────────────────┐
│  packages/providers → openai-compatible.ts (ModelPort)      │
└─────────────────────────────────────────────────────────────┘

契约冻结于 packages/shared：RunEvent、API DTO、AppConfig (Zod)
```

---

## 调用链（Enter → tool_end）

| 步骤 | 层 | 文件 | 做什么 |
|------|-----|------|--------|
| 0 | 壳 | `apps/desktop/electron/main/index.ts` | 启动 `ServerManager`，写 `userData/server.json` |
| 0 | 壳 | `apps/desktop/electron/main/server-manager.ts` | spawn 或复用 `127.0.0.1:8787` |
| 0 | 壳 | `apps/desktop/electron/preload/index.ts` | `contextBridge` 暴露 `getServerBaseUrl()` |
| 1 | UI | `apps/desktop/src/components/chat/composer.tsx` | Enter → `form.requestSubmit()` → `sendMessage` |
| 2 | 状态 | `apps/desktop/src/stores/session-store.ts` | 乐观追加 user 气泡；`RunSocket.sendRun(sessionId, content)` |
| 3 | WS 客户端 | `apps/desktop/src/lib/ws-client.ts` | `createRunMessage` → JSON `{ type:"run", sessionId, content }` |
| 4 | Server | `packages/server/src/routes/runs.ts` | `handleClientMessage` → `startRun` |
| 5 | 持久化 | `packages/server/src/store/sqlite-session-store.ts` | append user message；run 结束 `appendMessagesBatch` |
| 6 | Trace | `packages/server/src/store/sqlite-trace-port.ts` | `startTrace({ runId, sessionId })` → `traceId` |
| 7 | 装配 | `packages/server/src/assemble/runtime.ts` | config → `Runner` + `createOpenAICompatibleModel` + `createBuiltinToolPort` |
| 8 | Hub | `packages/server/src/ws/run-hub.ts` | `create(runId)` → `AbortController`（供 stop） |
| 9 | 内核 | `packages/core/src/runner/runner.ts` | `run_start` → 模型流 → 可选工具循环 |
| 10 | ModelPort | `packages/providers/src/openai-compatible.ts` | SSE → `text_delta` / 聚合 `tool_call` |
| 11 | ToolPort | `packages/core/src/tools/builtin/read-file.ts`（等） | `execute(name, args)` → 字符串结果 |
| 12 | 内核 | `packages/core/src/runner/runner.ts` | `executeToolCall` 发 `tool_start` → 执行 → `tool_end` |
| 13 | 映射 | `packages/server/src/ws/map-run-event.ts` | `RunnerEvent` → shared `RunEvent` |
| 14 | Server | `packages/server/src/routes/runs.ts` | `send(socket, toRunEvent(...))`；最后 `run_end` |
| 15 | UI | `apps/desktop/src/lib/ws-client.ts` | `parseRunEvent` |
| 16 | UI | `apps/desktop/src/lib/apply-run-event.ts` | `tool_start`/`tool_end` → `ChatItem kind:"tool"` |
| 17 | UI | `apps/desktop/src/components/chat/tool-card.tsx` | 可展开工具卡渲染 |

**停止路径（并行）：** `composer` 停止按钮 → `session-store.stopCurrentRun` → `lib/api.ts` `POST /runs/:runId/stop` → `run-hub.abort` → Runner 见 `signal.aborted` → `run_end reason=stopped`。

---

## 四类概念对应文件

### Port（洞）

| Port | 定义 | P0 实现 |
|------|------|---------|
| `ModelPort` | `packages/core/src/ports/model-port.ts` | `packages/providers/src/openai-compatible.ts` |
| `ToolPort` | `packages/core/src/ports/tool-port.ts` | `packages/core/src/tools/registry.ts` + `tools/builtin/*` |
| `SessionStore` | `packages/core/src/ports/session-store.ts` | `packages/server/src/store/sqlite-session-store.ts` |
| `TracePort` | `packages/core/src/ports/trace-port.ts` | `packages/server/src/store/sqlite-trace-port.ts` |
| `AgentPeerPort` | `packages/core/src/ports/agent-peer-port.ts` | stub（P4） |

### Runner（心脏）

- `packages/core/src/runner/runner.ts` — ReAct：`model.stream` → `toolCalls` → `tools.execute` → 再 `model.stream`
- `packages/core/src/runner/types.ts` — `RunnerEvent`（映射前内核事件）
- `packages/core/src/permissions/permission-gate.ts` — P0 默认 auto-allow

### Event（契约）

- `packages/shared/src/events.ts` — `RunEvent` 联合类型（WS 下行）
- `packages/shared/src/api.ts` — REST DTO
- `packages/server/src/ws/map-run-event.ts` — 内核 → shared
- `apps/desktop/src/lib/apply-run-event.ts` — shared → UI 投影

### Session（记忆）

- DB：`packages/server/src/db/schema.ts`、`packages/server/src/db/sqlite.ts`
- API：`packages/server/src/routes/sessions.ts`
- UI：`apps/desktop/src/stores/session-store.ts`、`components/chat/session-list.tsx`

---

## 学习路径（Task 1–12）

```text
T1 分包 → T2 shared 契约 → T3 Ports → T4 Runner
  → T5 builtin tools → T6 Provider → T7 SQLite
  → T8 HTTP API → T9 WS run → T10 Electron 壳 → T11 UI
  → T12 本验收清单 (P0-REVIEW.md)
```

断点笔记：`docs/learning/P0-T01.md` … `P0-T11.md`

---

## 后续切片索引（非 P0）

| 切片 | 规格 | 计划 | 学习笔记 |
|------|------|------|----------|
| P1 Trace | `docs/superpowers/specs/2026-09-19-trace-panel-design.md` | `plans/2026-09-19-trace-panel.md` | `P1-TRACE.md` |
| ask_all | `docs/superpowers/specs/2026-09-20-ask-all-permission-design.md` | `plans/2026-09-20-ask-all-permission.md` | `P2-ASK-ALL.md` |
| **P2 MCP**（规格已确认） | `docs/superpowers/specs/2026-09-26-mcp-toolport-design.md` | `plans/2026-09-26-mcp-toolport.md` | （实现时写 `P2-MCP.md`） |
