# P1 Trace 面板验收

**分支：** `feat/trace-panel`  
**规格：** `docs/superpowers/specs/2026-09-19-trace-panel-design.md`

---

## 自动化测试

```bash
pnpm test
```

| 包 | 结果（2026-09-20） |
|----|-------------------|
| `@agent2026/shared` | 4/4 |
| `@agent2026/core` | 16/16 |
| `@agent2026/providers` | 2/2 |
| `@agent2026/server` | 39/39（含 trace API / recorder） |
| `@agent2026/desktop` | 35/35（含 trace-nodes / trace-view） |
| **合计** | **96/96** |

---

## Live smoke（需 `.env` 中 `OPENAI_API_KEY`）

```bash
pnpm smoke:trace
```

断言：`read_file` 工具 run 结束后 `GET /runs/:runId/trace` 返回 `spans.length ≥ 1` 且含 `kind=tool`。

---

## 手工 UI 验证

```bash
pnpm dev:desktop
```

1. 打开会话，确认右侧 **调用轨迹** 默认展开（标题旁 `[Trace]` 可折叠）。
2. 发送含工具的消息（如「读取 workspace 下 hello.txt」）→ Timeline 出现 run / generation / tool 节点。
3. 下拉切换本会话历史 run → 从 SQLite 加载只读 spans。
4. 关闭 Trace 开关 → 右栏隐藏，主对话区拉满。
