# OpenViking 旁路进程 + HTTP MCP — 设计规格（P2.5）

**日期：** 2026-09-26  
**状态：** **已实现**（2026-09-26）  
**实现计划：** `docs/superpowers/plans/2026-09-26-openviking-mcp.md`  
**学习短记 / 冒烟：** `docs/learning/P2.5-OPENVIKING.md`  
**关联：**  
- `2026-09-05-agent-runtime-design.md` §6.5 OpenViking、§7 P2.5  
- `2026-09-26-mcp-toolport-design.md`（HTTP MCP 管道已通；本规格在其上加进程监督与预设）  
- `2026-09-19-rsi-memory-design.md`（记忆语义 / RSI **后置**，本切片不实现）  
- `2026-09-20-ask-all-permission-design.md`（OV 工具名走同一权限环）  
**范围说明：** 交付「可选长期记忆后端」可演示闭环——仓库锁定 Python OpenViking → 复用 Provider 密钥写配置 → Agent Server 按需拉起 → 自动挂 `mcpServers.openviking` → Agent 可调 `openviking__*`；不可用时降级。**不做** `MemoryPort`、Hooks auto-recall、RSI distill。

---

## 1. 目标与非目标

### 1.1 目标

1. **仓库内 Python 依赖：** 用 uv + `pyproject.toml`（+ lock）锁定 `openviking`，不依赖用户全局盲装；不把 OV 写进 `packages/core`。
2. **内置拉起：** Agent Server 在启用条件下自动 sync / 写配置 / spawn `openviking-server`，并做 `/health` 探测。
3. **密钥复用：** 从现有 AppConfig Provider（默认 Agent 所用）映射写出/补齐 OV 配置（embedding；若可推断则含 VLM）；设置页可覆盖 OV 专用模型字段。
4. **MCP 预设：** 健康后确保 `mcpServers.openviking` 为 HTTP `http://127.0.0.1:1933/mcp`（或配置的本机 URL），并进入既有 `McpSupervisor` reconcile；工具名 `openviking__{tool}`。
5. **按需生命周期：** 仅当 `mcpServers.openviking.enabled === true` 时拉起（设置「长期记忆」开关只改该字段，无第二真相源）；关闭则停止**本 Supervisor 拉起的**子进程并断开 MCP session。
6. **降级诚实：** 失败不阻塞 Server listen / 对话；状态可观测；UI 有原因与重试。
7. **许可证明示：** 文档与设置旁注 OpenViking **AGPLv3**；默认可不强制启用。

### 1.2 非目标

| 不做 | 理由 |
|------|------|
| `@openviking/sdk` / `@openviking/cli` 替代服务端 | JS 包仅为客户端；`/mcp` 仍需 Python/Docker Server |
| `packages/core` 直接依赖 OpenViking 或 AGPL 渗入内核 | 总规格 §6.5 禁止 |
| `MemoryPort` / Hooks auto-recall / RSI distill | 独立后续切片 |
| CI 安装真实 OpenViking | 沿用 MCP mock；本机手工冒烟 |
| 随 Electron 打包完整 OV 运行时 / 强制 Docker | 体积与运维成本过大；本切片用仓库 uv |
| 火山云 OpenViking Service 一等公民 | 后置；本切片本机旁路 |
| 改 ask/allow 默认策略为 OV 特权通道 | 与其它 MCP 一致 |
| 用 OV 替换 SQLite SessionStore | 短/长期分层，不互替 |

### 1.3 成功判据（一句话）

用户配置好聊天 Provider 并打开长期记忆/openviking → Server 自动准备 Python 环境与 `ov.conf`、拉起本机 OV、MCP 出现 `openviking__*` → Agent 至少能调通一个读/检索类工具；关闭开关后自拉起进程退出；无密钥/无 uv 时对话仍可用且状态标明原因。

---

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| 接入形态 | **HTTP MCP**（非嵌入 SDK、非 MemoryPort） |
| 服务端落盘 | **仓库 uv/`pyproject` 锁定 `openviking`**，Agent Server 拉起 |
| 配置来源 | **复用 Provider 密钥**写/补 `ov.conf`；设置可覆盖 OV 模型字段 |
| 拉起时机 | **`mcpServers.openviking.enabled === true` 时** reconcile/启动链拉起；关闭则停自拉起进程 |
| 数据目录 | **`~/.agent2026/openviking/`**（配置 + OV 数据）；与 `data.sqlite` 并列 |
| 端口 / MCP URL | 默认 **`127.0.0.1:1933`**，MCP **`http://127.0.0.1:1933/mcp`** |
| 外部已运行 OV | 若 `/health` 已 ok，**复用、不重复 spawn**；shutdown **不杀**非本 Supervisor 子进程 |
| 权限 | 完整命名空间名；既有 `ask` / `ask_all` / allowlist；写类工具默认不进 `preAllowed` |
| Trace | 与其它 MCP 相同：`kind: "tool"`，`name` = `openviking__…` |
| CI | **不**装真实 OV；单元测 Supervisor 用 mock spawn/health |
| JS 可选 | 可用 `@openviking/sdk` 做 health/辅助，**非必须**；主路径 curl/fetch `/health` 即可 |

---

## 3. 架构

### 3.1 分层

```text
apps/desktop
  设置：长期记忆 / openviking 开关 · OpenVikingStatus · 重试 · AGPL 旁注
  对话：既有工具卡 / 权限卡（openviking__*）
        │ HTTP
packages/server
  OpenVikingSupervisor ──spawn/health/config──► openviking-server (Python)
  McpSupervisor        ──HTTP MCP─────────────► http://127.0.0.1:1933/mcp
  ConfigService（写入 mcpServers.openviking 预设；掩码密钥）
        │
packages/openviking-runtime/
  pyproject.toml + uv.lock（依赖 openviking）
        │
packages/mcp · packages/core
  无 OpenViking 直接依赖；仅见统一 ToolPort
```

### 3.2 `OpenVikingSupervisor` 职责

单进程级组件，与 `McpSupervisor` 并列，建议文件：`packages/server/src/openviking/supervisor.ts`（名称可微调）。

**输入：** 当前 `AppConfig`（是否 enabled、Provider 凭据、可选 OV 覆盖字段）。

**步骤（reconcile）：**

1. 若 `openviking` 未启用 → 停止本 Supervisor 记录的 child（若有）→ 返回 `stopped`。
2. 确保 uv 项目目录已 `uv sync`（失败 → `error`，原因含「未安装 uv」等）。
3. 确保 `~/.agent2026/openviking/ov.conf`（JSON）存在且含可用 embedding 密钥：  
   - 从默认 Provider 映射；`config.openviking.*` 覆盖优先。  
   - 无法写出有效配置 → `needs_config`，**不** spawn。
4. `GET http://127.0.0.1:1933/health`：  
   - 已 ok → 标记 `ready`，`ownedProcess = false`。  
   - 否则 spawn：`uv run openviking-server --config <path> --port 1933`（具体 CLI 以 upstream 为准），等待 health（超时 → `error`）。
5. 确保 `config.mcpServers.openviking` 为 HTTP 预设且与 URL 一致；若由 Supervisor 补写，经 `ConfigService` 持久化并触发 `McpSupervisor.reconcile`。
6. Server `onClose` / shutdown：仅 `kill` 本 Supervisor spawn 的 child。

**状态枚举：** `stopped | starting | ready | needs_config | error`，附 `lastError?: string`、`ownedProcess: boolean`、`mcpUrl`。

### 3.3 与 `McpSupervisor` 的边界

| 组件 | 负责 |
|------|------|
| `OpenVikingSupervisor` | Python 环境、ov.conf、进程、/health、补写 MCP 预设条目 |
| `McpSupervisor` | 连接 `/mcp`、工具发现、ToolPort、MCP status |
| Desktop | 只调 HTTP API，不直接 spawn Python |

顺序（写死）：**先** `OpenVikingSupervisor.reconcile` 至终态，**再** `McpSupervisor.reconcile`（避免 OV 未起时 MCP 重试风暴）。

### 3.4 配置映射（初版规则）

| OV 字段 | 来源 |
|---------|------|
| embedding / vlm `api_key` | 默认 Provider 的 `apiKeyEnv` → CredentialStore |
| embedding / vlm `api_base` | Provider `baseUrl`（Anthropic 等同理） |
| `provider` 字符串 | `openai_compatible` → 若 base 含 `volces.com`/`bytepluses.com` 则为 `volcengine`，否则 `openai`；`anthropic` → `openai`（OpenAI 兼容 embedding 路径，模型需用户覆盖） |
| embedding `model` / `dimension` | `openviking.embeddingModel` / `embeddingDimension`；缺省：`openai` → `text-embedding-3-small` / `1536`；`volcengine` → `doubao-embedding-vision-251215` / `1024` |
| vlm `model` | `openviking.vlmModel`；缺省用 `agents.default.model` 的 model 段 |
| `storage.workspace` | `~/.agent2026/openviking/data` |

不在日志或 `GET /config` 中回传明文密钥（沿用现有掩码）。

---

## 4. API 与 UI

### 4.1 HTTP

- `GET /openviking/status` → 上述状态视图。  
- `POST /openviking/retry` → 强制再跑一轮 OV reconcile（再触发 MCP reconcile）。  
- 启用/禁用：走现有 `PUT /config`，**唯一**真相源为 `mcpServers.openviking.enabled`（无并行 feature flag）。

### 4.2 Desktop 设置（信息架构）

对齐现有设置壳与 Figma：

| 项 | 值 |
|----|-----|
| Figma | https://www.figma.com/design/6mxCXcFGVyupqTTKbZD7GF/myagent?node-id=21-3 |
| 长期记忆分区 | `node-id=21-538`（Section F: Long-term memory） |

**不新开独立应用页。**

| 位置 | 职责 |
|------|------|
| 侧栏新分区 **「长期记忆」**（`section-memory`） | 产品入口：开关、进程状态、重试、模型覆盖、AGPL |
| 现有 **MCP** 分区 | 仍可看到 `openviking` 行与工具列表；不在此做第二套「安装/拉起」 |

侧栏顺序（与 Figma）：… → MCP → **长期记忆** → 高级 → 关于。

### 4.3 「长期记忆」分区字段

1. **标题 / 说明：**「长期记忆」；一句：跨会话检索与写入经 OpenViking（可选，AGPLv3）。  
2. **主开关：**「启用 OpenViking」↔ `mcpServers.openviking.enabled`（打开时若尚无条目则写入 HTTP 预设并挂载到 `agents.default.tools.mcpServers`）。  
3. **状态行：** 徽章 `stopped | starting | ready | needs_config | error` + `lastError`；`ready` 时区分「本进程拉起」(`ownedProcess`) / 「复用已有服务」。  
4. **操作：**「重试」→ `POST /openviking/retry`；`needs_config` 时链到「模型与 Provider」。  
5. **高级（默认折叠）：**  
   - OV embedding 模型覆盖 → `openviking.embeddingModel`  
   - OV VLM 模型覆盖 → `openviking.vlmModel`  
   - 只读 MCP URL：`http://127.0.0.1:1933/mcp`  
6. **页脚：** AGPL 一句话 + 链到 `packages/openviking-runtime/README.md` / 学习短记。

### 4.4 对话侧

- 无新空态 / 顶栏常驻状态。  
- 工具调用沿用现有工具卡 / 权限卡（`openviking__*`）与 Trace。

### 4.5 UI 明确不做

- 独立 `viking://` 记忆浏览器  
- 首次启用全屏向导  
- MCP 表单内「一键安装 OV」重复入口  

### 4.6 AppConfig 扩展（OV 覆盖）

```ts
openviking?: {
  embeddingModel?: string;
  vlmModel?: string;
  embeddingDimension?: number;
}
```

默认关闭：不在 `defaultAppConfig` 里强制加入 `mcpServers.openviking`。

---

## 5. 降级与错误

| 场景 | 行为 |
|------|------|
| 未启用 | 不 sync、不 spawn；MCP 无 openviking 或 enabled=false |
| 无 uv / sync 失败 | `error`；对话可用 |
| 无可用 Provider 密钥 | `needs_config`；对话可用 |
| 端口被非 OV 占用 | `error`（health 非预期）；不强杀外来进程 |
| spawn 后 health 超时 | `error`；清理 child |
| MCP 连上后中途断开 | 单次 tool 失败按 MCP 路径；不崩 run |
| 用户外部已起 OV | 复用；关闭开关时不断开外部进程，仅 disable MCP 条目 / 不挂载工具 |

---

## 6. 仓库布局（建议）

```text
packages/openviking-runtime/
  pyproject.toml
  uv.lock
  README.md                    # sync / 手工启动 / AGPL
packages/server/src/openviking/
  supervisor.ts
  config-map.ts                # Provider → ov.conf
  status types
apps/desktop/...               # 设置区块
docs/learning/                 # 本机冒烟短记（实现末尾补）
```

根 package 脚本示例：`pnpm ov:sync` → 对该目录 `uv sync`。

---

## 7. 验收

1. **快乐路径：** 有 uv + Provider 密钥 → 打开开关 → status `ready` → `/mcp/status` 中 openviking `ready` → 工具列表含至少一个 `openviking__*` → Agent 调用成功（如 `health` 或 `find`）且 Trace 可见。  
2. **开关：** 关闭 → 自拉起 child 退出；MCP 不再暴露该 server 工具；再开可恢复。  
3. **needs_config：** 清空密钥 → `needs_config`，Server 与对话仍健康。  
4. **无 uv：** `error` 文案可读，对话可用。  
5. **外部 OV：** 先手工起 1933 → 打开开关 → `ownedProcess=false` 且 MCP 仍可用。  
6. **文档：** 目录、AGPL、排障（doctor、端口、密钥）。  
7. **CI：** 既有测试绿；OpenVikingSupervisor 单测不依赖真实 OV。

---

## 8. 明确延后

- RSI / Hooks 自动沉淀与 recall  
- `MemoryPort`  
- 云端 OV Service、OAuth MCP  
- Docker 一等路径、Electron 内嵌 Python 运行时  
- 多租户 / 非本机 bind

---

## 9. 风险

| 风险 | 缓解 |
|------|------|
| AGPLv3 | 可选组件；文档警示；默认关闭 |
| upstream CLI/配置字段变更 | 锁版本；supervisor 集中适配；文档链 upstream |
| embedding/VLM 与 Provider 模型不兼容 | `needs_config` + 可覆盖字段；冒烟清单 |
| Windows 上 uv/spawn 路径 | plan 含 Win 冒烟；用 `uv run` 绝对路径 |
| sync 阻塞 listen | 与 MCP 相同：**异步 reconcile**，不堵 `listen` |

---

## 10. 实现顺序（预览，正式 plan 另文）

1. `packages/openviking-runtime` + 文档 AGPL  
2. `config-map` + 状态类型 + `OpenVikingSupervisor`（可注入 runner/fetcher）+ 单测  
3. 挂入 `app.ts`（异步）；`GET /openviking/status`；启用时补写 MCP 预设  
4. Desktop 设置开关与状态  
5. 本机冒烟清单 + learning 短记  

规格确认后按 `writing-plans` 拆 Task。
