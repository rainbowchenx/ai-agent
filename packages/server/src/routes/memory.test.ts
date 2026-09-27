import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { DistillStatusView } from "@agent2026/shared";
import type { MemoryConsolidator } from "../memory/consolidator.js";
import type { MemoryRecaller, RecallCacheEntry } from "../memory/recaller.js";
import { registerMemoryRoutes } from "./memory.js";

describe("Memory distill status route", () => {
  it("GET /memory/distill/status returns consolidator getLastResult", async () => {
    const status: DistillStatusView = {
      enabled: true,
      lastStatus: "ok",
      lastAt: "2026-09-27T00:00:00.000Z",
      lastRunId: "run-1",
      lastWritten: 2,
      lastMessage: "wrote 2",
    };
    const memory: MemoryConsolidator = {
      enqueue: vi.fn(),
      getLastResult: () => status,
      shutdown: async () => undefined,
    };

    const app = Fastify();
    registerMemoryRoutes(app, { memory });
    const res = await app.inject({
      method: "GET",
      url: "/memory/distill/status",
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(status);
  });
});

describe("POST /sessions/:id/memory/refresh", () => {
  it("returns 409 when gate closed (no cache written)", async () => {
    const memory: MemoryConsolidator = {
      enqueue: vi.fn(),
      getLastResult: () => ({ enabled: false, lastStatus: "idle" }),
      shutdown: async () => undefined,
    };
    const entry: RecallCacheEntry = {
      block: "",
      query: "q",
      fetchedAt: new Date().toISOString(),
      hitCount: 0,
      source: "error",
    };
    const memoryRecaller: MemoryRecaller = {
      resolveForRun: async () => "",
      getCache: () => undefined,
      clearSession: () => undefined,
      refresh: async () => entry,
    };
    const sessionStore = {
      get: async (id: string) =>
        id === "s1"
          ? {
              id: "s1",
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : null,
      getMessages: async () => [{ role: "user" as const, content: "hi" }],
    };

    const app = Fastify();
    registerMemoryRoutes(app, {
      memory,
      memoryRecaller,
      sessionStore: sessionStore as never,
    });
    const res = await app.inject({
      method: "POST",
      url: "/sessions/s1/memory/refresh",
      payload: { query: "pnpm" },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, reason: "gate_closed" });
  });

  it("returns ok when refresh caches entry", async () => {
    const cached: RecallCacheEntry = {
      block: "## 相关长期记忆",
      query: "pnpm",
      fetchedAt: new Date().toISOString(),
      hitCount: 1,
      source: "find",
    };
    const memory: MemoryConsolidator = {
      enqueue: vi.fn(),
      getLastResult: () => ({ enabled: true, lastStatus: "idle" }),
      shutdown: async () => undefined,
    };
    const memoryRecaller: MemoryRecaller = {
      resolveForRun: async () => cached.block,
      getCache: () => cached,
      clearSession: () => undefined,
      refresh: async () => cached,
    };
    const sessionStore = {
      get: async () => ({
        id: "s1",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      getMessages: async () => [],
    };

    const app = Fastify();
    registerMemoryRoutes(app, {
      memory,
      memoryRecaller,
      sessionStore: sessionStore as never,
    });
    const res = await app.inject({
      method: "POST",
      url: "/sessions/s1/memory/refresh",
      payload: { query: "pnpm" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      hitCount: 1,
      source: "find",
      cached: true,
    });
  });
});
