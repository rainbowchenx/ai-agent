# P4 — 会话级选择性 auto-recall

**日期：** 2026-09-27  
**规格：** `docs/superpowers/specs/2026-09-27-memory-recall-design.md`  
**计划：** `docs/superpowers/plans/2026-09-27-memory-recall.md`  
**前置：** P3 写路径 · P2.5b 独立 Embedding

## 带走

1. **门控**  
   OV `ready` + `openviking.autoRecall !== false`（默认开）。

2. **会话缓存**  
   `MemoryRecaller` 按 `sessionId` 缓存格式化块；同会话复用，避免每轮打 OV。

3. **刷新**  
   用户话含线索（记住/偏好/…）或 `POST /sessions/:id/memory/refresh` 时重检索。

4. **注入**  
   拼进 systemPrompt 尾部；**不**写入 SessionStore。

```text
run 开始 → resolveForRun → system + block → Runner
设置：自动召回 ↔ autoRecall
```

## 手工冒烟

- [ ] 有冻结偏好 + embedding 可用 → 新 session 问「按习惯装依赖」→ 倾向 pnpm  
- [ ] 同 session 第二轮 → 缓存命中（不重复 find）  
- [ ] 关 autoRecall → 无注入  

## 参考

| 资源 | 用途 |
|------|------|
| 规格 | `2026-09-27-memory-recall-design.md` |
| 写路径 | `P3-MEMORY-DISTILL.md` |
