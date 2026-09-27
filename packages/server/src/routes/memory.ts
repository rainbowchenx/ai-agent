import type { FastifyInstance } from "fastify";
import type { DistillStatusView } from "@agent2026/shared";
import type { MemoryConsolidator } from "../memory/consolidator.js";

export type MemoryRouteDeps = {
  memory: MemoryConsolidator;
};

export function registerMemoryRoutes(
  app: FastifyInstance,
  deps: MemoryRouteDeps,
): void {
  app.get("/memory/distill/status", async (): Promise<DistillStatusView> => {
    return deps.memory.getLastResult();
  });
}
