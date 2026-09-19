# P0 验收清单（对照 spec §7.1）

**分支：** `main`（原实现于 `feat/p0-mvp`）  
**初验日期：** 2026-09-06  
**收口日期：** 2026-09-19  
**验收方式：** 自动化测试（Vitest）+ **真实 DeepSeek Key 的 live smoke** + Desktop spawn health/对话

---

## 测试总览

### 自动化（2026-09-19 重跑）

```bash
pnpm test
```

| 包 | 结果 |
|----|------|
| `@agent2026/shared` | **4/4 passed** |
| `@agent2026/core` | **16/16 passed** |
| `@agent2026/providers` | **2/2 passed** |
| `@agent2026/server` | **32/32 passed** |
| `@agent2026/desktop` | **21/21 passed** |
| **合计** | **75/75 passed** |

### Live / 本机冒烟（2026-09-19）

| 项 | 命令 / 方式 | 结果 |
|----|-------------|------|
| ServerManager live spawn | `pnpm --filter @agent2026/desktop exec vitest run --config vitest.live.config.ts` | **1/1 passed**（端口 18787） |
| P0 端到端（真 Key） | `pnpm smoke:p0` → `scripts/smoke-p0.ts` | **ALL CHECKS DONE**（health / 流式 / `read_file` / stop / 会话 reload） |
| Desktop 拉起 Server | `pnpm dev:desktop` | Server `listening on http://127.0.0.1:9800`；`GET /health` → `{ ok: true }` |
| Desktop 同进程对话 | Electron 已 spawn 的 9800 上 WS `run` | `run_end.reason=completed`，回复 `DESKTOP_OK` |

**Provider：** DeepSeek OpenAI 兼容（`https://api.deepseek.com/v1`，模型 `deepseek-chat` / 配置中可为 `deepseek-flash`）

---

## §7.1 成功标准逐条

### 1. 启动桌面端可打开工作台，并自动拉起本地 Server

| 项 | 状态 |
|----|------|
| 总体 | **通过** |

**证据：**

- Electron 壳 + Server 守护：`apps/desktop/electron/main/server-manager.ts`
- Live spawn 集成测通过；本机 `pnpm dev:desktop` 日志：`agent2026 server listening on http://127.0.0.1:9800`
- DEV 会把仓库根 `.env` 合并进 spawn 环境（`loadRepoDotEnv`），便于本机 Key 生效

**收口时修复：** 默认端口 **8787 → 9800**。本机 Windows Hyper-V 排除了 `8741–8940`，监听 8787 会 `EACCES`。

---

### 2. 配置一个 OpenAI 兼容 endpoint 即可流式对话

| 项 | 状态 |
|----|------|
| 总体 | **通过** |

**证据：**

- `pnpm smoke:p0`：`PASS stream chat`
- Desktop 已拉起的 Server：WS 流式收到 `message_delta` → `DESKTOP_OK`

**收口时修复：** `~/.agent2026/config.yaml` 与 `.env` 的 `baseUrl` 补上 `/v1`（否则请求打到 `.../chat/completions` 而非 `.../v1/chat/completions`）。

---

### 3. 至少一个内置工具跑通，UI 可见 tool 卡片

| 项 | 状态 |
|----|------|
| 总体 | **通过**（协议与持久化已 live 验证；Electron 内 tool 卡依赖同一 `tool_start`/`tool_end` 事件投影，单测覆盖 UI） |

**证据：**

- `pnpm smoke:p0`：`PASS builtin read_file tool_start/tool_end`；会话 roles=`user,assistant,tool,assistant`
- UI：`apps/desktop/src/components/chat/tool-card.tsx` + `apply-run-event.test.ts`

---

### 4. 停止按钮可中断当前 run

| 项 | 状态 |
|----|------|
| 总体 | **通过** |

**证据：**

- `pnpm smoke:p0`：`PASS stop mid-run (reason=stopped)`（`POST /runs/:id/stop` 于 `run_start` 后立即调用）
- Desktop 停止按钮走同一 HTTP stop API（`[data-stop-run]`）

---

### 5. Sessions 写入 SQLite；重启 App 后会话与消息仍在

| 项 | 状态 |
|----|------|
| 总体 | **通过** |

**证据：**

- `pnpm smoke:p0`：`PASS session persist/reload`
- 生产路径仍为 `~/.agent2026/data.sqlite`；Desktop `session-store.init()` 启动时 `listSessions` / `getSession`

---

## 附加说明（spec §7.1 脚注）

- **Trace 落库：** `SqliteTracePort` 在 run 开始时 `startTrace`；完整 Trace 面板留 P1。
- **占位包：** `packages/mcp`、`packages/sidecar-python` 仍为 P2/P3 占位。
- **权限：** P0 默认 auto-allow 已注册工具；`ask_all` WS↔UI 环仍未接线（P1）。
- **复跑冒烟：** `pnpm smoke:p0`（需根目录 `.env` 含 `OPENAI_API_KEY`）。

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

- [x] 五条标准均有代码 + 自动化证据
- [x] 真实 Key live smoke（`scripts/smoke-p0.ts`）与 Desktop spawn/对话收口（2026-09-19）
- [x] 向他人 5 分钟讲清架构（见 `docs/learning/MAP.md`）
- [ ] 进入 P1（Trace 面板 + `ask_all` 权限环；第二 Provider 可后置）— 配置 UI 已在 Settings Runtime 提前落地
