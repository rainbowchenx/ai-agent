import type { FastifyInstance } from "fastify";
import type { OpenVikingStatusView } from "@agent2026/shared";
import type { OpenVikingSupervisor } from "../openviking/supervisor.js";

export type OpenVikingRouteDeps = {
  openViking: OpenVikingSupervisor;
  /** Run OV then MCP reconcile; return latest status. */
  retry: () => Promise<OpenVikingStatusView>;
};

export function registerOpenVikingRoutes(
  app: FastifyInstance,
  deps: OpenVikingRouteDeps,
): void {
  app.get("/openviking/status", async (): Promise<OpenVikingStatusView> => {
    return deps.openViking.getStatus();
  });

  app.post("/openviking/retry", async (): Promise<OpenVikingStatusView> => {
    return deps.retry();
  });
}
