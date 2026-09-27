import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { DistillStatusView } from "@agent2026/shared";
import type { MemoryConsolidator } from "../memory/consolidator.js";
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
