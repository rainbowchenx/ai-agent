# agent2026

本地可插拔 Agent Runtime + Electron 工作台；学习笔记见 `docs/learning/`。

- 设计规格: `docs/superpowers/specs/2026-09-05-agent-runtime-design.md`
- P0 实现计划: `docs/superpowers/plans/2026-09-05-agent-runtime-p0.md`
- P0 验收: `docs/learning/P0-REVIEW.md`
- 调用链地图: `docs/learning/MAP.md`

旧版 Vue + FastAPI + LangChain 代码保留在分支 `legacy-vue-fastapi`。

---

## 前置条件

- Node.js 18+
- [pnpm](https://pnpm.io/) 9.x（仓库锁定 `pnpm@9.15.0`）

```bash
pnpm install
```

---

## 环境变量

复制根目录 `.env.example` 为 `.env`（或直接在 shell 中导出）：

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | OpenAI 兼容 API 密钥（必填才能跑真模型） |
| `OPENAI_BASE_URL` | 可选；默认配置见 `packages/shared` 的 `defaultAppConfig()`（通常含 `/v1`） |
| `PORT` | 可选；Server 端口，默认 `9800`（Windows 上 8741–8940 常被 Hyper-V 保留，勿占用） |

首次启动 Server 会在 `~/.agent2026/config.yaml` 写入默认配置（若不存在）。SQLite 数据：`~/.agent2026/data.sqlite`。

**安全：** 密钥只经环境变量引用，勿提交 `.env`。

---

## 运行 P0（开发）

### 方式 A — 仅 Server（调试 API / WS）

```bash
pnpm dev:server
```

监听 `http://127.0.0.1:9800`。健康检查：

```bash
curl http://127.0.0.1:9800/health
```

### 方式 B — 仅桌面端（推荐）

```bash
pnpm dev:desktop
```

Electron 主进程会在 9800 无人监听时 **自动 spawn** 本机 Server；若已运行 `dev:server` 则 **复用** 已有进程。

### 方式 C — 双进程并行

```bash
pnpm dev:server    # 终端 1
pnpm dev:desktop   # 终端 2
```

### 测试

```bash
pnpm test                 # 全仓 Vitest（67 项）
pnpm build                # turbo build（若各包已配置）
```

P0 真实 Key 冒烟（需根目录 `.env`）：

```bash
pnpm smoke:p0
```

Desktop live spawn 集成测（可选，较慢）：

```bash
pnpm --filter @agent2026/desktop exec vitest run --config vitest.live.config.ts
```

---

## 包结构

| 路径 | 职责 |
|------|------|
| `packages/shared` | Zod 配置、HTTP/WS 契约、`RunEvent` |
| `packages/core` | Ports、ReAct Runner、内置工具 |
| `packages/providers` | OpenAI 兼容 `ModelPort` |
| `packages/server` | Fastify + SQLite + WS |
| `apps/desktop` | Electron 壳 + 占位 React 工作台 |
| `packages/mcp` | P2 占位 |
| `packages/sidecar-python` | P3 占位 |
