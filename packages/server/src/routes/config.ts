import type { FastifyInstance } from "fastify";
import { parseAppConfig, type AppConfig } from "@agent2026/shared";

export type ConfigRouteDeps = {
  getConfig: () => AppConfig;
  setConfig: (config: AppConfig) => void;
};

export function registerConfigRoutes(
  app: FastifyInstance,
  deps: ConfigRouteDeps,
): void {
  app.get("/config", async () => deps.getConfig());

  app.put("/config", async (request, reply) => {
    try {
      const parsed = parseAppConfig(request.body);
      deps.setConfig(parsed);
      return parsed;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "invalid config";
      return reply.code(400).send({ error: "invalid_config", message });
    }
  });
}
