import type { FastifyInstance } from "fastify";
import type {
  ListMcpStatusResponse,
  RefreshMcpResponse,
} from "@agent2026/shared";
import type { McpSupervisor } from "../mcp/supervisor.js";

export type McpRouteDeps = {
  mcp: McpSupervisor;
};

export function registerMcpRoutes(
  app: FastifyInstance,
  deps: McpRouteDeps,
): void {
  app.get("/mcp/status", async (): Promise<ListMcpStatusResponse> => {
    return deps.mcp.getStatus();
  });

  app.post<{ Params: { serverName: string } }>(
    "/mcp/:serverName/refresh",
    async (request, reply): Promise<RefreshMcpResponse | undefined> => {
      const { serverName } = request.params;
      try {
        await deps.mcp.refreshTools(serverName);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "refresh failed";
        return reply.code(400).send({ error: "refresh_failed", message });
      }
      const status = deps.mcp
        .getStatus()
        .find((entry) => entry.name === serverName);
      if (!status) {
        return reply.code(404).send({ error: "not_found" });
      }
      return { ok: true, status };
    },
  );
}
