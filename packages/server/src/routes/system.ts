import type { FastifyInstance } from "fastify";
import type { SystemPathsResponse } from "@agent2026/shared";

export type SystemRouteDeps = {
  version: string;
  configPath: string;
  credentialsPath: string;
};

export function registerSystemRoutes(
  app: FastifyInstance,
  deps: SystemRouteDeps,
): void {
  app.get("/system", async (): Promise<SystemPathsResponse> => ({
    version: deps.version,
    configPath: deps.configPath,
    credentialsPath: deps.credentialsPath,
  }));
}
