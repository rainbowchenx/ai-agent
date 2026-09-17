# agent2026 代码走读（guided-tour）

一块一块读完本仓：先理念与分层，再落到文件与函数。双目标始终并行——**可跑的本地 Agent 产品**，以及**可理解的轻量核心 + Port 扩展**学习路径。

**入口：** [如何跟读](./00-how-to-read.md) → **第 1 块** [总览与分层](./01-overview-and-layers.md) → **第 2 块** [shared 契约层](./02-shared-contracts.md)

相关但不替代本系列：

- 5 分钟调用链：[`docs/learning/MAP.md`](../learning/MAP.md)
- 设计规格：[`docs/superpowers/specs/2026-09-05-agent-runtime-design.md`](../superpowers/specs/2026-09-05-agent-runtime-design.md)
- P0 验收：[`docs/learning/P0-REVIEW.md`](../learning/P0-REVIEW.md)

---

## 建议阅读顺序

| 顺序 | 文档 | 状态 | 一句话 |
|------|------|------|--------|
| 0 | [00-how-to-read.md](./00-how-to-read.md) | 已写 | 跟读节奏与文档分工 |
| 1 | [01-overview-and-layers.md](./01-overview-and-layers.md) | 已写 | 产品定位、进程模型、包职责、Ports 地图 |
| 2 | [02-shared-contracts.md](./02-shared-contracts.md) | 已写 | `RunEvent` / API DTO / `AppConfig`（Zod）契约层 |
| 3 | `03-core-ports-and-runner.md` | 待写 | `packages/core`：Ports、ReAct Runner、权限闸门、内置工具 |
| 4 | `04-providers-model-port.md` | 待写 | `packages/providers`：OpenAI 兼容 `ModelPort` 与流式解析 |
| 5 | `05-server-assemble-http-ws.md` | 待写 | Fastify 装配根、SQLite、runs WS、stop / Hub |
| 6 | `06-desktop-shell-and-ui.md` | 待写 | Electron 守护 Server、preload、工作台对 `RunEvent` 的投影 |
| 7 | `07-config-credentials-settings.md` | 待写 | `~/.agent2026` 配置与密钥、设置页与 runtime 装配 |
| 8 | `08-extensions-roadmap.md` | 待写 | MCP / Sidecar / A2A / Memory：规格预留 vs 代码现状 |

未写章节可先当提纲占位；实现细节以源码与 `docs/learning/P0-T*.md` 为准。

---

## 本系列约定

- 中文；可理解、逻辑清晰、专业。
- 每章结构：设计意图 → 关键路径 → 数据/控制流 → **潜在问题/可质疑点** → 读完自检。
- 轻量核心 + 扩展/Port；大需求才走 superpowers，走读本身不实现新功能。
