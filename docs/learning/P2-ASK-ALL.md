# P2 ask_all 权限确认环

**分支：** `feat/ask-all-permission`  
**规格：** `docs/superpowers/specs/2026-09-20-ask-all-permission-design.md`  
**计划：** `docs/superpowers/plans/2026-09-20-ask-all-permission.md`

---

## 做什么

设置 `permissions.mode = ask_all` 后，Agent **每次调用工具前**都会在对话流内弹出权限卡片，等待用户确认后再执行。

- Server 侧 `PermissionBroker` 挂起 `requestId`，收到 WS `permission_response` 后放行或拒绝
- 拒绝 → 工具返回 error 给模型，**run 继续**（不直接 error 结束）
- Stop / WS 断开 → abort 等待，不执行工具

---

## 三按钮 + 会话豁免

卡片三枚描边按钮（对齐 Figma `16:235`）：

| 按钮 | WS payload | 效果 |
|------|------------|------|
| **允许** | `{ allow: true }`（缺省 `scope: "once"`） | 仅本次放行 |
| **本会话允许** | `{ allow: true, scope: "session" }` | 同 session 同工具名后续自动放行 |
| **拒绝** | `{ allow: false }` | 工具 error 回模型 |

「本会话允许」按 **工具名** 豁免（忽略参数差异），存在 **Server 进程内存**（`Map<sessionId, Set<toolName>>`）。Server 重启后清空；不落 SQLite。

已豁免的工具不再 emit `permission_request`，直接执行。

---

## 自动化测试

```bash
pnpm test
```

分包包测：

```bash
pnpm --filter @agent2026/server test
pnpm --filter @agent2026/core test
pnpm --filter @agent2026/desktop test
```

Server 集成测（`runs.test.ts`）覆盖规格 §7 的 1–4：allow once、session 豁免、deny、stop 等待中。Core / Desktop 单测覆盖 `isPreAllowed` 跳过与卡片状态投影。

---

## 手工验证

```bash
pnpm dev:desktop
```

1. 打开 **设置** → 权限模式选 **ask_all** → 保存（`PUT /config`）
2. 新建或切换会话，发送会触发工具的消息（如「读取 workspace 下 hello.txt」）
3. 对话流出现 **工具权限请求 · read_file** 卡片（标题、副文案、参数块、三按钮）
4. 点 **允许** → 卡片变终态，出现 `tool_start` / `tool_end` 工具卡
5. （可选）同会话再触发同工具 → 点 **本会话允许** → 第二次起不再出卡片
6. （可选）点 **拒绝** → 工具卡显示 error，Agent 可继续回复

**注：** 无独立冒烟脚本；手工步骤如上，自动化由 server 集成测承担。
