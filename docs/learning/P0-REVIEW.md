# P0 验收清单（对照 spec §7.1）

**分支：** `feat/p0-mvp`  
**验收日期：** 2026-09-06  
**验收方式：** 自动化测试（Vitest）+ 代码/提交证据；**未**在本轮跑通带真实 API Key 的完整 Electron GUI 手工冒烟。

---

## 测试总览（2026-09-06 执行）

```bash
pnpm test
```

| 包 | 命令 | 结果 |
|----|------|------|
| `@agent2026/shared` | `vitest run` | **4/4 passed** |
| `@agent2026/core` | `vitest run` | **16/16 passed** |
| `@agent2026/providers` | `vitest run` | **2/2 passed** |
| `@agent2026/server` | `vitest run` | **24/24 passed** |
| `@agent2026/desktop` | `vitest run` | **21/21 passed** |
| **合计** | `turbo run test` | **67/67 passed**（约 4.2s） |

**未纳入默认 CI 的测试：**

- `apps/desktop/electron/main/server-manager.integration.test.ts`（live spawn，需单独跑 `pnpm --filter @agent2026/desktop exec vitest run --config vitest.live.config.ts`）
- 带真实 `OPENAI_API_KEY` 的端到端对话（见 P0-T06 / P0-T09 断点笔记，待本机手工）

---

## §7.1 成功标准逐条

### 1. 启动桌面端可打开工作台，并自动拉起本地 Server

| 项 | 状态 |
|----|------|
| 总体 | **部分通过** — 单元/集成逻辑已测；本轮未手工开 Electron 窗口 |

**证据：**

- Electron 壳 + Server 守护：`067ae31` `feat(desktop): electron shell spawns local agent server`
- 工作台 UI：`88098a3` `feat(desktop): placeholder workbench chat with tool cards`
- `apps/desktop/electron/main/server-manager.ts` — DEV 无 8787 时 spawn `tsx src/index.ts`；已健康则复用
- `apps/desktop/electron/main/server-manager.test.ts` — **10 tests passed**（spawn 计划、健康检查、state 写入）
- 断点笔记：`docs/learning/P0-T10.md`（只开 `pnpm dev:desktop` 应显示 health ok）

**未验证：** 本 Task 12 会话内未启动 Electron 渲染进程目视工作台。

---

### 2. 配置一个 OpenAI 兼容 endpoint 即可流式对话

| 项 | 状态 |
|----|------|
| 总体 | **部分通过** — Mock/SSE 适配器与 WS 流式已测；真实 endpoint 未在本轮验证 |

**证据：**

- Provider 适配：`3791e92` `feat(providers): add OpenAI-compatible model port`
- `packages/providers/src/openai-compatible.test.ts` — SSE `text_delta` 解析 **2/2 passed**
- WS 流式 run：`062afc1` `feat(server): websocket run streaming and stop`
- `packages/server/src/routes/runs.test.ts` — mock `ModelPort` 收到 `run_start` → `message_delta`×N → `run_end completed`
- 配置：`packages/shared/src/config.ts` `defaultAppConfig()` 读 `OPENAI_BASE_URL`；密钥经 `OPENAI_API_KEY`（`.env.example`）
- 装配：`packages/server/src/assemble/runtime.ts` — `apiKeyEnv` → `process.env`

**未验证：** 未配置真实 Key 对兼容网关做 live 流式对话（P0-T09 明确「真模型 smoke 待本机」）。

---

### 3. 至少一个内置工具跑通，UI 可见 tool 卡片

| 项 | 状态 |
|----|------|
| 总体 | **部分通过** — 工具链路与 UI 投影单测通过；未目视 Electron 工具卡 |

**证据：**

- 内置工具：`e5438e0` `feat(core): add read_file and http_fetch builtin tools`
- `packages/core/src/tools/builtin/builtin.test.ts` — **6/6 passed**（含路径穿越拒绝）
- Runner 工具分支：`packages/core/src/runner/runner.test.ts` — `tool_start` / `tool_end` 事件
- Server WS 工具路径：`packages/server/src/routes/runs.test.ts` — mock `tool_call` + `read_file` → `tool_start`/`tool_end`，会话持久化成对消息
- UI 投影：`apps/desktop/src/lib/apply-run-event.test.ts` — **8/8 passed**（tool 卡 `kind: "tool"`）
- UI 组件：`apps/desktop/src/components/chat/tool-card.tsx`；演示按钮 `injectDemoTool`（不调模型）

**未验证：** 真实模型触发 `read_file` 后在 Electron 中展开工具卡（可用 `[data-demo-tool]` 本地演示事件）。

---

### 4. 停止按钮可中断当前 run

| 项 | 状态 |
|----|------|
| 总体 | **部分通过** — Runner/Server/UI 停止链路单测与 WS 集成测通过；未手工点停止按钮 |

**证据：**

- Runner Abort：`d3b4596` `fix(core): harden runner abort and tool-call pairing`；`runner.test.ts` — `run_end.reason === "stopped"`
- Server stop：`062afc1`；`packages/server/src/ws/run-hub.ts` — `AbortController` Map
- `packages/server/src/routes/runs.test.ts`：
  - `POST /runs/:runId/stop aborts the in-flight mock stream` → `run_end.reason = stopped`
  - `after stop-during-tools, GET session has no unpaired toolCalls`
- Desktop：`88098a3` / `0ae6ba3` — `[data-stop-run]` → `POST /runs/:id/stop`；`shouldApplyRunEvent` 按 runId 过滤

**未验证：** Electron 中点击「停止」并目视流中断。

---

### 5. Sessions 写入 SQLite；重启 App 后会话与消息仍在

| 项 | 状态 |
|----|------|
| 总体 | **部分通过** — 持久化与 reload 单测/WS 集成测通过；未重启 Electron 目视 |

**证据：**

- SQLite：`edb1843` `feat(server): sqlite session and trace persistence`
- 默认路径：`~/.agent2026/data.sqlite`（`packages/server/src/db/sqlite.ts`）
- `packages/server/src/store/sqlite-session-store.test.ts` — **7/7 passed**（create → append → reload；trace/span）
- `packages/server/src/routes/runs.test.ts` — run 结束后 `GET /sessions/:id` 含 user + assistant
- 消息先于 `run_end` 落库：`d9a3f92` `fix(server): persist run messages before run_end`
- Desktop 启动加载：`apps/desktop/src/stores/session-store.ts` — `init()` → `listSessions` / `getSession`

**未验证：** 关闭并重启 Electron 后列表与会话内容仍在（逻辑等价于 server 单测 + REST 重载）。

---

## 附加说明（spec §7.1 脚注）

- **Trace 落库：** `SqliteTracePort` 在 run 开始时 `startTrace`；P0 UI 仅 `[data-trace-panel]` 文本行，完整面板留 P1。
- **占位包：** `packages/mcp/README.md`、`packages/sidecar-python/README.md` 标明 P2/P3，无实现代码。

---

## Task 1–11 提交索引（feat/p0-mvp）

| Task | 主题 | Commit |
|------|------|--------|
| 1 | Monorepo 骨架 | `18cce42` |
| 2 | shared 契约 | `7e0518b` |
| 3 | core Ports | `66a2665` |
| 4 | Runner | `af14fe5` / `d3b4596` |
| 5 | 内置工具 | `e5438e0` |
| 6 | OpenAI Provider | `3791e92` |
| 7 | SQLite | `edb1843` |
| 8 | Fastify API | `201bb54` |
| 9 | WS run + stop | `062afc1` / `d9a3f92` |
| 10 | Electron 壳 | `067ae31` |
| 11 | 占位 UI | `88098a3` / `0ae6ba3` |

---

## P0 毕业断点（Task 12）

- [x] 五条标准均有代码 + 自动化证据（ honesty：2–5 缺 GUI/真 Key 手工确认）
- [ ] 向他人 5 分钟讲清架构（见 `docs/learning/MAP.md`）
- [ ] 是否进入 P1（第二 Provider + 配置 UI + Trace 面板）— **待产品/学习者决定**
