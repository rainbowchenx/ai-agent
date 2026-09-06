import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "@agent2026/shared";

export function registerHealthRoutes(
  app: FastifyInstance,
  opts: { version: string },
): void {
  app.get("/health", async (): Promise<HealthResponse> => {
    return { ok: true, version: opts.version };
  });
}
