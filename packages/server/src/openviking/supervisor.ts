import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import type { AppConfig, OpenVikingStatusView } from "@agent2026/shared";
import { mapProviderToOvConf, writeOvConf } from "./config-map.js";
import {
  OPENVIKING_HOST,
  OPENVIKING_MCP_URL,
  OPENVIKING_PORT,
  OPENVIKING_SERVER_NAME,
} from "./constants.js";
import { defaultOpenVikingPaths } from "./paths.js";

const execFileAsync = promisify(execFile);

export type ChildHandle = { pid: number; kill: () => Promise<void> };

export type OpenVikingDeps = {
  paths: ReturnType<typeof defaultOpenVikingPaths>;
  resolveCredential: (ref: string) => string | undefined;
  ensureRuntime: () => Promise<void>;
  healthCheck: () => Promise<boolean>;
  spawnServer: (args: { confPath: string; port: number }) => Promise<ChildHandle>;
  writeConfigPreset: (mutate: (c: AppConfig) => AppConfig) => void;
  /** Wait for health after spawn; default 60_000 */
  readyTimeoutMs?: number;
};

export type OpenVikingSupervisor = {
  reconcile(config: AppConfig): Promise<void>;
  getStatus(): OpenVikingStatusView;
  shutdown(): Promise<void>;
};

const DEFAULT_READY_TIMEOUT_MS = 60_000;
const HEALTH_POLL_INTERVAL_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureUvErrorMessage(message: string): string {
  return /uv/i.test(message)
    ? message
    : `OpenViking runtime setup failed (uv): ${message}`;
}

function applyOpenVikingPreset(config: AppConfig): AppConfig {
  const mcpServers = { ...(config.mcpServers ?? {}) };
  mcpServers[OPENVIKING_SERVER_NAME] = {
    transport: "http",
    url: OPENVIKING_MCP_URL,
    httpSubtype: "streamable",
    enabled: true,
  };

  const mounted = config.agents.default.tools.mcpServers;
  const mcpMount = mounted.includes(OPENVIKING_SERVER_NAME)
    ? mounted
    : [...mounted, OPENVIKING_SERVER_NAME];

  return {
    ...config,
    mcpServers,
    agents: {
      ...config.agents,
      default: {
        ...config.agents.default,
        tools: {
          ...config.agents.default.tools,
          mcpServers: mcpMount,
        },
      },
    },
  };
}

export function createOpenVikingSupervisor(
  deps: OpenVikingDeps,
): OpenVikingSupervisor {
  let status: OpenVikingStatusView = {
    status: "stopped",
    enabled: false,
    ownedProcess: false,
    mcpUrl: OPENVIKING_MCP_URL,
  };
  let ownedChild: ChildHandle | null = null;
  let shutDown = false;

  async function killOwned(): Promise<void> {
    if (!ownedChild) return;
    const child = ownedChild;
    ownedChild = null;
    status = { ...status, ownedProcess: false };
    await child.kill().catch(() => undefined);
  }

  async function waitUntilHealthy(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await deps.healthCheck()) {
        return true;
      }
      if (Date.now() >= deadline) {
        return false;
      }
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }
  }

  return {
    async reconcile(config) {
      if (shutDown) {
        return;
      }

      const enabled = config.mcpServers?.openviking?.enabled === true;

      if (!enabled) {
        await killOwned();
        status = {
          status: "stopped",
          enabled: false,
          ownedProcess: false,
          mcpUrl: OPENVIKING_MCP_URL,
        };
        return;
      }

      status = {
        status: "starting",
        enabled: true,
        ownedProcess: ownedChild !== null,
        mcpUrl: OPENVIKING_MCP_URL,
      };

      try {
        await deps.ensureRuntime();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        status = {
          status: "error",
          enabled: true,
          ownedProcess: ownedChild !== null,
          mcpUrl: OPENVIKING_MCP_URL,
          lastError: ensureUvErrorMessage(message),
        };
        return;
      }

      const defaultName = config.providers.default;
      const entry = config.providers.entries[defaultName];
      const apiKey = entry
        ? deps.resolveCredential(entry.apiKeyEnv)
        : undefined;

      const mapped = mapProviderToOvConf({
        config,
        apiKey,
        dataDir: deps.paths.dataDir,
      });

      if (!mapped.ok) {
        status = {
          status: "needs_config",
          enabled: true,
          ownedProcess: ownedChild !== null,
          mcpUrl: OPENVIKING_MCP_URL,
          lastError: mapped.reason,
        };
        return;
      }

      writeOvConf(deps.paths.confPath, mapped.conf);

      const healthy = await deps.healthCheck();
      if (healthy) {
        status = {
          status: "ready",
          enabled: true,
          ownedProcess: ownedChild !== null,
          mcpUrl: OPENVIKING_MCP_URL,
        };
        deps.writeConfigPreset(applyOpenVikingPreset);
        return;
      }

      try {
        await killOwned();
        ownedChild = await deps.spawnServer({
          confPath: deps.paths.confPath,
          port: OPENVIKING_PORT,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        status = {
          status: "error",
          enabled: true,
          ownedProcess: false,
          mcpUrl: OPENVIKING_MCP_URL,
          lastError: message,
        };
        return;
      }

      const readyTimeout = deps.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
      const becameHealthy = await waitUntilHealthy(readyTimeout);
      if (!becameHealthy) {
        await killOwned();
        status = {
          status: "error",
          enabled: true,
          ownedProcess: false,
          mcpUrl: OPENVIKING_MCP_URL,
          lastError: `OpenViking health check timed out after ${readyTimeout}ms`,
        };
        return;
      }

      status = {
        status: "ready",
        enabled: true,
        ownedProcess: true,
        mcpUrl: OPENVIKING_MCP_URL,
      };
      deps.writeConfigPreset(applyOpenVikingPreset);
    },

    getStatus() {
      return { ...status };
    },

    async shutdown() {
      shutDown = true;
      await killOwned();
      status = {
        status: "stopped",
        enabled: false,
        ownedProcess: false,
        mcpUrl: OPENVIKING_MCP_URL,
      };
    },
  };
}

/** Thin production helpers for Task 5 wiring (tests must inject mocks). */
export function createDefaultOpenVikingHealthCheck(
  url = `http://${OPENVIKING_HOST}:${OPENVIKING_PORT}/health`,
): () => Promise<boolean> {
  return async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const body = (await res.json()) as { status?: string };
        return body.status === "ok" || body.status === "healthy";
      }
      return true;
    } catch {
      return false;
    }
  };
}

export function createDefaultEnsureRuntime(
  runtimeProjectDir: string,
): () => Promise<void> {
  return async () => {
    try {
      await execFileAsync("uv", ["sync", "--project", runtimeProjectDir], {
        windowsHide: true,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new Error(ensureUvErrorMessage(message));
    }
  };
}

export function createDefaultSpawnServer(
  runtimeProjectDir: string,
): (args: { confPath: string; port: number }) => Promise<ChildHandle> {
  return async ({ confPath, port }) => {
    const child = spawn(
      "uv",
      [
        "run",
        "--project",
        runtimeProjectDir,
        "openviking-server",
        "--config",
        confPath,
        "--port",
        String(port),
      ],
      {
        stdio: "ignore",
        windowsHide: true,
        detached: false,
      },
    );

    if (child.pid === undefined) {
      throw new Error("Failed to spawn openviking-server (no pid)");
    }

    const pid = child.pid;
    return {
      pid,
      async kill() {
        if (!child.killed) {
          child.kill();
        }
      },
    };
  };
}
