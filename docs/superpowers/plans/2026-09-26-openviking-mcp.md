# OpenViking 旁路进程 + HTTP MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在设置「长期记忆」打开开关后，Agent Server 用仓库内 uv 依赖准备 OpenViking、写出 `ov.conf`、按需拉起本机服务，并经既有 HTTP MCP 暴露 `openviking__*` 工具；失败时降级且对话可用。

**Architecture:** `packages/openviking-runtime` 锁定 Python `openviking`；`OpenVikingSupervisor`（server）负责 sync / 写配置 / spawn /health；先 OV reconcile 再 `McpSupervisor.reconcile`；Desktop 新增「长期记忆」分区只调 HTTP API。

**Tech Stack:** TypeScript monorepo、pnpm、Fastify、Vitest、React/Zustand、uv + Python OpenViking、既有 `@agent2026/mcp` HTTP client

**Spec:** `docs/superpowers/specs/2026-09-26-openviking-mcp-design.md`（**已确认**）

## UI Reference

| 项 | 值 |
|----|-----|
| Figma | https://www.figma.com/design/6mxCXcFGVyupqTTKbZD7GF/myagent?node-id=21-3 |
| `fileKey` | `6mxCXcFGVyupqTTKbZD7GF` |
| 整页 `nodeId` | `21:3`（Main / 设置） |
| 长期记忆分区 `nodeId` | `21:538`（Section F: Long-term memory (OpenViking)） |
| 对齐范围 | Desktop 设置 →「长期记忆」卡片：标题/说明、启用开关、状态行、重试、链到 Provider、高级折叠、AGPL 页脚；复用现有 `SettingsSection` / toggle 视觉，不重做设置壳 |

**Figma 文案（Task 6 写死）：**

- 标题：`长期记忆`
- 说明：`跨会话检索/写入走 OpenViking（AGPLv3 可选）`
- 开关：`启用 OpenViking` / 副文案 `开启后 Agent 可通过 openviking__* 工具跨会话读写记忆`
- 状态示例：徽章 `ready` + `复用已有服务`（`ownedProcess===false`）；自拉起时用 `本进程拉起`
- 操作：`重试`；链接 `配置模型与 Provider`（滚到 `section-models`）
- 高级摘要：`OV embedding / VLM 模型名覆盖与 MCP URL`
- 页脚：`OpenViking 以 AGPLv3 提供。` + `查看文档`

## Global Constraints

- **禁止** `packages/core` / `packages/mcp` 依赖 OpenViking Python 或 AGPL 渗入内核。  
- 真相源启停：仅 `mcpServers.openviking.enabled`。  
- 顺序：**先** OV supervisor，**再** MCP supervisor。  
- 异步 reconcile，**不**阻塞 `listen`。  
- Shutdown **只杀**本 Supervisor spawn 的 child。  
- CI **不**装真实 OV；单测注入 mock runner/fetcher。  
- 不实现：MemoryPort、RSI、Hooks auto-recall、云端 OV、记忆浏览器。  
- 每任务单独 commit（执行时用户未禁止则可提交；若用户要求暂缓 commit 则跳过 commit 步）。

---

## File map

| 文件 | 职责 |
|------|------|
| `packages/openviking-runtime/pyproject.toml` | 锁定 `openviking` |
| `packages/openviking-runtime/uv.lock` | 可复现锁（`uv lock` 生成） |
| `packages/openviking-runtime/README.md` | AGPL、手工 sync/启动、排障 |
| `packages/shared/src/config.ts` | `openviking?` 覆盖字段 Zod |
| `packages/shared/src/api.ts` | `OpenVikingStatusView` |
| `packages/server/src/openviking/paths.ts` | `~/.agent2026/openviking/*` |
| `packages/server/src/openviking/config-map.ts` | Provider + 覆盖 → ov.conf JSON |
| `packages/server/src/openviking/supervisor.ts` | sync / spawn / health / 补写 MCP 预设 |
| `packages/server/src/openviking/supervisor.test.ts` | mock 单测 |
| `packages/server/src/routes/openviking.ts` | `GET /openviking/status`、`POST /openviking/retry` |
| `packages/server/src/app.ts` | 挂 OV + 链式 reconcile + shutdown |
| `package.json` | `ov:sync` 脚本 |
| `apps/desktop/src/lib/api.ts` | fetch status / retry |
| `apps/desktop/src/stores/settings-store.ts` | OV 状态与开关保存 |
| `apps/desktop/src/components/settings/memory-settings-panel.tsx` | 长期记忆 UI |
| `apps/desktop/src/components/settings/settings-page.tsx` | 侧栏分区 |
| `docs/learning/P2.5-OPENVIKING.md` | 冒烟清单 |

**常量（全 plan 统一）：**

```ts
export const OPENVIKING_HOST = "127.0.0.1";
export const OPENVIKING_PORT = 1933;
export const OPENVIKING_MCP_URL = "http://127.0.0.1:1933/mcp";
export const OPENVIKING_SERVER_NAME = "openviking";
```

---

### Task 1: `packages/openviking-runtime` + 根脚本

**Files:**
- Create: `packages/openviking-runtime/pyproject.toml`
- Create: `packages/openviking-runtime/README.md`
- Create: `packages/openviking-runtime/uv.lock`（本机执行 `uv lock` 生成；若环境无网，提交说明并在 README 写 `uv lock && uv sync`）
- Modify: `package.json`（加 `ov:sync`）

**Interfaces:**
- Produces: 目录可作为 `uv --project packages/openviking-runtime run openviking-server …` 的 project root

- [ ] **Step 1: 写入 `pyproject.toml`**

```toml
[project]
name = "agent2026-openviking-runtime"
version = "0.0.0"
description = "Pinned OpenViking server runtime for agent2026 (AGPLv3). Optional sidecar."
requires-python = ">=3.11"
dependencies = [
  "openviking>=0.1.0",
]

[project.optional-dependencies]
# none
```

（若 PyPI 上包名/版本下限与上游不符，以 `uv add openviking` 实际解析为准，锁进 `uv.lock`。）

- [ ] **Step 2: README（必须含 AGPL）**

写明：AGPLv3；`pnpm ov:sync`；数据目录 `~/.agent2026/openviking`；默认 MCP URL；与 Agent 开关关系；排障 `curl http://127.0.0.1:1933/health`。

- [ ] **Step 3: 根脚本**

```json
"ov:sync": "uv sync --project packages/openviking-runtime"
```

- [ ] **Step 4: 本机验证**

Run: `pnpm ov:sync`  
Expected: 成功或明确缺 `uv` 的错误（后者可接受，Supervisor 会映射为 `error`）。

- [ ] **Step 5: Commit**

```bash
git add packages/openviking-runtime package.json
git commit -m "$(cat <<'EOF'
chore(openviking): add uv-pinned runtime package and ov:sync

EOF
)"
```

---

### Task 2: Shared 类型 — `openviking` 配置覆盖 + status DTO

**Files:**
- Modify: `packages/shared/src/config.ts`
- Modify: `packages/shared/src/config.test.ts`
- Modify: `packages/shared/src/api.ts`
- Modify: `packages/shared/src/index.ts`（导出新类型）

**Interfaces:**
- Produces:
  - `AppConfig.openviking?: { embeddingModel?: string; vlmModel?: string; embeddingDimension?: number }`
  - `OpenVikingStatusView`: `{ status: "stopped"|"starting"|"ready"|"needs_config"|"error"; lastError?: string; ownedProcess: boolean; mcpUrl: string; enabled: boolean }`

- [ ] **Step 1: 写失败测试（config 接受 openviking 块）**

在 `config.test.ts` 增加：

```ts
it("accepts optional openviking model overrides", () => {
  const config = parseAppConfig({
    ...defaultAppConfig(),
    openviking: {
      embeddingModel: "text-embedding-3-small",
      vlmModel: "gpt-4.1",
      embeddingDimension: 1536,
    },
  });
  expect(config.openviking?.embeddingModel).toBe("text-embedding-3-small");
});
```

- [ ] **Step 2: Run 确认失败**

Run: `pnpm --filter @agent2026/shared test -- config.test.ts`  
Expected: FAIL（未知 key 或未进 schema）

- [ ] **Step 3: 实现 schema**

在 `appConfigSchema` 的 object 内增加：

```ts
openviking: z
  .object({
    embeddingModel: z.string().min(1).optional(),
    vlmModel: z.string().min(1).optional(),
    embeddingDimension: z.number().int().positive().optional(),
  })
  .optional(),
```

`defaultAppConfig()` **不**设置 `openviking` 与 `mcpServers.openviking`。

- [ ] **Step 4: 在 `api.ts` 增加 status 类型并导出**

```ts
export type OpenVikingStatus =
  | "stopped"
  | "starting"
  | "ready"
  | "needs_config"
  | "error";

export type OpenVikingStatusView = {
  status: OpenVikingStatus;
  enabled: boolean;
  ownedProcess: boolean;
  mcpUrl: string;
  lastError?: string;
};
```

- [ ] **Step 5: 测试通过 + Commit**

```bash
git add packages/shared
git commit -m "$(cat <<'EOF'
feat(shared): openviking config overrides and status DTO

EOF
)"
```

---

### Task 3: `config-map` — Provider → `ov.conf` JSON

**Files:**
- Create: `packages/server/src/openviking/paths.ts`
- Create: `packages/server/src/openviking/config-map.ts`
- Create: `packages/server/src/openviking/config-map.test.ts`

**Interfaces:**
- Consumes: `AppConfig`、`resolveCredential(ref) => string | undefined`
- Produces:
  - `defaultOpenVikingPaths(): { rootDir, confPath, dataDir, runtimeProjectDir }`
  - `mapProviderToOvConf(input): { ok: true; conf: object } | { ok: false; reason: string }`
  - `writeOvConf(confPath, conf): void`

路径规则：

```ts
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultOpenVikingPaths(repoRoot = findRepoRoot()) {
  const rootDir = join(homedir(), ".agent2026", "openviking");
  return {
    rootDir,
    confPath: join(rootDir, "ov.conf"),
    dataDir: join(rootDir, "data"),
    runtimeProjectDir: join(repoRoot, "packages", "openviking-runtime"),
  };
}
```

`findRepoRoot`：从 `import.meta.url` / `process.cwd()` 向上找含 `packages/openviking-runtime/pyproject.toml` 的目录；测试可注入。

映射规则（与规格 §3.4 一致）：

```ts
function inferOvProvider(entry: ProviderEntry): "openai" | "volcengine" {
  const base = "baseUrl" in entry ? entry.baseUrl : "";
  if (/volces\.com|bytepluses\.com/i.test(base)) return "volcengine";
  return "openai";
}

// defaults:
// openai: model text-embedding-3-small, dimension 1536, input "text"
// volcengine: model doubao-embedding-vision-251215, dimension 1024, input "multimodal"
```

无 apiKey → `{ ok: false, reason: "缺少 Provider API Key（…）" }`。

- [ ] **Step 1: 写测试 — 有 key 时生成 conf；无 key 时 needs_config 原因**

```ts
it("maps openai_compatible provider into ov.conf", () => {
  const result = mapProviderToOvConf({
    config: {
      ...defaultAppConfig(),
      // providers with baseUrl + apiKeyEnv
    },
    apiKey: "sk-test",
    dataDir: "/tmp/ov-data",
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.conf.embedding.dense.api_key).toBe("sk-test");
    expect(result.conf.storage.workspace).toBe("/tmp/ov-data");
  }
});

it("returns reason when api key missing", () => {
  const result = mapProviderToOvConf({ config: defaultAppConfig(), apiKey: undefined, dataDir: "/tmp/x" });
  expect(result.ok).toBe(false);
});
```

- [ ] **Step 2: 实现 `paths.ts` + `config-map.ts` 使测试通过**

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/openviking
git commit -m "$(cat <<'EOF'
feat(server): map provider credentials into OpenViking ov.conf

EOF
)"
```

---

### Task 4: `OpenVikingSupervisor`（可注入）+ 单测

**Files:**
- Create: `packages/server/src/openviking/constants.ts`
- Create: `packages/server/src/openviking/supervisor.ts`
- Create: `packages/server/src/openviking/supervisor.test.ts`

**Interfaces:**

```ts
export type OpenVikingDeps = {
  paths: ReturnType<typeof defaultOpenVikingPaths>;
  resolveCredential: (ref: string) => string | undefined;
  ensureRuntime: () => Promise<void>; // uv sync；可抛错
  healthCheck: () => Promise<boolean>;
  spawnServer: (args: { confPath: string; port: number }) => Promise<ChildHandle>;
  writeConfigPreset: (mutate: (c: AppConfig) => AppConfig) => void;
  /** 等待 health 的超时 ms，默认 60_000 */
  readyTimeoutMs?: number;
};

export type ChildHandle = { pid: number; kill: () => Promise<void> };

export type OpenVikingSupervisor = {
  reconcile(config: AppConfig): Promise<void>;
  getStatus(): OpenVikingStatusView;
  shutdown(): Promise<void>;
};

export function createOpenVikingSupervisor(deps: OpenVikingDeps): OpenVikingSupervisor;
```

**reconcile 算法（必须按序）：**

1. 读 `enabled = config.mcpServers?.openviking?.enabled === true`（无条目视为 false）。  
2. 未启用 → kill owned child → status `stopped`，`enabled: false` → return。  
3. status → `starting`。  
4. `ensureRuntime()`；失败 → `error`（文案含 uv）。  
5. `mapProviderToOvConf`；失败 → `needs_config`。  
6. `writeOvConf`。  
7. 若 `healthCheck()` true → `ready`，`ownedProcess=false`（若当前无 owned child）或保持已有 owned。  
8. 否则 `spawnServer` → 轮询 health 至超时；成功 `ready`+`ownedProcess=true`；失败 kill + `error`。  
9. `writeConfigPreset`：确保

```ts
mcpServers.openviking = {
  transport: "http",
  url: OPENVIKING_MCP_URL,
  httpSubtype: "streamable",
  enabled: true,
}
```

且 `agents.default.tools.mcpServers` 含 `"openviking"`（去重）。

**默认 deps（生产）：**

- `ensureRuntime`: `execFile("uv", ["sync", "--project", runtimeProjectDir])`  
- `healthCheck`: `fetch(http://127.0.0.1:1933/health)` JSON `status===ok` 或 HTTP 200  
- `spawnServer`: `spawn("uv", ["run", "--project", runtimeProjectDir, "openviking-server", "--config", confPath], …)` — **upstream `openviking` 0.4.x 以 `--config` 为主**；若需改端口，优先写进 `ov.conf` 的 server 段或查 `openviking-server --help` 后只改此一处（勿假设单独 `--port` 一定存在）

- [ ] **Step 1: 测试矩阵（全部 mock deps）**

| 用例 | 期望 status |
|------|-------------|
| disabled | stopped，不调用 ensureRuntime |
| enabled + no key | needs_config |
| enabled + ensureRuntime throws | error |
| enabled + health already true | ready, ownedProcess false, 调用 writeConfigPreset |
| enabled + health false then spawn+health true | ready, ownedProcess true |
| enabled → disabled | kill child, stopped |

- [ ] **Step 2: 实现 supervisor 使测试绿**

Run: `pnpm --filter @agent2026/server test -- openviking/supervisor.test.ts`

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/openviking
git commit -m "$(cat <<'EOF'
feat(server): OpenVikingSupervisor with injectable runtime deps

EOF
)"
```

---

### Task 5: 挂入 `app.ts` + HTTP 路由

**Files:**
- Create: `packages/server/src/routes/openviking.ts`
- Create: `packages/server/src/routes/openviking.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/config/config-service.ts`（若 `set` 已够用则不必改）

**Interfaces:**
- `GET /openviking/status` → `OpenVikingStatusView`  
- `POST /openviking/retry` → 跑 OV reconcile 再 MCP reconcile → 返回最新 status  

**app.ts 编排（写死）：**

```ts
async function reconcileAll(config: AppConfig) {
  await openViking.reconcile(config);
  await mcp.reconcile(configService.get()); // preset 可能已改写
}

// initial + onChange: void reconcileAll(...).catch(warn)
// onClose: await openViking.shutdown(); await mcp.shutdown();
```

`writeConfigPreset` 实现：`configService.set(mutate(configService.get()))`（会触发 onChange——**注意避免重入**）：Supervisor 内用 `isReconciling` 锁，或 `set` 提供 `silent` 选项；推荐 **reconcile 内直接 `configService.set` 且 onChange 用 generation/token 跳过嵌套**，单测覆盖「preset 写入不导致死循环」。

`CreateAppOptions` 增加可选 `openViking?: OpenVikingSupervisor`、`skipOpenVikingReconcile?: boolean`。

- [ ] **Step 1: 路由测试用注入 mock supervisor**

- [ ] **Step 2: 接线 app + 测「listen 不依赖 OV ready」**（已有 pattern：skip 标志）

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/routes/openviking.ts packages/server/src/routes/openviking.test.ts
git commit -m "$(cat <<'EOF'
feat(server): wire OpenViking supervisor and status/retry routes

EOF
)"
```

---

### Task 6: Desktop「长期记忆」设置 UI

**Files:**
- Modify: `apps/desktop/src/lib/api.ts`
- Modify: `apps/desktop/src/stores/settings-store.ts`
- Create: `apps/desktop/src/components/settings/memory-settings-panel.tsx`
- Modify: `apps/desktop/src/components/settings/settings-page.tsx`
- Modify: `apps/desktop/src/components/settings/mcp-settings-panel.tsx`（可选：对 `name==="openviking"` 显示只读提示「由长期记忆管理启停」）

**Interfaces:**
- `fetchOpenVikingStatus(baseUrl)`  
- `retryOpenViking(baseUrl)`  
- store: `openVikingStatus`、`refreshOpenVikingStatus`、`setOpenVikingEnabled(enabled)`、`saveOpenVikingOverrides({ embeddingModel, vlmModel })`

**UI 行为（规格 §4.3）：**

1. 侧栏加 `{ id: "section-memory", label: "长期记忆", icon: Brain }`（`lucide-react` `Brain`），插在 MCP 与高级之间。  
2. `MemorySettingsPanel` 使用 `SettingsSection` / `SettingsField` 与现有视觉一致。  
3. 开关打开：`PUT /config` 写入/更新 `mcpServers.openviking`（HTTP 预设 + enabled true）并确保 mount 列表含 `openviking`；然后 `retryOpenViking` 或依赖 server onChange。  
4. 开关关闭：`enabled: false`（保留条目以便再开）。  
5. 轮询或在 `loadAll` / 保存后拉 `/openviking/status`（与 MCP status 相同节奏即可，例如 load 时并行 + 保存后刷新）。  
6. AGPL 旁注文案固定：「OpenViking 为 AGPLv3 可选组件；闭源分发前请自行评估合规。」

- [ ] **Step 1: api + store 方法**

- [ ] **Step 2: 面板组件 + 挂 settings-page**

- [ ] **Step 3: 手工点开设置页确认分区与开关（dev）**

- [ ] **Step 4: Commit**

```bash
git add apps/desktop
git commit -m "$(cat <<'EOF'
feat(desktop): long-term memory settings panel for OpenViking

EOF
)"
```

---

### Task 7: 学习短记 + 本机冒烟 + 回归

**Files:**
- Create: `docs/learning/P2.5-OPENVIKING.md`
- Modify: `docs/superpowers/specs/2026-09-26-openviking-mcp-design.md`（状态可标「实现中/已实现」——仅在全部验收后改）

- [ ] **Step 1: 写冒烟清单**

清单必须覆盖规格 §7：快乐路径、开关杀进程、needs_config、无 uv、外部已起 OV、`openviking__health` 或 `find`、Trace 可见。

- [ ] **Step 2: 跑全量测试**

Run: `pnpm test`  
Expected: 绿（无真实 OV）。

- [ ] **Step 3: 本机有 uv+密钥时手工冒烟（记录结果到 learning 文）**

- [ ] **Step 4: Commit**

```bash
git add docs/learning/P2.5-OPENVIKING.md
git commit -m "$(cat <<'EOF'
docs(learning): P2.5 OpenViking smoke checklist

EOF
)"
```

---

## Spec coverage checklist

| 规格项 | Task |
|--------|------|
| uv 锁定 runtime | 1 |
| Provider → ov.conf + 覆盖字段 | 2, 3 |
| Supervisor 拉起/复用/停自有进程 | 4 |
| 先 OV 后 MCP；异步不堵 listen | 5 |
| status / retry API | 5 |
| 长期记忆 UI + AGPL | 6 |
| 降级 / CI 无真实 OV | 4–5 测试, 7 |
| 冒烟文档 | 7 |
| MemoryPort / RSI | 不做 |

## 执行断点

- **Task 4 后：** Supervisor 单测绿即可评审进程状态机。  
- **Task 5 后：** API 可用，可 `curl` status。  
- **Task 6 后：** UI 可演示；再 Task 7 冒烟。

---

## 执行方式

Plan 已保存到 `docs/superpowers/plans/2026-09-26-openviking-mcp.md`。

**1. Subagent-Driven（推荐）** — 每任务新开子代理，任务间审查  
**2. Inline Execution** — 本会话按 executing-plans 连续做，设检查点  

选哪个？
