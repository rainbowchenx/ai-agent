import type { FastifyInstance } from "fastify";
import type {
  GetRunTraceResponse,
  ListSessionRunsResponse,
} from "@agent2026/shared";
import type { SqliteSessionStore } from "../store/sqlite-session-store.js";
import type { SqliteTracePort } from "../store/sqlite-trace-port.js";

export type TraceRouteDeps = {
  sessionStore: SqliteSessionStore;
  tracePort: SqliteTracePort;
};

export function registerTraceRoutes(
  app: FastifyInstance,
  deps: TraceRouteDeps,
): void {
  app.get<{
    Params: { sessionId: string };
    Querystring: { limit?: string };
  }>("/sessions/:sessionId/runs", async (request, reply): Promise<
    ListSessionRunsResponse | undefined
  > => {
    const session = await deps.sessionStore.get(request.params.sessionId);
    if (!session) {
      await reply.code(404).send({ error: "not_found" });
      return;
    }
    const rawLimit = request.query.limit;
    const parsed =
      rawLimit === undefined ? 20 : Number.parseInt(rawLimit, 10);
    const limit =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
    const runs = await deps.tracePort.listRunsBySession(
      request.params.sessionId,
      limit,
    );
    return { runs };
  });

  app.get<{ Params: { runId: string } }>(
    "/runs/:runId/trace",
    async (request, reply): Promise<GetRunTraceResponse | undefined> => {
      const full = await deps.tracePort.getByRunId(request.params.runId);
      if (!full) {
        await reply.code(404).send({ error: "not_found" });
        return;
      }
      return {
        runId: full.trace.runId,
        traceId: full.trace.traceId,
        status: full.trace.status,
        createdAt: full.trace.createdAt,
        endedAt: full.trace.endedAt,
        spans: full.spans,
      };
    },
  );
}
