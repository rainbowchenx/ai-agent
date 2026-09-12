# Settings Runtime（ConfigService + 热生效）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让设置中心与 Agent Runtime 解耦，通过 ConfigService + CredentialStore 实现「页面改配置 → 下一轮 run / 下一次请求实时生效」，并去掉设置页的演示 `flash()` 接线。

**Architecture:** Settings UI 只调 HTTP API；Server 用 `ConfigService`（校验/落盘/内存/onChange）与已有 `CredentialStore`；每次 `startRun` 重新 `assembleRuntime`；主题留在桌面 `ui-store`。`core` 不依赖设置 UI。

**Tech Stack:** TypeScript monorepo、Fastify、Zod/`AppConfig`、Vitest、React/Zustand Electron desktop

**Spec:** `docs/superpowers/specs/2026-09-12-settings-design.md`

## Global Constraints

- 密钥永不经 `GET /config` 或 `GET /credentials` 回显；只写不读。
- env 优先于 credentials；env 占用时 UI 只读。
- 进行中的 run 不中途换 model/tools。
- MCP / 高级分区保持占位，不假装已可用。
- 不提交 `Agent 工作台 等 5 个设计/` zip 或设计资源目录。
- 每任务单独 commit；Windows 下用 PowerShell 友好的 commit 方式。
- 在 `feat/settings-runtime` 分支上工作（勿直接堆在 main 未审查合并）。

---

## File map

| 文件 | 职责 |
|------|------|
| `packages/server/src/config/config-service.ts` | ConfigService：get/set/path/onChange |
| `packages/server/src/config/config-service.test.ts` | 单测 |
| `packages/server/src/app.ts` | 装配 ConfigService，注入 routes/runs |
| `packages/server/src/routes/config.ts` | 经 ConfigService.set |
| `packages/server/src/assemble/runtime.ts` | 已有 resolveCredential；确认每次 run 用最新 config |
| `packages/server/src/credentials/*` | 已有；补齐路由测试如缺 |
| `apps/desktop/src/stores/settings-store.ts` | 独立于 session-store 的设置状态 |
| `apps/desktop/src/components/settings/settings-page.tsx` | 接真 API；去掉 flash 演示 |
| `apps/desktop/src/components/chat/workbench.tsx` | 顶栏模型切换写 config |
| `apps/desktop/src/lib/api.ts` | 已有 fetch/put config & credentials |

**已存在可复用：** credentials store/routes、`maxTurns` schema、UI 壳与 tokens、`resolveCredential` 接线。

---

### Task 1: ConfigService

**Files:**
- Create: `packages/server/src/config/config-service.ts`
- Create: `packages/server/src/config/config-service.test.ts`
- Modify: `packages/server/src/config/load-config.ts`（导出给 service 复用 write/load）

**Interfaces:**
- Produces: `createConfigService(path: string): ConfigService` with
  - `path: string`
  - `get(): AppConfig`
  - `set(next: AppConfig): AppConfig` — Zod via `parseAppConfig`；失败 throw；成功写盘+更新内存+通知 listeners
  - `onChange(listener: (config: AppConfig) => void): () => void`

- [ ] **Step 1: Write failing tests** for set persists, reject invalid keeps old, onChange fires once on success

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @agent2026/server exec vitest run src/config/config-service.test.ts`

- [ ] **Step 3: Implement `createConfigService`**

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `feat(server): add ConfigService for hot-reloadable app config`

---

### Task 2: Wire ConfigService into Fastify app + runs

**Files:**
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/config.ts`（若需）
- Modify: `packages/server/src/routes/runs.ts`（确保每次 assemble 用 `getConfig()`）
- Test: extend `packages/server/src/app.test.ts` — PUT config then GET reflects；optional credential describe

**Interfaces:**
- Consumes: `createConfigService`, `createCredentialStore`
- `registerConfigRoutes` uses `configService.get/set`
- `registerRunRoutes` gets `getConfig: () => configService.get()`, `resolveCredential`

- [ ] **Step 1: Refactor `createApp` to own ConfigService** (replace bare `let config`)

- [ ] **Step 2: Add/adjust app tests for PUT /config persistence + /credentials describe**

- [ ] **Step 3: Run** `pnpm --filter @agent2026/server test` — expect PASS

- [ ] **Step 4: Commit** `feat(server): wire ConfigService and credentials into app assembly`

---

### Task 3: Desktop settings-store + wire Settings UI to APIs

**Files:**
- Create: `apps/desktop/src/stores/settings-store.ts`
- Modify: `apps/desktop/src/components/settings/settings-page.tsx`
- Modify: `apps/desktop/src/lib/api.ts`（若缺方法）
- Optionally thin: `apps/desktop/src/stores/session-store.ts` — `loadConfig`/`config` 可仍给工作台用，或由 settings-store 同步一份

**Interfaces:**
- Produces settings-store:
  - `hydrate(baseUrl)`
  - `saveProvider({...})` → putConfig + optional putCredential
  - `saveAgent({...})` → putConfig
  - `savePermissions({...})` → putConfig
  - `credentials: Record<string, CredentialInfo>`
  - `system: SystemPathsResponse | null`
- Settings page: Provider/Agent/权限「保存」调 store；外观只 `ui-store.setTheme`；MCP/高级仍占位；关于用 `/system`+health
- Remove `flash("演示")` 作为成功路径

- [ ] **Step 1: Implement settings-store with load/save helpers**

- [ ] **Step 2: Wire settings-page forms to store**（保留现有 HTML 风格 class）

- [ ] **Step 3: Manual sanity** — `pnpm --filter @agent2026/desktop exec tsc -p tsconfig.json --noEmit` + `pnpm --filter @agent2026/desktop test`

- [ ] **Step 4: Commit** `feat(desktop): wire settings page to config and credentials APIs`

---

### Task 4: Workbench model switcher (hot default model)

**Files:**
- Modify: `apps/desktop/src/components/chat/workbench.tsx`
- Possibly: `apps/desktop/src/stores/session-store.ts` add `setDefaultModel(modelRef: string)`

**Interfaces:**
- Topbar model control updates `agents.default.model` (+ ensure provider entry exists) via `putConfig`
- After save, refresh `session-store.config` so `data-current-model` updates
- In-flight run unchanged (no abort)

- [ ] **Step 1: Implement working model switcher UI** (select or menu from `providers.entries.*.models` + current)

- [ ] **Step 2: Typecheck + desktop tests PASS**

- [ ] **Step 3: Commit** `feat(desktop): hot-switch default model from workbench topbar`

---

### Task 5: Docs polish + verification

**Files:**
- Modify: `docs/superpowers/specs/2026-09-12-settings-design.md` status if needed
- Optional: `docs/learning/` short note — only if already pattern in repo; else skip (YAGNI)

- [ ] **Step 1: Run full** `pnpm --filter @agent2026/server test` and `pnpm --filter @agent2026/desktop test`

- [ ] **Step 2: Confirm checklist vs spec §9 success criteria** (config+credentials, no secret echo, next-run assemble, theme local)

- [ ] **Step 3: Commit** any doc-only fixes `docs: note settings runtime ConfigService landing`

---

## Execution notes

- Prefer **subagent-driven-development**: one implementer per task, then quick review.
- Do not commit design HTML folder / zip.
- If credentials routes already exist unfinished, Task 2 must make them green under tests rather than rewrite blindly.
