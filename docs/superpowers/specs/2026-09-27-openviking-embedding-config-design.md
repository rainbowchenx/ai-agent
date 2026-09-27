# OpenViking 独立 Embedding 配置 — 设计规格

**日期：** 2026-09-27  
**状态：** **已实现**（2026-09-27）  
**前置：** `2026-09-26-openviking-mcp-design.md`（P2.5）、`2026-09-27-memory-distill-design.md`（写路径）  
**学习短记（实现后）：** `docs/learning/P2.5b-OPENVIKING-EMBEDDING.md`（待写）  
**范围说明：** 将 OpenViking 的 **embedding 端点**从「复用对话默认 Provider」改为 **独立可配置**（`baseUrl` + `model` + `apiKeyEnv`）；启用 OV 时必填，缺则 `needs_config`。VLM / 对话模型仍走现有 Provider。不改 MemoryPort / RSI recall。

---

## 1. 目标与非目标

### 1.1 目标

1. **独立 Embedding 端点：** 用户可配置与对话 Provider 不同的 embedding `baseUrl` / 模型 / 密钥引用，解决 DeepSeek 等聊天 API 不提供 embedding 导致的 `find`/`search` 404。
2. **密钥与现有体系一致：** 配置只存 `apiKeyEnv`；密钥走 `credentials.yaml` 或进程环境变量（与 Provider 相同）。
3. **启用即门控：** `mcpServers.openviking.enabled === true` 时，独立 embedding 三件套 + 可解析密钥为硬前置；否则 `needs_config`，不 spawn、不假装 ready。
4. **UI 主路径可见：** 长期记忆分区主区展示 embedding 表单（不再仅藏在「高级」折叠里）。
5. **迁移诚实：** 旧扁平 `embeddingModel` / `embeddingDimension` 读时兼容预填；**不再**静默回退到对话 Provider 当 embedding。

### 1.2 非目标

| 不做 | 理由 |
|------|------|
| 把 VLM 也改成独立端点 | 本切片只修 embedding；VLM 仍映射对话默认 Provider |
| 新建通用 `embeddingProviders` 注册表 | 当前仅 OV 使用，过重 |
| 改 distill / MemoryConsolidator 逻辑 | 写路径已通；本切片只影响 `ov.conf` 映射与门控 |
| CI 装真实 OV / 调真实 embedding API | 单测 mock；本机手工冒烟 |
| 在 UI 做 embedding 连通性探测按钮 | 后置；冒烟靠 `openviking__find` / health |
| 支持非 OpenAI-compatible embedding 协议 | OV `ov.conf` 仅 `openai` / `volcengine` |

### 1.3 成功判据（一句话）

对话用 DeepSeek、embedding 配独立 OpenAI（或兼容）端点 → 启用 OV → `ready` → 自动提炼写入后 `openviking__find` / 语义 `search` 不再因 embedding 404 失败；缺 embedding 配置时启用 OV → `needs_config` 且对话不受阻。

---

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| 配置深度 | **完全独立端点**（baseUrl + model + apiKeyEnv），不依赖 Provider 列表条目 |
| 密钥 | **`apiKeyEnv` + credentials/env**（与 Provider 同环） |
| 门控 | **启用 OV 即必填**；缺字段或缺 Key → `needs_config`，不拉起 |
| 结构 | **`openviking.embedding` 嵌套对象**（非扁平、非顶层注册表） |
| 旧字段 | 读兼容预填；保存写新结构；**禁止**再用对话 Provider 填 embedding |
| VLM | **不变**：仍用对话默认 Provider + 可选 `vlmModel` 覆盖 |
| UI | 长期记忆**主区**表单；「高级」仅保留 VLM 覆盖与只读 MCP URL（或等价简化） |

---

## 3. 配置模型

### 3.1 Schema（`packages/shared`）

```ts
openviking?: {
  embedding?: {
    baseUrl: string;              // min(1)，OpenAI-compatible API root
    model: string;                // min(1)，如 text-embedding-3-small
    apiKeyEnv: string;            // min(1)，如 OPENVIKING_EMBEDDING_API_KEY
    dimension?: number;           // int > 0；缺省见 §3.3
    provider?: "openai" | "volcengine"; // 缺省由 baseUrl 推断
  };
  vlmModel?: string;
  autoDistill?: boolean;          // default true（既有）
  // deprecated — Zod 仍 accept，读兼容；新写入应省略
  embeddingModel?: string;
  embeddingDimension?: number;
};
```

Zod：`embedding` 对象内 `baseUrl` / `model` / `apiKeyEnv` 在**对象存在时**均 `min(1)`；整个 `embedding` 仍 optional（未启用 OV 时允许缺省）。启用时的必填由 Supervisor / `mapProviderToOvConf`（建议改名为 `mapToOvConf`）强制。

### 3.2 默认建议值（UI placeholder，非静默写入）

| 字段 | Placeholder / 建议 |
|------|-------------------|
| `baseUrl` | `https://api.openai.com/v1` |
| `model` | `text-embedding-3-small` |
| `apiKeyEnv` | `OPENVIKING_EMBEDDING_API_KEY` |
| `dimension` | 留空 → 映射时推断 |
| `provider` | 留空 → 由 baseUrl 推断 |

UI **不**在用户未保存时把 placeholder 写进 config。

### 3.3 Provider / dimension / input 推断

沿用现有 `config-map` 逻辑，但**仅针对 embedding.baseUrl**（不再用对话 Provider 的 baseUrl）：

| 条件 | `provider` | 默认 `dimension` | `input` |
|------|------------|------------------|---------|
| baseUrl 匹配 `volces.com` / `bytepluses.com` | `volcengine` | 1024 | `multimodal` |
| 其它（含显式 `provider: "openai"`） | `openai` | 1536 | `text` |

若用户填写 `dimension` / `provider`，覆盖推断。  
若 `provider === "volcengine"` 且未填 model，**不再**静默填 doubao 默认名——启用 OV 时 model 已是必填；映射失败则 `needs_config`。

### 3.4 迁移（读路径）

| 磁盘状态 | 行为 |
|----------|------|
| 已有完整 `openviking.embedding` | 使用新结构 |
| 仅有旧 `embeddingModel` / `embeddingDimension` | UI 预填 model/dimension；`baseUrl`/`apiKeyEnv` 空；启用 → `needs_config`，文案提示补全独立 embedding |
| 两者皆无 | 同上，表单空白 + placeholder |
| 保存 | 只写 `embedding` 嵌套 + 既有 `vlmModel`/`autoDistill`；**省略**旧扁平键 |

不做自动「从对话 Provider 拷贝 baseUrl/Key」的静默迁移（那正是本次要消灭的行为）。

---

## 4. 架构与数据流

```text
设置：长期记忆
  embedding.baseUrl / model / apiKeyEnv [/ dimension]
  + 密钥写入 credentials(apiKeyEnv)（与模型页同环）
        │ PUT /config · PUT /credentials
packages/server
  OpenVikingSupervisor.reconcile
        │ enabled?
        ├─ 校验 openviking.embedding 三件套
        ├─ resolveCredential(embedding.apiKeyEnv)
        ├─ mapToOvConf → write ov.conf
        │     embedding.dense ← 独立 embedding
        │     vlm             ← 对话默认 Provider（不变）
        └─ spawn / reuse → ready | needs_config | error
对话：openviking__find / search → OV 调独立 embedding API
```

### 4.1 `mapToOvConf`（原 `mapProviderToOvConf`）

输入扩展：

```ts
{
  config: AppConfig;
  embeddingApiKey: string | undefined;  // 来自 embedding.apiKeyEnv
  chatApiKey: string | undefined;       // 来自对话默认 Provider（仅 VLM）
  dataDir: string;
}
```

失败原因（`ok: false`）优先级建议：

1. 缺少 `openviking.embedding.baseUrl|model|apiKeyEnv` → 文案明确「请配置独立 Embedding」  
2. `embeddingApiKey` 空 → 「缺少 Embedding API Key（{apiKeyEnv}）」  
3. 对话 Provider / `chatApiKey` 缺失 → 仅当需要写 VLM 时失败（与今日「缺聊天 Key」一致；若产品上允许「仅 embedding、VLM 后补」，本切片**仍要求**聊天 Provider Key 可解析，以免半残 `ov.conf`——与 P2.5 行为对齐）

> 注：启用 OV 时同时需要聊天 Provider Key（VLM）+ embedding Key。两者都缺时优先报 embedding（用户本切片关注点），再报聊天 Key亦可；实现选一种并单测锁定。

### 4.2 Supervisor

- `enabled === false`：行为不变（stopped / 杀自有进程）。  
- `enabled === true`：先映射；`!mapped.ok` → `needs_config` + `lastError`。  
- 映射成功后写 `ov.conf`（mode `0o600`）、health / spawn 逻辑不变。  
- **配置变更**（PUT `/config` 改 embedding 或 credentials）：既有 reconcile 钩子须触发；若已 ready 且 embedding 变更，应重写 `ov.conf` 并**重启自有进程**（或至少标记需重启）。最低要求：重写 conf + 若 `ownedProcess` 则 kill 后重新 spawn；外部复用进程则 `lastError` 旁注「已写 conf，请重启外部 OV」（可与现网行为对齐，单测覆盖 owned 路径）。

### 4.3 Config 掩码

`GET /config` 不返回密钥明文（本就没有）。`apiKeyEnv` 为引用名，可原样返回。credentials 列表继续按既有 mask。

---

## 5. Desktop UI

### 5.1 长期记忆分区布局（自上而下）

1. 启用 OpenViking（开关）  
2. run 结束后自动提炼（开关 + 未就绪旁注 + 上次 distill 旁注）  
3. **Embedding 配置块（主区，新）**  
   - Base URL（text）  
   - 模型名（text）  
   - API Key 环境变量名（text，默认建议 `OPENVIKING_EMBEDDING_API_KEY`）  
   - API Key（password；保存走 `PUT /credentials`，与模型页同模式：env 已存在则只读提示）  
   - 维度（optional number）  
   - 「保存 Embedding」主按钮（或与开关联动：改后显式保存）  
4. 状态行：badge / 重试 / 链到「模型与 Provider」（VLM 仍可能需要）  
5. 高级（折叠）：VLM 模型覆盖、只读 MCP URL  
6. AGPL / 文档旁注  

移除高级区「Embedding 模型覆盖」旧控件（避免双入口）。

### 5.2 交互细则

- 保存 Embedding：写 `openviking.embedding` +（若用户输入了新 Key）写 credentials；然后 refresh OV status。  
- 启用开关在 embedding 未齐时：允许打开，但 status 应为 `needs_config`（与今日无 Key 行为一致），UI 旁注指向 embedding 表单。  
- `needs_config` 时 distill 门控仍为关闭（既有 `ready` 要求）。

### 5.3 settings-store

- `serializeOpenViking` 改为序列化 `embedding` 嵌套 + `vlmModel` + `autoDistill`；不再写旧扁平键。  
- 新增 `saveOpenVikingEmbedding({ baseUrl, model, apiKeyEnv, dimension?, apiKey? })`。  
- 废弃/收缩 `saveOpenVikingOverrides` 中的 embeddingModel 路径（可保留仅保存 `vlmModel`）。

---

## 6. 错误与可观测性

| 场景 | status | lastError 要点 |
|------|--------|----------------|
| 缺 embedding 字段 | `needs_config` | 请配置独立 Embedding（baseUrl / model / apiKeyEnv） |
| 缺 embedding Key | `needs_config` | 缺少 Embedding API Key（ENV_NAME） |
| 缺聊天 Provider Key | `needs_config` | 沿用现有文案（VLM） |
| uv / spawn 失败 | `error` | 既有 |
| embedding API 运行时 404 | `ready`（进程健康） | 不在 Supervisor 探测；对话工具结果暴露；文档说明核对 model/baseUrl |

`GET /openviking/status` 形状不变。可选：`lastError` 前缀区分 `embedding:` / `vlm:`（非必须）。

---

## 7. 测试

### 7.1 自动化（无真实 OV）

| 包 | 用例 |
|----|------|
| `packages/shared` | Zod 接受完整 `embedding`；缺子字段 reject（对象存在时）；仍接受旧扁平键；`autoDistill` 默认不变 |
| `packages/server` config-map | 独立 embedding 写入 `ov.conf`；缺三件套 / 缺 embedding Key → `ok: false`；VLM 仍来自聊天 Provider；volcengine baseUrl 推断；**不再**在无 embedding 块时用聊天 baseUrl 填 dense |
| `packages/server` supervisor | enabled + 无 embedding → `needs_config`；enabled + 齐备 mock → 写 conf 并走 spawn/health；改 embedding 后 owned 进程重启（若实现） |
| Desktop（若有 store 测） | serialize 含 embedding、不含旧键 |

### 7.2 手工冒烟

1. 对话 Provider = DeepSeek；配置独立 embedding（OpenAI 或兼容）+ Key → 启用 OV → `ready`。  
2. 聊一轮偏好 → distill `lastStatus=ok` → `openviking__find` 查询关键词命中（或不报 embedding 404）。  
3. 清空 embedding / Key → 启用 → `needs_config`，对话仍可用。  
4. 仅填旧时代 `embeddingModel`、无新结构 → `needs_config`，UI 预填 model。

---

## 8. 文件与改动面（预期）

| 路径 | 改动 |
|------|------|
| `packages/shared/src/config.ts` (+ test) | `openviking.embedding` schema；保留 deprecated 扁平键 |
| `packages/server/src/openviking/config-map.ts` (+ test) | 独立 embedding 映射；改名或保留函数名但改语义 |
| `packages/server/src/openviking/supervisor.ts` (+ test) | resolve embedding credential；门控 |
| `apps/desktop/.../memory-settings-panel.tsx` | 主区 embedding 表单 |
| `apps/desktop/.../settings-store.ts` | serialize / save embedding + credentials |
| `docs/learning/P2.5-OPENVIKING.md` | 修正「复用 Provider 当 embedding」表述；链到本规格 |
| `docs/learning/P2.5b-OPENVIKING-EMBEDDING.md` | 实现后短记 + 冒烟勾选 |
| `packages/openviking-runtime/README.md` | 配置独立 embedding 说明（简短） |

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 已启用 OV 的用户升级后突然 `needs_config` | 预期破坏性；设置页明确表单 + learning 短记迁移步骤 |
| 用户把 DeepSeek baseUrl 填进 embedding | 门控无法识别；冒烟/文档说明须用真实 embedding 端点 |
| dimension 与模型不匹配 | 可选字段 + 默认推断；失败时工具错误可见 |
| 改 conf 不重启导致旧 embedding 仍在内存 | owned 路径强制重启；外部复用旁注 |

---

## 10. 实现顺序（供计划拆分）

1. shared schema + 测试  
2. config-map 独立 embedding + 测试（打破「聊天 Provider 填 dense」）  
3. supervisor 门控 + credential resolve + 测试  
4. Desktop 表单 + store 序列化  
5. 文档 / learning 短记  
6. 本机冒烟（DeepSeek 聊天 + 独立 embedding）

---

## 11. Spec 自检

- [x] 无 TBD/占位符章节  
- [x] 与 P2.5「复用 Provider 写 embedding」决策**有意冲突**并在本文 §1/§2 声明取代关系  
- [x] 不扩大到 VLM 独立端点 / MemoryPort  
- [x] 门控、迁移、UI、测试、冒烟均有对应条目  
- [x] 密钥不进 config 明文  

---

## 12. 修订 P2.5 相关表述

实现时同步改：

- `docs/superpowers/specs/2026-09-26-openviking-mcp-design.md` §1.1.3 / §2「密钥复用」→ 注明 **embedding 改为独立配置（见 2026-09-27-openviking-embedding-config）**；VLM 仍复用聊天 Provider。  
- `docs/learning/P2.5-OPENVIKING.md` 冒烟备注中「映射到 DeepSeek + text-embedding-3-small」改为指向独立 embedding 配置。
