# OpenViking Independent Embedding Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenViking embedding a required independent endpoint (`baseUrl` + `model` + `apiKeyEnv`) so chat providers like DeepSeek no longer poison `ov.conf` dense embedding.

**Architecture:** Extend `AppConfig.openviking.embedding`; rewrite `mapProviderToOvConf` to refuse chat-provider fallback for dense; Supervisor resolves embedding credential separately; Desktop main-panel form saves config + credentials.

**Tech Stack:** Zod, Vitest, Fastify server, Electron/React settings store

## Global Constraints

- Secrets only via `apiKeyEnv` + credentials/env — never in config JSON
- Enabling OV without complete embedding → `needs_config` (no silent chat-provider fallback)
- VLM still maps from default chat Provider
- Deprecated flat `embeddingModel` / `embeddingDimension` accepted on read; omitted on new writes
- No real OV in CI; unit tests with mocks

---

## Task 1: Shared schema

**Files:** `packages/shared/src/config.ts`, `packages/shared/src/config.test.ts`

- [x] RED: tests for full `embedding` object; reject missing subfields when object present; still accept deprecated flat keys; autoDistill default unchanged
- [x] GREEN: add Zod `embedding` nested schema
- [x] Run `pnpm --filter @agent2026/shared test`

## Task 2: config-map

**Files:** `packages/server/src/openviking/config-map.ts`, `config-map.test.ts`

- [x] RED: independent embedding → ov.conf dense; missing trio / missing embedding key → fail; no chat baseUrl for dense without embedding block; VLM still from chat; volcengine infer from embedding.baseUrl
- [x] GREEN: implement `mapToOvConf` (keep export alias `mapProviderToOvConf` if needed)
- [x] Run server openviking config-map tests

## Task 3: Supervisor

**Files:** `packages/server/src/openviking/supervisor.ts`, `supervisor.test.ts`

- [x] RED: enabled + no embedding → needs_config; enabled + complete → writes conf / ready path
- [x] GREEN: resolve embedding + chat keys; pass into mapper
- [x] Run supervisor tests

## Task 4: Desktop UI + store

**Files:** `apps/desktop/src/stores/settings-store.ts`, `apps/desktop/src/components/settings/memory-settings-panel.tsx`

- [x] `serializeOpenViking` writes nested `embedding`, drops flat keys
- [x] `saveOpenVikingEmbedding` + credentials
- [x] Main-panel form; remove advanced embedding override
- [x] Typecheck / existing desktop tests if any

## Task 5: Docs

**Files:** learning short note, P2.5 touch-ups, runtime README, mark spec implemented

- [x] `docs/learning/P2.5b-OPENVIKING-EMBEDDING.md`
- [x] Update P2.5 learning + P2.5 spec cross-links
- [x] Spec status → 已实现
