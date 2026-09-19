# P1 Trace 面板 — 设计规格

**日期：** 2026-09-19  
**状态：** 已确认（待实现计划）  
**关联：** `2026-09-05-agent-runtime-design.md` §7 P1（Trace 面板打磨）；P0 验收 `docs/learning/P0-REVIEW.md`  
**参考体验：** ZCode「调用轨迹 / 任务时间线」（观感参考；不复制 zcode-monitor 全套观测站）

---

## 1. 目标与非目标

### 目标

将工作台右侧占位「运行详情 / Trace」升级为可折叠的 **调用轨迹** 面板：

- **实时：** 当前 run 跟随 WS `RunEvent` 增量展示 Timeline  
- **历史：** 本会话最近若干次 run 可切换；从 SQLite 只读 API 加载 spans  
- **入口：** 挂在 **当前会话** 下的开关，点击后 **右侧展开**（非独立顶层导航页）

### 非目标（本切片）

- `ask_all` 权限确认环、第二 Provider（Anthropic 等）  
- 独立「Trace / 观测」导航页、多 Tab（Context / Usage / Agents 等）  
- Token / Usage 图表、子 Agent 树  
- 新增完整 event-log 表替代 spans  

---

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| P1 本轮范围 | **仅 Trace 面板**（原规格中「配置 UI」已由 Settings Runtime 完成） |
| 实时 + 历史 | 两者都要 |
| 信息架构 | 方案 1：升级现有右侧 `RunDetails`，可折叠 |
| 入口 | 会话下选项 → 右侧展开 |
| Run 选择 | 当前 / 刚结束的 run；可切换本会话最近 N 次（N=20） |
| 默认开合 | **默认展开**（兼容现有两栏；若 UI 稿改为默认收起则跟稿） |
| UI 产出 | 用户提供 Figma + HTML 参考；实现结合稿 / Figma + 本规格（计划文首 UI Reference） |
| 视觉参考 | ZCode 时间线观感：轴 + 节点，避免卡片墙 |

---

## 3. 架构

| 层 | 职责 |
|----|------|
| Desktop | 会话下 Trace 开关；右侧 Timeline；live 用内存事件投影；历史调 HTTP |
| Server | 随 run **写入** spans + 更新 trace status；只读 API 列 runs / 取 trace |
| Core / Runner | **不改** ReAct 循环语义；观测写入在 Server 对 Runner 事件的适配层完成（或最小挂钩） |
| Shared | Trace / Run 列表 DTO |

```text
进行中:  WS RunEvent  → session-store → TraceNode[] → Timeline（live）
历史:    GET /sessions/:id/runs → 选 runId
         GET /runs/:runId/trace → spans → Timeline（snapshot）
```

---

## 4. UI / 交互（出稿依据）

### 4.1 整体布局

```
┌──────────────────────────────────────────────────────────┐
│  Topbar（模型切换等，保持现状）                            │
├────────────┬─────────────────────────────┬───────────────┤
│ 会话列表    │  主对话区                     │ Trace 侧栏    │
│ （左）      │  消息 + 输入框                │ （右）        │
│            │  会话标题旁：[Trace] 开关      │               │
└────────────┴─────────────────────────────┴───────────────┘
```

- Trace 开关属于 **当前会话** 上下文，不是全局侧栏新导航。  
- 开：右侧栏可见（建议宽约 320–400px，以 UI 稿为准）。  
- 关：右侧栏消失，主对话区拉满。

### 4.2 右侧栏结构（自上而下）

1. **标题栏：**「调用轨迹」+ 折叠/关闭  
2. **元信息：** `runId` / `traceId` / `status`（等宽小字）  
3. **Run 切换：** 下拉，本会话最近 ≤20 次；展示如 `22:41 · completed`；默认 = live run，否则最近一次已结束  
4. **Timeline：** 纵向时间线（主视觉）

### 4.3 Timeline 节点

| 类型 | 主文案 | 提示 |
|------|--------|------|
| Run 开始 / 结束 | started / completed \| stopped \| error | 起止 |
| generation | 模型 /「生成」 | 普通节点 |
| tool | 工具名（如 `read_file`） | 可展开一行短摘要，不大段 dump |
| 错误 | 短错误信息 | 危险色强调 |

### 4.4 状态

| 状态 | 表现 |
|------|------|
| 空（无 run） | 「发送消息后这里会显示调用轨迹」 |
| Live | 可选细微「进行中」指示 |
| 历史 | 只读静态列表 |
| 加载历史 | 骨架或转圈 |
| 加载失败 | 短错误 +「重试」 |

### 4.5 与聊天关系

主栏仍为对话 + tool 卡；Trace 为旁路观测。演示用「演示工具卡」不进入主路径（可保留开发入口）。

---

## 5. API / 数据模型

### 5.1 现状缺口

`traces` / `spans` 表已存在，但 run 路径目前仅 `startTrace`，**未** `startSpan` / `endSpan`。本切片必须补齐写入，否则历史 Timeline 为空。

### 5.2 表

**`traces`：** 保留 `id, run_id, session_id, created_at`；**新增** `status`（`running` \| `completed` \| `stopped` \| `error`）、`ended_at`（可空）。

**`spans`：** 沿用现结构；`kind` ∈ `generation` \| `tool` \| `permission`。

迁移：SQLite `ALTER TABLE` 加列（或缺列时兼容）。

### 5.3 只读 HTTP

**`GET /sessions/:sessionId/runs?limit=20`**

```ts
{
  runs: Array<{
    runId: string;
    traceId: string;
    status: "running" | "completed" | "stopped" | "error";
    createdAt: string;
    endedAt?: string;
  }>
}
```

**`GET /runs/:runId/trace`**

```ts
{
  runId: string;
  traceId: string;
  status: "running" | "completed" | "stopped" | "error";
  createdAt: string;
  endedAt?: string;
  spans: Array<{
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: "generation" | "tool" | "permission";
    status?: "ok" | "error";
    startedAt: string;
    endedAt?: string;
    summary?: string;
  }>
}
```

未知资源返回 `404`。

### 5.4 写入规则（随 run）

| 事件 | 写入 |
|------|------|
| `run_start` | `startTrace`；`status=running` |
| 模型流 | `generation` span start/end |
| `tool_start` / `tool_end` | `tool` span；短 summary 可选入 metadata |
| `run_end` | 更新 trace `status` + `ended_at` |
| `error` | 相关 span 或 trace 标 error |

span 写入失败 **不阻断** run（对话优先）。

Desktop 不写库。

### 5.5 UI 投影

Desktop 使用 `TraceNode[]`：live 由 `RunEvent` 增量构建；历史由 `spans` 映射。选中历史 run 时不跟随 WS。

---

## 6. 错误处理

| 场景 | 行为 |
|------|------|
| 列表 / trace API 失败 | 侧栏短错误 + 重试；主对话不受影响 |
| 404 | 空态或回退到最近有效 run |
| 旧 run 无 spans | 「该次运行暂无详细轨迹」 |
| Live ↔ 历史切换 | 切回 live `runId` 后继续 WS 投影 |

---

## 7. 测试与成功标准

### 测试

- Server：mock run 后断言 trace status、generation/tool spans；`GET` runs/trace 形状与 404  
- Desktop：`RunEvent` → `TraceNode[]`；历史 fixture 渲染；开关开合  
- 手工：真聊含工具 → 侧栏有节点；重开后仍可从下拉打开该 run  

### 成功标准

1. 会话下可开关右侧「调用轨迹」；默认展开（或跟 UI 稿）。  
2. Live Timeline 随事件增长（run / 模型 / 工具 / 结束可区分）。  
3. 本会话最近 run 可切换；历史从 SQLite API 加载。  
4. 新 run 写入 spans（不再只有空 trace 行）。  
5. 不影响对话、停止、设置；无本切片非目标项。

---

## 8. 实现顺序（计划阶段细化）

1. Trace 写入（span + trace status）+ 迁移  
2. 只读 HTTP + shared DTO  
3. Desktop Timeline + run 切换 + 开关  
4. 按用户 UI 稿 / Figma 对齐视觉  

---

## 9. 实现计划阶段再细化（非未决产品决策）

- UI 稿若指定默认收起 → 实现跟稿（产品默认仍为展开，直到稿覆盖）。  
- `summary` 从 metadata 抽取的键名 → 写实现计划时定一个（如 `metadata.summary`）。  
- **generation span：** 每次模型调用一条 span（非整段 token delta 一条）。
