# P3 — run 结束后自动记忆提炼

**日期：** 2026-09-27  
**规格：** `docs/superpowers/specs/2026-09-27-memory-distill-design.md`  
**计划：** `docs/superpowers/plans/2026-09-27-memory-distill.md`  
**前置：** `docs/learning/P2.5-OPENVIKING.md` · `packages/openviking-runtime/README.md`

## 带走

1. **门控三件套**  
   `mcpServers.openviking.enabled` + OV status `ready` + `openviking.autoDistill !== false`（缺省为开）。任一不满足 → 不 enqueue / 跳过提炼。

2. **Server 串行队列**  
   `MemoryConsolidator` 在 `run_end completed` 后异步提炼；不阻塞下一轮对话。写库经 MCP 白名单 `openviking__write`（失败再 `openviking__remember`）。

3. **Desktop 子开关**  
   长期记忆分区：「run 结束后自动提炼」↔ `openviking.autoDistill`；OV 未就绪时可改配置，旁注「当前未生效：OpenViking 未就绪」。`GET /memory/distill/status` 展示上次结果。

```text
设置：自动提炼开关
    → PUT /config (openviking.autoDistill)
run completed
    → MemoryConsolidator.enqueue
        → LLM JSON → validate → MCP write/remember
    → GET /memory/distill/status（设置页旁注）
```

## 手工冒烟（规格 §9.2，依赖本机 OV）

- [ ] **开 OV + autoDistill：** 启用 OpenViking 至 `ready`，确认「run 结束后自动提炼」开启 → 聊一轮含明确偏好（如「以后默认用 pnpm」）→ 等数秒 → `openviking__find` 或设置旁注显示写入成功（`lastStatus=ok`）。
- [ ] **关 autoDistill：** 关闭子开关 → 再聊一轮 → 无新写入；旁注可为 `skipped` 或无变化。
- [ ] **关 OV：** 禁用 OpenViking → 对话正常，无报错弹窗。

## 最短试用路径

1. 按 P2.5 起 OV 至 `ready`。  
2. 设置 → **长期记忆** → 确认「run 结束后自动提炼」开启。  
3. 新开对话说清偏好 → 等 run 结束数秒 → 刷新设置或调用 `openviking__find`。  
4. `GET /memory/distill/status` 或设置旁注核对 `lastStatus` / `lastWritten`。

## 自动化覆盖（无真实 OV）

- `packages/shared`：`autoDistill` Zod 默认  
- `packages/server`：consolidator 门控 / mock LLM+MCP；runs 接线；`GET /memory/distill/status`  
- CI **不**装真实 OpenViking、不调真实 LLM

## 参考

| 资源 | 用途 |
|------|------|
| `docs/superpowers/specs/2026-09-27-memory-distill-design.md` | 规格全文 |
| `docs/learning/P2.5-OPENVIKING.md` | OV 旁路启用前置 |
| `packages/openviking-runtime/README.md` | sync / AGPL / 排障 |
