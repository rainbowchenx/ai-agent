# ask_all 权限确认环 — 设计规格

**日期：** 2026-09-20  
**状态：** 已确认，待实现  
**关联：** `2026-09-05-agent-runtime-design.md` §5.2 权限、§7 P2（权限 ask 先行切片）；P1 Trace 已合入  
**范围说明：** 本切片接通 `ask_all` 的 WS↔UI 确认环；**不含 MCP**（MCP 为后续独立切片）

### UI Reference

| 来源 | 链接 / 路径 | 用途 |
|------|-------------|------|
| Figma | [myagent · node `16:235`](https://www.figma.com/design/6mxCXcFGVyupqTTKbZD7GF/myagent?node-id=16-235)（fileKey `6mxCXcFGVyupqTTKbZD7GF`） | 工作台内联「工具权限请求」卡片视觉与文案；实现以该节点为准 |

实现时：功能契约以本文为准；**卡片视觉对齐 Figma**（标题行、副文案、参数块、三按钮描边色）。整页壳（侧栏、问候条等）若与现网不一致，**只改权限卡片及其在对话流中的呈现**，不借机重做整页。

---

## 1. 目标与非目标

### 目标

在设置里选 `ask_all` 后，Agent 每次调用工具前必须经用户确认：

- 对话流内联卡片展示工具名与参数，提供 **允许 / 本会话允许 / 拒绝**
- Server 侧挂起等待用户响应，再决定是否执行工具
- 「本会话允许」按工具名豁免，记在 Server 进程内存；重启后失效
- 停止按钮与 WebSocket 断开仍能取消等待，不执行工具

### 非目标（本切片）

- MCP Client / 多 server / 命名空间
- 改 `default` 模式对写操作 / 网络工具的细分策略
- 「本会话允许」写入 SQLite 或跨重启持久化
- 模态弹窗、输入框上方固定条
- 会话级「永久拒绝」黑名单
- Hooks 生命周期扩展

---

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| P2 第一刀 | **先 ask_all**，MCP 放下一刀 |
| 确认 UI | 对话流内联卡片；视觉对齐 Figma `16:235`（标题 `工具权限请求 · {tool}`、三描边按钮） |
| 同工具重复确认 | 卡片提供「本会话允许」；按 **工具名** 豁免，忽略参数差异 |
| 豁免存储 | **进程内存 only**；Server 重启后清空 |
| 接线方案 | Server 进程内 `PermissionBroker`；`core` 闸门语义基本不动 |
| `default` / `allowlist` | 不经过 Broker；行为保持现状 |
| 拒绝后果 | 写成 tool error 交回模型，**本次 run 继续**（沿用现有 Runner） |
| 停止 / 断开 | abort 结束等待，不执行工具；Broker 丢掉对应 `requestId` |

---

## 3. 架构

| 层 | 职责 |
|----|------|
| Desktop | 权限卡片三按钮；发送 `permission_response`；点后禁用并标状态 |
| Server | `PermissionBroker`：挂起 `requestId`、会话豁免表；接线 `onPermissionRequest` |
| Core | 现有 `evaluatePermission` / `ask_all` 等待语义保留；增加「已豁免则跳过询问」的最小钩子 |
| Shared | `PermissionWsResponse` 增加可选 `scope` |

```text
tool_call
  → evaluatePermission(ask_all)
      → Broker.isSessionAllowed(sessionId, toolName)?
            yes → allow（不出卡片）
            no  → emit permission_request
                  → Broker.wait(requestId)
                  → Desktop 卡片按钮
                  → permission_response { allow, scope? }
                  → Broker.resolve；若 scope=session 且 allow → 记豁免
      → allow? execute : tool error 回模型
```

### 3.1 PermissionBroker

进程内单例（随 Server 装配），不落库：

- `pending: Map<requestId, { resolve, sessionId, toolName, runId }>`
- `sessionAllow: Map<sessionId, Set<toolName>>`

行为：

- `wait(request)` → Promise\<PermissionDecision\>
- `respond({ requestId, allow, scope })`：未知 / 已过期 id → no-op
- `allowSession(sessionId, toolName)`：`scope: "session"` 且 `allow: true` 时调用
- `isSessionAllowed(sessionId, toolName)`：闸门询问前查询
- `cancel(requestId)` / run abort / WS close：丢掉 pending，等待方按 abort 路径结束

### 3.2 Core 钩子

在 `ask_all` 分支发出 `permission_request` **之前**，若 `onPermissionRequest` 侧（或显式 `isPreAllowed` 回调）判定已豁免，则直接 `{ allow: true }`，**不** emit `permission_request`。

实现偏好：由 Server 注入的 `onPermissionRequest` 在进入 wait 前先查 Broker；若已豁免则立即 resolve `{ allow: true }`，且 **不** 调用会触发 `onRequest` 的路径——或等价地让 Runner 在 `onRequest` 之前有 `shouldSkipAsk`。以「未豁免才出卡片」为准，具体 API 在计划里选最小改动。

### 3.3 runs 路由

今日断点：`permission_response` 分支直接 `return`（no-op）。本切片改为：

1. 校验消息形状（含可选 `scope`）
2. 调用 `broker.respond(...)`
3. 不启动新 run

`startRun` 装配时传入 `onPermissionRequest`，绑定当前 `sessionId` / `runId`。

---

## 4. UI / 交互

对照 Figma `16:235` 中「Permission request card (sample in conversation flow)」。

### 4.1 权限卡片结构

挂在对话流内（与 Agent 气泡同列左对齐），不是模态、不是输入框上方条。

| 元素 | Figma / 规格 |
|------|----------------|
| 左侧头像 | 盾牌 / 锁图标（圆底） |
| 标题 | `工具权限请求 · {toolName}`（如 `工具权限请求 · read_file`） |
| 副文案 | 灰色一行说明。首版可用通用句：「Agent 希望调用该工具以继续完成任务」；内置工具可选用更具体文案（如 `read_file` →「Agent 希望读取本地文件以继续完成任务」）。**不**要求模型生成副文案 |
| 参数块 | 深底 + 边框的等宽文本区，展示 `arguments`（可读 key/value 或 JSON；过长截断或滚动） |
| 按钮行 | 三枚等分描边按钮，居中横排： |

按钮视觉（对齐稿）：

| 按钮 | 动作 | 描边 / 字色 |
|------|------|-------------|
| **允许** | `allow: true`, `scope: "once"` | 蓝描边 / 蓝字（约 `#2e8dff`） |
| **本会话允许** | `allow: true`, `scope: "session"` | 灰描边 / 浅字（约 `#3a3a3c` / `#f5f5f7`） |
| **拒绝** | `allow: false` | 红描边 / 红字（约 `#ff453a`） |

状态机（客户端投影）：

| 状态 | 表现 |
|------|------|
| `pending` | 三按钮可用 |
| `allowed` / `session_allowed` / `denied` | 按钮禁用；可用一行结果文案替代或弱化按钮行 |
| `expired` | 按钮禁用；文案「已失效」（`run_end`、切换会话） |

点击即发 WS，并立刻切到对应终态（乐观），避免连点。

### 4.2 设置页

- 删除「ask_all 确认弹窗与完整权限闸门 UI 将在后续版本完善」提示
- 模式切换仍走现有 `PUT /config`；热切换只影响 **之后的新 run**

### 4.3 历史会话

权限卡片 **不** 持久化到 SQLite。重载会话不会出现旧权限卡片。

---

## 5. 契约

### 5.1 Server → Desktop（不变）

```ts
{
  type: "permission_request";
  runId: string;
  requestId: string;
  toolName: string;
  arguments: unknown;
}
```

### 5.2 Desktop → Server（扩展）

```ts
{
  type: "permission_response";
  requestId: string;
  allow: boolean;
  scope?: "once" | "session"; // 缺省 = "once"；allow === false 时忽略
}
```

校验规则：

- `allow: false` → 按拒绝处理，忽略 `scope`
- 缺省 `scope` → `"once"`
- 未知 `requestId` → no-op

---

## 6. 错误与边界

| 场景 | 行为 |
|------|------|
| 未知 / 过期 `requestId` | 忽略；桌面卡片可标失效 |
| 拒绝 | tool result = Permission denied…；run 继续 |
| `scope: "session"` + allow | 记入该 session 豁免；同工具名后续自动放行 |
| Stop / WS close | abort；不执行工具；清理 pending |
| `default` / `allowlist` | 不经 Broker |
| 配置热切到 `ask_all` | 仅新 run |
| Server 重启 | 豁免与 pending 全部丢失 |

---

## 7. 测试

| # | 层 | 断言 |
|---|----|------|
| 1 | Server | `permission_response` allow once → 工具执行，有 `tool_start`/`tool_end` |
| 2 | Server | `scope: "session"` 后同 session 同工具第二次无 `permission_request` |
| 3 | Server | deny → tool error 回写，run 未因拒绝直接 `error` 结束 |
| 4 | Server | stop / disconnect 等待中 → 工具未执行，run `stopped` |
| 5 | Desktop | 三按钮发出正确 payload；点后禁用 |
| 6 | 冒烟 | 设 `ask_all` → 触发 `read_file` → 允许 → 见 tool 事件 |

---

## 8. 实现顺序（预告）

1. Shared：`PermissionWsResponse.scope`
2. Server：`PermissionBroker` + 单测
3. Server：`runs.ts` 接线 `onPermissionRequest` / `respond`
4. Core：豁免跳过询问的最小钩子（若 Server 侧无法单独完成）
5. Desktop：卡片按钮 + 状态 + 发 WS
6. 设置文案；冒烟脚本或手工清单
7. 文档：`docs/learning` 短记（可选）

合入策略：新分支 `feat/ask-all-permission`，自最新 `main` 拉出；合并前全量 `pnpm test`。

---

## 9. 后续（不在本切片）

- P2 余下：MCP 多 server + `server__tool` 命名空间
- `default` 模式对写/网络/MCP 的询问策略
- 豁免持久化（若产品需要）
