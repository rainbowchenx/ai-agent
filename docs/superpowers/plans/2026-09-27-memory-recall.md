# Memory Auto-Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Session-scoped selective auto-recall: top-k OV find/search → cache by sessionId → append to systemPrompt; refresh on cue phrases or POST refresh.

**Architecture:** `MemoryRecaller` in server memory/; wired in `runs.ts` before Runner; `openviking.autoRecall` default true; Desktop toggle.

**Tech Stack:** Zod, Vitest, Fastify, React settings store

## Global Constraints

- No persist of recall block into SessionStore
- No MemoryPort / Hooks bus / core dependency on OV
- Gate: OV enabled + ready + autoRecall !== false
- CI: mock ToolPort only

---

## Task 1: shared autoRecall

**Files:** `packages/shared/src/config.ts`, `config.test.ts`

- [x] RED/GREEN: default true; accept false
- [x] `pnpm --filter @agent2026/shared test`

## Task 2: format + recaller

**Files:** `packages/server/src/memory/constants.ts`, `format-recall.ts`, `recaller.ts` (+ tests)

- [x] RED/GREEN: format budget; gate skip; cache hit; cue refresh; forceRefresh; error → empty
- [x] Run memory unit tests

## Task 3: runs wiring + refresh route

**Files:** `runs.ts`, `memory.ts` or `sessions.ts`, `app.ts` (+ tests)

- [x] Inject system before run; skip excludes block from persist
- [x] `POST /sessions/:id/memory/refresh`
- [x] Wire createMemoryRecaller in app

## Task 4: Desktop toggle

**Files:** memory-settings-panel, settings-store

- [x] autoRecall switch + serialize

## Task 5: docs

- [x] `docs/learning/P4-MEMORY-RECALL.md`
- [x] Mark recall spec implemented; link from distill §12
