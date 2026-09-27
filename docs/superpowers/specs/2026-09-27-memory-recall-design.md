# 记忆读路径（会话级选择性 auto-recall）— 设计规格

**日期：** 2026-09-27  
**状态：** **已实现**（2026-09-27）  
**实现计划（确认后）：** `docs/superpowers/plans/2026-09-27-memory-recall.md`  
**学习短记（实现后）：** `docs/learning/P4-MEMORY-RECALL.md`  
**关联：**  
- `2026-09-19-rsi-memory-design.md`（RSI 环的「读」）  
- `2026-09-27-memory-distill-design.md`（写路径已实现；本规格为其对偶读路径）  
- `2026-09-26-openviking-mcp-design.md` / `2026-09-27-openviking-embedding-config-design.md`（OV + 独立 embedding）  

**范围说明：** 在 run 装配阶段按需检索冻结记忆，以**会话级缓存 + 选择性 top‑k + 硬预算**注入 system 尾部；避免每轮整库拼接导致上下文膨胀。  
**不做：** MemoryPort、通用 Hooks 总线、探索冻结（RSI §3.2）、记忆浏览器、改 Runner 核心、把注入块持久化进 session 消息表。

---

## 1. 目标与非目标

### 1.1 目标

1. **闭环可读：** 写路径写入的冻结记忆，在后续会话中可被模型「看见」并遵守（如偏好 pnpm）。  
2. **选择性注入：** 用本轮 user 文本（或刷新查询）经 MCP `openviking__find`（失败再 `search`）取相关条目，**不是**全量倾倒。  
3. **会话共享：** 同一 `sessionId` 内默认复用已格式化的记忆块；不每轮重打 OV。  
4. **轻量刷新：** 用户话含刷新线索，或显式 `POST /sessions/:id/memory/refresh` 时重检索并替换缓存。  
5. **门控：**  
   - `mcpServers.openviking.enabled === true`  
   - OpenViking status === `ready`  
   - `openviking.autoRecall !== false`（默认 `true`）  
   任一不满足 → 不检索、不注入（对话与今日一致）。  
6. **预算：** top‑k + 总字符硬顶；超时/失败静默降级为空块。  
7. **边界：** 逻辑在 `packages/server`（+ shared 配置/状态类型）；**禁止** `packages/core` 依赖 OV。

### 1.2 非目标

| 不做 | 理由 |
|------|------|
| `MemoryPort` | 本切片 MCP 足够；Port 后置 |
| 通用 `before_model` Hooks 总线 | 后置；本切片在 `runs.ts` 装配点调用 |
| 注入块写入 SessionStore | 避免历史膨胀与双份真相 |
| 每轮强制重检索 | 成本与延迟；用会话缓存代替 |
| 跨 session 全局「共享内存」单例 | 产品以 session 为对话边界；跨会话靠 OV 检索 |
| Desktop 完整记忆浏览器 | 后置 |
| 改 Runner / 权限核心 | RSI 纪律 |

### 1.3 成功判据（一句话）

OV ready + autoRecall 开 → 新 session 说「按我的包管理器习惯装依赖」→ 模型行为符合此前冻结的 pnpm 偏好；同 session 第二轮不重复打 OV（可观测缓存命中）；关 autoRecall 或 OV 不可用时无注入、对话正常。

---

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| 产品切片 | **读路径**（写路径对偶） |
| 注入位置 | **拼进既有 systemPrompt 尾部**（块空则不拼） |
| 检索 | **选择性** top‑k（非全量） |
| 复用 | **会话级缓存**（Server 进程内存，键 = sessionId） |
| 刷新 | **默认复用** + 线索触发重检 + 手动 refresh API |
| 开关 | `openviking.autoRecall` 默认 **true**；与 autoDistill 对称 |
| 持久化注入 | **否**（不写 session messages） |
| 进程重启 | 缓存丢失；下一 run 按首次逻辑重建 |

---

## 3. 架构

### 3.1 分层

```text
apps/desktop
  设置 · 长期记忆：
    + 「自动召回长期记忆」↔ openviking.autoRecall
    + （可选）刷新本会话记忆 → POST .../memory/refresh
        │
packages/server
  runs.ts（run 开始、组装 history 前）
        │
  MemoryRecaller.resolveForRun({ sessionId, userText, forceRefresh? })
        │ 门控 → 缓存命中? → 否则 MCP find/search → 格式化 → 写缓存
        ▼
  systemPrompt' = systemPrompt + "\n\n" + block   （block 非空时）
  Runner.run(...)   ← 不改 core
        │
  OpenViking MCP（find / search）
```

### 3.2 组件

| 组件 | 职责 |
|------|------|
| `MemoryRecaller` | 门控、缓存、检索、格式化、预算截断 |
| `SessionRecallCache` | `Map<sessionId, RecallCacheEntry>`；session 删除时可清 |
| `runs.ts` 装配钩子 | 在拼 history 前 `await resolveForRun`（短超时） |
| Desktop 开关 | 写 `autoRecall`；旁注未就绪时「当前未生效」 |

### 3.3 缓存条目

```ts
type RecallCacheEntry = {
  block: string;           // 已格式化、已截断；空串表示「已检索无命中」
  query: string;           // 形成该块时的查询文本（截断）
  fetchedAt: string;       // ISO
  hitCount: number;        // 命中条数（0 = 空结果）
  source: "find" | "search" | "empty" | "error";
};
```

「空结果」也要缓存，避免无记忆时每轮打 OV。  
`forceRefresh` / 线索刷新时覆盖条目。

---

## 4. 刷新策略

### 4.1 何时复用缓存

门控打开且 `cache.has(sessionId)` 且本次**非**强制刷新且 user 文本**不**匹配刷新线索 → 直接返回 `entry.block`。

### 4.2 何时重检索

| 触发 | 行为 |
|------|------|
| 本 session 无缓存 | 用当前 `userText` 检索 |
| `forceRefresh: true`（HTTP refresh 或内部） | 用当前/请求内 query 重检 |
| user 文本匹配刷新线索（见 §4.3） | 用当前 userText 重检 |
| 门控从关→开后的首次 run | 无缓存 → 检索 |

### 4.3 刷新线索（启发式，可调常量）

匹配 **任一** 即刷新（大小写不敏感；中英）：

- 中文：`记住`、`偏好`、`以后默认`、`别用`、`改用`、`我的习惯`、`长期记忆`  
- 英文：`remember`、`prefer`、`preference`、`from now on`、`don't use`、`always use`  

不求完美召回；宁可偶尔多检一次。常量放 `packages/server/src/memory/constants.ts`，单测覆盖样例句。

### 4.4 手动刷新 API

```http
POST /sessions/:sessionId/memory/refresh
Body (optional): { "query"?: string }
→ 200 { "ok": true, "hitCount": number, "source": "...", "cached": true }
```

- 用 `query ?? 最近一条 user 消息` 作检索文本；无 user 则 400。  
- 写缓存；**不**自动开跑对话。  
- 门控失败 → 200/409 均可，建议 **409** + `{ ok: false, reason }`（实现锁定一种并测）。

Session 删除（若已有 DELETE）时 `cache.delete(sessionId)`。

---

## 5. 检索与格式化

### 5.1 MCP 调用（白名单）

与写路径类似，Recaller 经 `mcp.getPort("openviking")` 调用，**绕过 PermissionBroker**（系统装配，非模型自主调工具）：

1. `openviking__find`，args：`{ query, limit: RECALL_TOP_K }`（若 schema 需要可加 `read_content: true`）  
2. 失败或空 → `openviking__search`，`mode: "list"`（或工具实际支持的等价）  
3. 仍失败 → `source: "error"`，`block: ""`（不阻断 run）

超时：`RECALL_TIMEOUT_MS`（建议 8_000）；超时当 error 降级。

### 5.2 预算常量（建议初值）

| 常量 | 初值 | 含义 |
|------|------|------|
| `RECALL_TOP_K` | 5 | 最多采用条数 |
| `RECALL_BLOCK_MAX_CHARS` | 3000 | 注入块硬顶 |
| `RECALL_QUERY_MAX_CHARS` | 500 | 送入 find 的 query 截断 |
| `RECALL_TIMEOUT_MS` | 8000 | 单次检索超时 |
| `RECALL_ITEM_MAX_CHARS` | 800 | 单条摘要截断 |

超预算时按相关度顺序截断条目，必要时加省略标记 `…(truncated)`。

### 5.3 注入块格式（稳定、可测）

```text
## 相关长期记忆（自动召回）
以下为与当前对话可能相关的冻结记忆，请在适用时遵守；若与用户最新指示冲突，以最新指示为准。

1. [preference] 默认使用 pnpm，不使用 npm
   when: 涉及前端/Node 包管理…
2. …
```

- 优先从工具返回中提取 `do` / 正文 / abstract；解析失败则用原始片段截断。  
- **不**要求完美还原 MemoryItem YAML；读路径以「可遵守的短要点」为准。

### 5.4 拼进 systemPrompt

```ts
const block = await recaller.resolveForRun(...);
const system = [runtime.systemPrompt, block].filter(Boolean).join("\n\n");
const history = system
  ? [{ role: "system", content: system }, ...prior]
  : prior;
```

注意：`appendMessagesBatch` 的 `skip` 计算须与「是否有 system」一致（今日已按 `runtime.systemPrompt` 判断；改为按**实际注入后的 system 是否非空**，避免 skip 错位）。  
**注入块不得**进入 `appendMessagesBatch` 持久化内容。

---

## 6. 配置与 UI

### 6.1 Schema

```ts
openviking?: {
  // ...
  autoDistill?: boolean;  // 既有，default true
  autoRecall?: boolean;   // 新增，default true
}
```

门控：`config.openviking?.autoRecall !== false`。

### 6.2 Desktop

长期记忆分区，紧挨「run 结束后自动提炼」：

- 开关标题：`自动召回长期记忆`  
- 说明：`开新对话时检索相关冻结记忆并注入；同会话复用，线索句或手动刷新时更新`  
- OV 未就绪旁注：`当前未生效：OpenViking 未就绪`  
- （可选本切片）会话工作台或设置内按钮「刷新本会话记忆」→ 调 refresh API；若时间紧，可只做设置开关 + API，按钮后置一 Task。

### 6.3 可观测（轻量）

可选 `GET /memory/recall/status?sessionId=` → 当前缓存摘要（hitCount / fetchedAt / source），供调试；非必须首版。  
日志：`[memory-recall] miss|hit|refresh|skip|error`。

---

## 7. 与写路径的交互

| 场景 | 行为 |
|------|------|
| 同 session 先对话再 distill 写入 | **不**自动使旧缓存失效（避免每轮写后都重检）；用户可用线索句或手动 refresh；或下一新 session 自然拿到新记忆 |
| 可选增强（非必须） | distill `lastStatus=ok && lastWritten>0` 时 `cache.delete(sessionId)`——**本切片不做**，以免写路径与读路径紧耦合；列入后置 |

---

## 8. 错误与降级

| 场景 | 行为 |
|------|------|
| 门控关 | 无注入，无 OV 调用 |
| find/search 404 / 超时 | 空块 + 缓存 error/empty，run 继续 |
| embedding 未配导致 OV needs_config | 门控 ready 不满足 → 跳过 |
| 解析异常 | 空块，不抛到 WS |

---

## 9. 测试

### 9.1 自动化

| 包 | 用例 |
|----|------|
| shared | `autoRecall` default true；可 false |
| server MemoryRecaller | 门控跳过；首次检索写缓存；二次命中不调 port；线索句强制重检；forceRefresh；预算截断；超时/错误 → 空块 |
| server runs 接线 | mock recaller：注入后 system 含块；skip 与持久化不含块 |
| refresh 路由 | 有/无 query；门控失败 |

### 9.2 手工冒烟

1. 已有 pnpm 冻结记忆 + embedding 可用 → 新 session「按我的包管理习惯装依赖」→ 助手倾向 pnpm。  
2. 同 session 再问无关问题 → 日志/status 显示 cache hit，无新 find（或 MCP 调用次数不增）。  
3. 说「记住我以后改用 yarn」→ 刷新检索（或 distill 后 refresh）→ 行为更新。  
4. 关 autoRecall → 无注入。

---

## 10. 文件与改动面（预期）

| 路径 | 改动 |
|------|------|
| `packages/shared/src/config.ts` (+ test) | `autoRecall` |
| `packages/server/src/memory/constants.ts` | RECALL_* + 线索正则 |
| `packages/server/src/memory/recaller.ts` (+ test) | MemoryRecaller + cache |
| `packages/server/src/memory/format-recall.ts` (+ test) | 块格式化 / 截断 |
| `packages/server/src/routes/runs.ts` | 装配前 resolve + skip 修正 |
| `packages/server/src/routes/sessions.ts` 或 `memory.ts` | refresh（+ 可选 status） |
| `packages/server/src/app.ts` | 装配 Recaller |
| `apps/desktop/.../memory-settings-panel.tsx` + store | autoRecall 开关 |
| `docs/learning/P4-MEMORY-RECALL.md` | 短记 |
| 更新 distill 规格 §12：读路径 → 本规格 |

---

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 上下文膨胀 | top‑k + 字符硬顶；会话复用 |
| 线索启发式误触发 | 常量可调；误触发仅多一次检索 |
| find 依赖 embedding | 与 P2.5b 一致；失败降级空块 |
| 缓存与新写入不同步 | 新 session / 手动 refresh / 线索句；不在本切片自动 invalidate |
| skip 算错导致消息重复或丢失 | 单测锁定「注入后 system 存在时 skip」 |

---

## 12. 实现顺序（供计划拆分）

1. shared `autoRecall`  
2. format-recall + recaller（mock ToolPort）  
3. runs 接线 + skip  
4. refresh 路由  
5. Desktop 开关（+ 可选刷新按钮）  
6. 文档 + 本机冒烟  

---

## 13. Spec 自检

- [x] 无 TBD 章节；常量给初值  
- [x] 明确不落库、不改 Runner、不做 MemoryPort  
- [x] 会话复用 + 线索/手动刷新与用户决策 C 一致  
- [x] 与 distill / embedding 门控对齐  
- [x] 成功判据可手工验证  

---

## 14. 修订既有文档（实现时）

- `2026-09-27-memory-distill-design.md` §12.1 → 链到本规格（读路径进行中/已实现）。  
- `2026-09-19-rsi-memory-design.md` §7 → 标注读路径规格。
