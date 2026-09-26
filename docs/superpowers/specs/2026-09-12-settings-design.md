# 设置中心（Settings Hub）— 设计规格

**日期：** 2026-09-12  
**状态：** 已确认（UI 已对齐设计稿）；本规格指导热配置落地  
**关联：** `2026-09-05-agent-runtime-design.md`（配置模型 §4.2、权限 §5.2）；计划见 `docs/superpowers/plans/2026-09-12-settings-runtime.md`  
**参考：** [DeepSeek Harness — Models / Credentials](https://deepseek-harness.github.io/deepseek-harness/en/guide/providers)、Claude Code「配置与密钥分离 + 会话内切模型」

---

## 1. 目标与非目标

### 1.1 目标

- 交付 **独立于 Agent Runtime 的设置中心**：完整设置壳（多分区导航），尽量在页面完成配置。
- **运行时热生效**：保存后下一轮 run / 下一次模型请求即用新配置与凭证，无需重启进程、无需反复改 `.env`。
- **模型切换**：设置页改默认模型；工作台顶栏快捷切换（同源数据）。
- **密钥与配置分离**（对齐 Harness）：UI 可写入 API Key，且 **只写不读**；磁盘 credentials 存值，`config.yaml` 只存引用。
- 为后续 MCP / 权限确认流 / 更多外观项预留分区，不阻塞 v1。

### 1.2 非目标（本规格不做）

- 登录、注册、OAuth、多用户、云同步。
- OS 系统钥匙串 / Credential Manager 作为主存储（可列为后续增强；v1 用本机 credentials 文件）。
- MCP 服务器真实连接与 CRUD 实装（本设置规格仍为占位；完整设计见 `2026-09-26-mcp-toolport-design.md`）。
- `ask_all` 权限的完整 UI 确认环（字段可编辑；确认交互后补）。
- 项目级 `<workspace>/.agent2026/config.yaml` 覆盖（规格预留，v1 只做用户级全局配置）。

---

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| 产品范围 | **只做设置**；登录延后 |
| 壳形态 | **方案 3**：完整设置壳（侧栏多分区）；v1 做实 Models / Agent / 权限字段 / 外观主题 / 关于；MCP 等占位 |
| UX 参考 | DeepSeek Harness Settings→Models + 凭证缝；Claude 式顶栏/会话切模型 |
| 密钥 | 页面可填；write-only；存 `~/.agent2026/credentials.yaml`；config 保留 `apiKeyEnv` 作引用名 |
| env | 仅兜底；若进程 env 已提供同名引用，UI 标「来自环境、只读」 |
| 热加载 | `PUT /config` + 凭证 API 写入后内存立即更新；Runner **每次 run 重新装配**（或等价地 resolve 最新 config/credential） |
| 模块边界 | Settings 为独立应用能力：读写 Config/Credentials API；`core` Runner 不关心设置 UI |
| UI 视觉 | **由用户出稿**；工程先锁分区、字段、API 与生效语义；可用占位布局对接 |

---

## 3. 设置壳信息架构

```text
设置（独立全页或全屏面板；不继续塞在聊天 Sheet 里作为最终形态）
├── 侧栏导航
│   ├── 模型与 Provider     ← v1 做实
│   ├── Agent               ← v1 做实
│   ├── 权限                ← v1 字段可编辑；确认流后补
│   ├── 外观                ← v1：主题
│   ├── MCP                 ← 占位「即将支持」
│   ├── 高级                ← A2A 开关只读/可关；其它预留
│   └── 关于                ← 版本、路径、health
└── 工作台顶栏：模型切换器（与「默认模型」同源；见 §6.3）
```

P0 的 Sheet 内 `ProviderSettings` 在设置中心落地后 **迁移/降级为入口跳转或删除**，避免双写。

---

## 4. 配置面清单

### 4.1 v1 做实（来自现有 `AppConfig` + Runner 缺口 + 客户端）

#### 模型与 Provider

| 字段 / 能力 | 来源 | UI 行为 |
|-------------|------|---------|
| Provider 列表 | `providers.entries` | 卡片列表；预设 DeepSeek / OpenAI；可添加自定义 `openai_compatible` |
| `type` | schema | v1 以 `openai_compatible` 为主；`anthropic` 可显示但标「未接入」或隐藏 |
| `baseUrl` | config | 可编辑 |
| `models[]` | config | 可编辑列表；可作选择器数据源 |
| 默认 Provider | `providers.default` | 可切换 |
| 默认模型 | `agents.default.model`（`providerId/modelName`） | 设置页 + 顶栏切换器 |
| API Key | credentials | 掩码输入；保存后只显示「已配置」；永不回显明文 |
| 引用名 | `apiKeyEnv` | 默认如 `OPENAI_API_KEY` / `DEEPSEEK_API_KEY`；高级可改引用名 |

#### Agent

| 字段 | 来源 | UI 行为 |
|------|------|---------|
| `systemPrompt` | config | 多行文本 |
| `tools.builtin` | config | `http_fetch` / `read_file` 开关 |
| `maxTurns` | **升入 config**（现仅 Runner 构造参数） | 数字输入，有合理上下限 |
| `maxToolCalls` | **升入 config**（可选，默认不限制或大数） | 数字输入，可空=不限制 |

#### 权限

| 字段 | 来源 | UI 行为 |
|------|------|---------|
| `permissions.mode` | config | `default` / `ask_all` / `allowlist` |
| `permissions.allowlist` | config | 字符串列表编辑 |
| 说明 | — | `ask_all` 在确认 WS 未完成前，UI 提示「保存后将按该模式执行；确认弹窗后续版本」 |

#### 外观（客户端本地）

| 字段 | 存储 | UI 行为 |
|------|------|---------|
| `theme` | 桌面本地（如 `localStorage` 或 Electron `userData/ui-preferences.json`） | `light` / `dark` / `system` |
| 其它（字体等） | 同左 | 分区预留，v1 可不做控件 |

**说明：** 主题不进 Server `AppConfig`，避免无头 Server / 未来 CLI 被桌面偏好污染。

#### 关于（只读）

| 项 | 说明 |
|----|------|
| 应用 / 包版本 | desktop + server `version` |
| Server base URL | preload / health |
| `config.yaml` 路径 | Server 返回或约定 `~/.agent2026/config.yaml` |
| `credentials.yaml` 路径 | 约定 `~/.agent2026/credentials.yaml` |
| health | `GET /health` |

### 4.2 设置壳占位（后续补充）

| 分区 / 项 | 备注 |
|-----------|------|
| MCP 服务器 CRUD、`tools.mcpServers` | 待 `packages/mcp` 接入 |
| Sidecar | 待 sidecar 实装 |
| Hooks | 规格已有，未实装 |
| 项目级配置覆盖 | 设计规格预留 |
| 连通性试连（ping models） | 增强项，可紧随 Models v1 |
| OS 钥匙串升级凭证后端 | 替换 local credentials provider |

### 4.3 明确不做（本阶段）

登录态、账号、密钥回显、把明文 key 写入可提交的仓库配置。

---

## 5. 存储与凭证模型（Harness 对齐）

### 5.1 文件

| 文件 | 内容 | 权限预期 |
|------|------|----------|
| `~/.agent2026/config.yaml` | 非密钥配置（现有 `AppConfig` + `agents.default.maxTurns` 等扩展） | 普通用户文件 |
| `~/.agent2026/credentials.yaml` | `map<refName, secretValue>`，如 `OPENAI_API_KEY: sk-...` | 尽量 owner-only（Windows ACL / Unix `0600`） |
| 桌面 UI 偏好 | `theme` 等 | 仅 Electron 用户目录 |

### 5.2 解析优先级（每次模型请求）

```text
resolve(apiKeyEnv):
  1. 若 process.env[apiKeyEnv] 非空 → 使用 env（source=env, writable=false）
  2. 否则若 credentials[apiKeyEnv] 非空 → 使用文件（source=credentials, writable=true）
  3. 否则 → 未配置（UI 可写）
```

空字符串一律视为「未配置」（与 Harness「empty is absent」一致）。

### 5.3 API 面（Server）

在现有 `GET/PUT /config` 之上增加凭证缝（名称可微调，语义固定）：

| 方法 | 路径 | 行为 |
|------|------|------|
| `GET` | `/credentials` | 返回 **描述符**列表：`{ ref, configured, source?, writable }`，**从不返回 secret** |
| `PUT` | `/credentials/:ref` | body `{ value: string }`；空 value = 删除/清除；写入后热生效 |
| `GET` | `/config` | 现有；可附带脱敏摘要（可选） |
| `PUT` | `/config` | Zod 校验；失败保留上一份有效配置；成功 `writeAppConfig` + 内存替换 |

桌面设置页：**保存 Provider 时**分别调用 config PUT 与（若用户填写了新 key）credentials PUT。

### 5.4 热生效规则

| 变更 | 生效时机 |
|------|----------|
| Provider / baseUrl / 默认模型 / systemPrompt / tools / permissions / maxTurns | **下一轮** `startRun` 装配时读取最新 config |
| API Key | **下一次** `ModelPort` 请求 `resolve` |
| 主题 | 立即作用于 renderer |
| 进行中的 run | **不打断**；不中途替换该 run 的 model/tools（避免半局状态） |

装配：每次 run 使用 `configService.get()` + `resolveCredential`，禁止在进程启动时缓存死 Model 实例的密钥。

### 5.5 ConfigService（独立性 + 热生效的中枢）

设置 UI **不得**直接触碰 Runner / Session。Server 内唯一配置入口为 `ConfigService`：

```text
Settings UI ──HTTP──► routes/config|credentials
                            │
                            ▼
              ConfigService.set / CredentialStore.set
                            │
              validate → persist → memory → onChange listeners
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
   下一轮 assemble     resolveCredential   桌面订阅刷新
   (getEffective)      (每次模型请求)      (顶栏模型名等)
```

规则：

- `get()` / `getEffective()`：返回当前内存中的有效 `AppConfig`。
- `set(next)`：Zod 失败则拒绝并保留旧配置；成功则写盘并 `emit('change')`。
- 进行中的 run **不中途换** model/tools；下一轮 `startRun` 再 `assembleRuntime({ config: configService.get(), resolveCredential })`。
- 主题等客户端偏好走 `ui-store`，不进入 `ConfigService`。

---

## 6. 桌面行为

### 6.1 路由 / 入口

- 工作台提供「设置」入口 → 进入设置中心（全页或全屏层）。
- 设置与聊天解耦：Settings 状态 store 可独立于 `session-store`（或清晰子模块），避免和 run 流搅在一起。

### 6.2 Models 页交互要点（供 UI 稿）

- Provider 卡片：名称、baseUrl、已配置徽章、Edit。
- Key 字段：placeholder 在已配置时为「已配置 — 输入新值以替换」；提交前可本地暂存，成功后清空输入框。
- 预设一键填充 DeepSeek（`https://api.deepseek.com` + `deepseek-chat`）/ OpenAI。
- 保存成功 toast/文案：「已保存，下一轮对话生效」。

### 6.3 模型切换器

- 数据源：`providers.entries[id].models` + 当前 `agents.default.model`。
- 切换 = 更新 `agents.default.model`（及必要时 `providers.default`）并 `PUT /config`。
- **会话策略（v1）：** 切换立即改全局默认；**已开始的 run 不改**；历史消息不回溯。  
  （后续可做「仅当前会话覆盖」，本规格不强制。）

### 6.4 外观

- `theme` 三种；应用在 `document.documentElement` 的 class（与现有 `.dark` CSS 变量对齐）。

---

## 7. 模块与包边界

```text
apps/desktop
  features/settings/     ← 页面、分区、本地 theme
  （经 HTTP 调 server）

packages/server
  routes/config.ts       ← 已有，扩展字段校验
  routes/credentials.ts  ← 新增
  credentials/store.ts   ← 读写 credentials.yaml + describe/resolve
  assemble/runtime.ts    ← resolve 密钥；读 maxTurns

packages/shared
  AppConfig Zod 扩展 maxTurns / maxToolCalls
  CredentialInfo DTO（无 secret）

packages/core
  不依赖设置 UI；继续只吃 ports + 传入的 permissions / prompts
```

**独立性原则：** 删除或替换 Settings UI 不影响 Runner 单测；无桌面时仍可用 `config.yaml` + `credentials.yaml` + env 运行 Server。

---

## 8. `AppConfig` 增量（v1）

在现有 schema 上：

```yaml
agents:
  default:
    model: openai/deepseek-chat
    systemPrompt: "..."
    maxTurns: 8          # 新增；默认与当前装配一致或文档约定
    maxToolCalls: null   # 新增；null/省略 = 不限制
    tools:
      builtin: [http_fetch, read_file]
      mcpServers: []
      sidecars: []
```

`providers.entries.*.apiKeyEnv` 语义不变：表示 **凭证引用名**，不再暗示「只能从环境变量读」。

---

## 9. 成功标准

1. 用户可在设置中心完成：选 Provider、填 Base URL、写入 API Key、选默认模型，**不依赖**手动维护 `.env`（env 仍可作为高级/CI 兜底）。
2. 保存后无需重启 Electron/Server，新开对话即用新模型/密钥。
3. 顶栏可切换模型，与设置页默认模型一致。
4. `GET /credentials` 响应中无任何 secret 明文；UI 不回显已存 key。
5. 可改 systemPrompt、builtin 工具开关、maxTurns、permissions.mode，并在下一 run 体现。
6. 可切换主题，刷新后保持。
7. MCP / 高级分区可见占位，不假装已可用。
8. 相关 Vitest：config 扩展、credentials describe/resolve 优先级、assemble 使用 resolved key。

---

## 10. 实施分期（供后续 writing-plans）

| 阶段 | 内容 |
|------|------|
| S1 | credentials 存储 + API；assemble resolve；config 增加 maxTurns/maxToolCalls |
| S2 | 设置壳路由/侧栏 + Models 页对接（含迁移 P0 Sheet） |
| S3 | Agent / 权限字段页；顶栏模型切换器 |
| S4 | 外观 theme；关于页；占位分区 |
| S5 |（可选）试连、会话级模型覆盖、钥匙串后端 |

**UI 出稿节点：** 本规格审阅通过后，用户按 §3 / §4.1 / §6 出视觉与交互稿；工程按稿实现 S2–S4，无需再改分区语义除非稿面冲突。

---

## 11. 与旧规格的关系

- 修正原「密钥仅环境变量」的产品表述：改为 **引用 + credentials/env 双后端**，禁止明文进可提交项目配置的约束不变。
- P1「配置 UI」由本规格具体化；Trace 面板仍不在本规格。
- 登录仍为非目标，与 runtime-design §1.2 一致。
