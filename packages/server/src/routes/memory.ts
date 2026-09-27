import type { FastifyInstance } from "fastify";
import type { DistillStatusView } from "@agent2026/shared";
import type { MemoryConsolidator } from "../memory/consolidator.js";
import type { MemoryRecaller } from "../memory/recaller.js";
import type { SqliteSessionStore } from "../store/sqlite-session-store.js";

export type MemoryRouteDeps = {
  memory: MemoryConsolidator;
  memoryRecaller?: MemoryRecaller;
  sessionStore?: SqliteSessionStore;
};

export function registerMemoryRoutes(
  app: FastifyInstance,
  deps: MemoryRouteDeps,
): void {
  app.get("/memory/distill/status", async (): Promise<DistillStatusView> => {
    return deps.memory.getLastResult();
  });

  app.post<{
    Params: { sessionId: string };
    Body: { query?: string } | undefined;
  }>("/sessions/:sessionId/memory/refresh", async (request, reply) => {
    if (!deps.memoryRecaller || !deps.sessionStore) {
      await reply.code(503).send({ ok: false, reason: "recall_unavailable" });
      return;
    }

    const session = await deps.sessionStore.get(request.params.sessionId);
    if (!session) {
      await reply.code(404).send({ ok: false, reason: "not_found" });
      return;
    }

    let query = request.body?.query?.trim() ?? "";
    if (!query) {
      const messages = await deps.sessionStore.getMessages(session.id);
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (m?.role === "user" && m.content.trim()) {
          query = m.content.trim();
          break;
        }
      }
    }
    if (!query) {
      await reply.code(400).send({ ok: false, reason: "missing_query" });
      return;
    }

    const entry = await deps.memoryRecaller.refresh({
      sessionId: session.id,
      query,
    });
    const cached = deps.memoryRecaller.getCache(session.id);
    if (!cached) {
      await reply.code(409).send({
        ok: false,
        reason: "gate_closed",
        hitCount: 0,
        source: entry.source,
      });
      return;
    }

    return {
      ok: true as const,
      hitCount: cached.hitCount,
      source: cached.source,
      cached: true as const,
    };
  });
}
