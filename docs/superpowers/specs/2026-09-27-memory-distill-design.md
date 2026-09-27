# 记忆写路径（任务后提炼）— 设计规格

**日期：** 2026-09-27  
**状态：** **已实现**（2026-09-27）  
**实现计划：** `docs/superpowers/plans/2026-09-27-memory-distill.md`  
**关联：**  
- `2026-09-05-agent-runtime-design.md` §6.5（OpenViking / Hooks / MemoryPort 预留）  
- `2026-09-19-rsi-memory-design.md`（方案 4 · §3.1 日常任务后提炼；本规格落地写路径）  
- `2026-09-26-openviking-mcp-design.md`（P2.5 管道已实现；本规格依赖 OV `ready` + MCP 工具）  
- `2026-09-26-mcp-toolport-design.md` / `2026-09-20-ask-all-permission-design.md`（工具名与权限环）  

**范围说明：** 交付「run 正常结束后异步提炼 → candidate → 校验 → frozen → 经 OpenViking MCP 写入」闭环；设置可开关。  
**不做：** auto-recall / `before_model` 注入、`MemoryPort`、新工作区探索（RSI §3.2）、`viking://` 浏览器、人工审阅台、改模型权重。

---

## 1. 目标与非目标

### 1.1 目标

1. **触发：** `run_end` 且 `reason === "completed"` 后异步启动提炼；`stopped` / `error` **不**提炼。  
2. **提炼：** 使用当前默认 Agent Provider（与对话同源密钥/模型配置）发起 **一次短 LLM 调用**，输出结构化记忆条目 JSON。  
3. **生命周期：** 条目先为 `candidate`；轻量校验通过后自动升为 `frozen` 并持久化到 OpenViking；失败则丢弃或保留 candidate（见 §4），不阻断用户。  
4. **写入管道：** Server 侧 `MemoryConsolidator` 经已挂载的 MCP 调用 `openviking__remember` 和/或 `openviking__write`；与 Agent 共用 MCP 管道。  
5. **门控：**  
   - `mcpServers.openviking.enabled === true`  
   - OpenVikingSupervisor status === `ready`  
   - `openviking.autoDistill === true`（默认 `true`）  
   任一不满足 → 跳过提炼（静默或 debug 日志）。  
6. **可观测：** 提炼开始/成功/失败可记入日志；可选轻量 status 字段供设置页展示「上次提炼」；**不**要求完整 Trace 面板改造。  
7. **边界：** 逻辑在 `packages/server`（+ 必要 shared 类型）；**禁止** `packages/core` 依赖 OpenViking / 提炼实现。

### 1.2 非目标

| 不做 | 理由 |
|------|------|
| `MemoryPort` | 本切片经 MCP 足够；Port 留后续 |
| `before_model` auto-recall | 读路径独立切片 |
| 新工作区探索 / BRS·DRS | RSI §3.2 后置 |
| 记忆浏览器 / 候选人工审阅 UI | 本切片自动升 frozen；审阅后置 |
| 直连 `@openviking/sdk` 写库 | 与 P2.5「MCP 一等」一致 |
| 失败 run / 用户 stop 后提炼 | 避免噪声与半截轨迹 |
| 改 Runner 权限核心 / 自动改代码 | RSI 纪律 |

### 1.3 成功判据（一句话）

用户开启长期记忆且「自动提炼」打开、OV ready → 完成一轮有信息量的对话并正常结束 → 异步写入后可用 `openviking__find` / `search` 检索到对应冻结要点；关闭提炼或 OV 不可用时对话与今日行为一致。

---

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| 产品切片 | 仅 **写路径**（RSI §3.1） |
| 触发 | run **completed** 后异步 |
| 提炼 | **短 LLM** → 结构化 JSON |
| 生命周期 | **candidate → 校验 → 自动 frozen** |
| 写入 | **MCP** `openviking__*`；无 MemoryPort |
| 设置 | `openviking.autoDistill` 默认 **true**；长期记忆分区子开关 |
| 架构 | Server `MemoryConsolidator`；不另起 worker 进程 |
| CI | **不**依赖真实 OV；consolidator 单测 mock Model + MCP ToolPort |

---

## 3. 架构

### 3.1 分层

```text
apps/desktop
  设置 · 长期记忆：
    启用 OpenViking（已有）
    + 「run 结束后自动提炼」↔ openviking.autoDistill
    可选：上次提炼时间 / 简短结果文案
        │ HTTP PUT /config
packages/server
  runs.ts：run_end completed → void consolidator.enqueue(...)
  MemoryConsolidator
        │ ModelPort（默认 Provider，短 prompt）
        │ 校验 promote
        │ mcp.getPort("openviking") → ToolPort.execute
        ▼
  OpenViking MCP（openviking__remember / write）
packages/core
  无变更或仅类型无关；Runner 不感知提炼
```

### 3.2 `MemoryConsolidator` 职责

```ts
type DistillJob = {
  runId: string;
  sessionId: string;
  traceId: string;
  /** 已落库或内存中的本 run 消息摘要输入 */
  messages: Array<{ role: string; content: string }>;
  /** 可选：tool 调用摘要 */
  toolSummaries?: Array<{ name: string; ok: boolean; snippet?: string }>;
};

type MemoryConsolidator = {
  /** 非阻塞；内部串行或有限并发队列 */
  enqueue(job: DistillJob): void;
  getLastResult(): DistillStatusView | null;
  shutdown(): Promise<void>;
};
```

**算法（单 job）：**

1. 读最新 `AppConfig` + OpenViking status；门控失败 → return。  
2. 若队列过载（例如 > N 未完成）→ 丢弃最旧或跳过本 job（实现选：**跳过本 job 并记 status=skipped_busy**，N 默认 3）。  
3. 组装 distill prompt（§5）→ `model.complete` / 等价非流式短调用（若仅有 stream API 则拼 delta）。  
4. 解析 JSON → `MemoryItem[]`（Zod）；非法 → `error`，结束。  
5. 对每条：校验（§4）→ 通过则 `status=frozen`，调用 MCP 写入（§6）；不通过则跳过该条。  
6. 更新 `lastResult`（成功条数、失败原因摘要）。

**并发：** 进程内 **串行处理 queue**（一次一个 LLM+写），避免打爆 Provider / OV。`enqueue` 立即返回。

**与 runs 接线：** 在 `runs.ts` 于 `run_end` 已发给客户端且 session 消息已 append **之后** `void consolidator.enqueue(...)`；用 `try/catch` 包住，永不反向影响 WS。

### 3.3 输入裁剪

为控制成本与噪声：

| 输入 | 规则 |
|------|------|
| 消息 | 本 run 新增 user/assistant/tool 消息；单条 content 截断至例如 2k 字符；总字符硬顶例如 12k（常量写死在实现，可配置后置） |
| system | **不**送入提炼（或只送一行「Agent 角色」） |
| tool | 保留 name + 成功/失败 + 结果截断 |

空对话（仅问候、无实质）由 LLM 返回 `[]`；校验后零写入，算成功空跑。

---

## 4. 记忆条目模型

### 4.1 Zod 形状（shared）

```ts
kind: "fact" | "procedure" | "preference" | "boundary"
when: string          // 适用条件；可空字符串则校验失败
do: string            // 结论 / 动作
outcome: string       // 证据简述；应含可追溯线索（路径、错误类、用户原话摘要）
confidence: number    // 0..1
status: "candidate" | "frozen" | "rejected"
sourceRunId: string
sourceSessionId: string
sourceTraceId?: string
```

持久化到 OV 时，将结构化内容序列为 Markdown 或 JSON 文本（见 §6），并在正文或 front matter 中带 `status`、`sourceRunId`。

### 4.2 轻量校验（自动升 frozen）

全部满足才 promote：

1. `when`、`do` 非空白；`do.length` ≥ 8（防空话）。  
2. `confidence >= 0.5`（阈值，实现常量）。  
3. `kind` 为枚举合法值。  
4. **去重启发（本切片最小）：** 对 `do` 规范化（小写、压缩空白）后，与本 job 已接受条目及可选「最近一次成功写入的 do 指纹缓存（内存，最多 50）」比对；相同则 `rejected`。  
5. **禁止写入：** 含明显密钥形态（正则：`sk-`、`api_key=` 等）→ `rejected`。

不通过 → 不写 OV；记入 lastResult 的 rejected 计数。

---

## 5. LLM 提炼契约

### 5.1 输出格式（模型必须遵守）

系统/用户提示要求 **只输出 JSON**：

```json
{
  "items": [
    {
      "kind": "fact",
      "when": "...",
      "do": "...",
      "outcome": "...",
      "confidence": 0.7
    }
  ]
}
```

- `items` 可为空数组。  
- 单次最多 **5** 条（prompt 写明；解析后 slice）。  
- 禁止 Markdown 围栏外的散文；若模型包了 \`\`\`json，实现可剥离后 parse。

### 5.2 Prompt 要点（实现写死模板）

- 只提取 **跨会话仍有用** 的偏好、项目约定、已验证的失败教训、稳定事实。  
- **不要**提取：闲聊、一次性临时值、密钥、完整代码大段。  
- 每条必须可被未来任务检索复用；`outcome` 指向本 run 证据。

### 5.3 模型选择

使用 `agents.default.model` 对应 Provider；**不**为提炼单独强制更强模型（本切片 YAGNI）。超时：例如 60s；超时 → job error。

---

## 6. OpenViking 写入

### 6.1 工具选择

| 用途 | 工具 | 说明 |
|------|------|------|
| 优先 | `openviking__remember` | 把条目转为 messages 或文本，触发 OV 记忆抽取 |
| 回退 / 结构化落盘 | `openviking__write` | 写入约定 URI，如 `viking://~/memories/agent2026/{date}/{runId}-{i}.md` |

**推荐策略（写死）：**

1. 对每条 frozen：生成 Markdown 正文（含 YAML front matter：`kind/status/confidence/sourceRunId/...`）。  
2. 先尝试 `openviking__write` 到上述 URI（确定性、可检索、可调试）。  
3. 若 write 失败，再尝试 `openviking__remember` 一次（messages=[{role:user,content: markdown}]）；仍失败则记 error。  

（若实测 `remember` 更稳，实现 plan 可对调顺序，但须在 plan 中固定一种并测。）

### 6.2 权限

Consolidator 调用 MCP **绕过** 用户 PermissionBroker（服务端子系统写入，类似内部维护任务）。须：

- 仅允许调用 `openviking__write` / `openviking__remember` / 可选 `openviking__health`；  
- **禁止** 经 consolidator 调用 `forget`、任意非 openviking 工具。  

实现上：直接 `mcp.getPort("openviking")?.execute(...)`，不经 Runner 权限闸门；并在代码注释与规格中标明此内部特权边界。

### 6.3 OV 不可用

`getPort` 缺失或 execute 抛错 → job `error`；**不**重试风暴（最多 1 次即时重试可选；默认 **0** 次重试）。

---

## 7. 配置与 API

### 7.1 AppConfig 扩展

在现有 `openviking` 对象上增加：

```ts
openviking?: {
  embeddingModel?: string;
  vlmModel?: string;
  embeddingDimension?: number;
  /** 默认 true */
  autoDistill?: boolean;
};
```

Zod：`autoDistill: z.boolean().default(true)`（在 openviking 对象内；若整个 `openviking` 缺失，门控视为 autoDistill=true **仅当** 读配置时用 `config.openviking?.autoDistill !== false`）。

**真相源：** 仅配置字段；无第二 feature flag。

### 7.2 HTTP（可选但推荐）

- `GET /memory/distill/status` → `DistillStatusView`：  
  `{ enabled: boolean; lastAt?: string; lastRunId?: string; lastStatus: "idle"|"running"|"ok"|"error"|"skipped"; lastMessage?: string; lastWritten?: number }`  
- 不强制 `POST` 手动触发（属增强；本切片 **不做**，避免扩 scope）。

### 7.3 Desktop UI

在现有「长期记忆」分区（Figma `21:538`）增加一行：

- 开关文案：`run 结束后自动提炼`  
- 副文案：`将本轮对话要点写入 OpenViking（需服务就绪）`  
- 绑定 `openviking.autoDistill`  
- 若 OV 未 ready：开关可改配置，但旁注「当前未生效：OpenViking 未就绪」  
- 可选只读行展示 `GET /memory/distill/status` 的上次结果  

**不做** 独立「记忆」新侧栏分区。

---

## 8. 降级与错误

| 场景 | 行为 |
|------|------|
| autoDistill false | 不 enqueue |
| OV disabled / 非 ready | 不 enqueue 或 enqueue 后立即 skipped |
| LLM 失败 / 超时 / 坏 JSON | lastStatus=error；用户无感 |
| 全部条目被校验拒绝 | lastStatus=ok，written=0 |
| MCP 写失败 | lastStatus=error；已成功的条保留 |
| Server 关闭 | `shutdown` 等当前 job 结束或超时丢弃队列 |
| 提炼与下一 run 重叠 | 队列串行；不阻塞新 run |

---

## 9. 测试与验收

### 9.1 自动化

1. Consolidator：门控跳过（disabled / not ready / autoDistill false）。  
2. Mock model 返回合法 JSON → 校验 → mock ToolPort 收到 write/remember。  
3. 坏 JSON / 低 confidence / 密钥形态 → 不调用 write。  
4. `enqueue` 后立即返回；job 内抛错不冒泡。  
5. runs 接线：可用集成测 stub consolidator，断言 completed 时被调用、error/stop 时不调用。

### 9.2 手工冒烟（依赖本机 OV）

1. 开 OV + autoDistill → 聊一轮含明确偏好（如「以后默认用 pnpm」）→ 等数秒 → `openviking__find` 或设置旁注显示写入成功。  
2. 关 autoDistill → 再聊一轮 → 无新写入。  
3. 关 OV → 对话正常，无报错弹窗。

### 9.3 CI

不装真实 OV；不调真实 LLM（mock ModelPort）。

---

## 10. 仓库布局（建议）

```text
packages/shared/src/memory-item.ts      # Zod + types + DistillStatusView
packages/server/src/memory/
  consolidator.ts
  distill-prompt.ts
  validate.ts
  write-openviking.ts
  consolidator.test.ts
  ...
packages/server/src/routes/memory.ts    # GET distill status（若做）
packages/server/src/routes/runs.ts      # enqueue 接线
apps/desktop/.../memory-settings-panel.tsx  # 子开关 + 可选 last status
docs/learning/P3-MEMORY-DISTILL.md      # 冒烟短记
```

---

## 11. 风险

| 风险 | 缓解 |
|------|------|
| 错误复利 | candidate 校验；confidence 阈值；禁密钥；去重启发 |
| Token / 费用 | 输入截断；最多 5 条；串行队列；可关开关 |
| AGPL OV | 已有可选组件纪律；OV 挂则跳过 |
| 内部绕过权限写 MCP | 白名单工具；代码审查点 |
| DeepSeek 等不支持 embedding 影响检索 | 写路径仍可 write；检索质量属运维/模型配置，文档提示 |
| 无 Hooks 框架 | 本切片仅 runs 结束回调；不引入通用 Hooks 总线（后置） |

---

## 12. 明确延后（下一刀候选）

1. **读路径：** ~~`before_model` auto-recall~~ → 见 `2026-09-27-memory-recall-design.md`（已实现：会话级选择性召回）。  
2. **MemoryPort** 抽象。  
3. **探索冻结**（RSI §3.2）。  
4. **候选审阅 UI** / 手动「立即沉淀」。  
5. 通用 Hooks 总线（before_model / after_run 插件化）。

---

## 13. 实现顺序预览

1. shared：MemoryItem + openviking.autoDistill  
2. validate + distill-prompt + consolidator（mock 测）  
3. write-openviking + 挂 runs + 可选 status 路由  
4. Desktop 子开关  
5. 学习短记 + 本机冒烟  

规格确认后按 `writing-plans` 拆 Task。
