import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import type { AppConfig, OpenVikingStatusView } from "@agent2026/shared";
import { mapToOvConf, writeOvConf } from "./config-map.js";
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

/**
 * Ensure HTTP MCP preset exists. Never force-enable over a newer config:
 * preserve `enabled` when the entry already exists; only use
 * `startedWithEnabled` when creating a missing entry.
 */
function applyOpenVikingPreset(
  startedWithEnabled: boolean,
): (config: AppConfig) => AppConfig {
  return (config: AppConfig) => {
    const existing = config.mcpServers?.[OPENVIKING_SERVER_NAME];
    const enabled = existing
      ? existing.enabled === true
      : startedWithEnabled;

    const mcpServers = { ...(config.mcpServers ?? {}) };
    mcpServers[OPENVIKING_SERVER_NAME] = {
      transport: "http",
      url: OPENVIKING_MCP_URL,
      httpSubtype: "streamable",
      enabled,
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
  /** Bumped on every reconcile/shutdown enqueue; stale ops must not commit ready. */
  let generation = 0;
  /** Promise-chain mutex so reconcile/shutdown never interleave mutation. */
  let opChain: Promise<void> = Promise.resolve();

  function isCurrent(gen: number): boolean {
    return !shutDown && gen === generation;
  }

  function runExclusive(fn: (gen: number) => Promise<void>): Promise<void> {
    const gen = ++generation;
    const run = opChain.then(() => fn(gen));
    opChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function killOwned(): Promise<void> {
    if (!ownedChild) return;
    const child = ownedChild;
    ownedChild = null;
    status = { ...status, ownedProcess: false };
    await child.kill().catch(() => undefined);
  }

  /** If this generation no longer owns the op, kill any child we hold and bail. */
  async function abandonIfStale(gen: number): Promise<boolean> {
    if (isCurrent(gen)) return false;
    await killOwned();
    return true;
  }

  async function waitUntilHealthy(
    timeoutMs: number,
    gen: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (!isCurrent(gen)) {
        return false;
      }
      if (await deps.healthCheck()) {
        return isCurrent(gen);
      }
      if (!isCurrent(gen) || Date.now() >= deadline) {
        return false;
      }
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }
  }

  async function reconcileBody(config: AppConfig, gen: number): Promise<void> {
    if (!isCurrent(gen)) {
      return;
    }

    const startedWithEnabled =
      config.mcpServers?.[OPENVIKING_SERVER_NAME]?.enabled === true;

    if (!startedWithEnabled) {
      await killOwned();
      if (!isCurrent(gen)) return;
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
      if (await abandonIfStale(gen)) return;
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
    if (await abandonIfStale(gen)) return;

    const defaultName = config.providers.default;
    const entry = config.providers.entries[defaultName];
    const chatApiKey = entry
      ? deps.resolveCredential(entry.apiKeyEnv)
      : undefined;
    const embeddingApiKeyEnv = config.openviking?.embedding?.apiKeyEnv;
    const embeddingApiKey = embeddingApiKeyEnv
      ? deps.resolveCredential(embeddingApiKeyEnv)
      : undefined;

    const mapped = mapToOvConf({
      config,
      embeddingApiKey,
      chatApiKey,
      dataDir: deps.paths.dataDir,
    });

    if (!mapped.ok) {
      if (!isCurrent(gen)) return;
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
    if (await abandonIfStale(gen)) return;
    if (healthy) {
      status = {
        status: "ready",
        enabled: true,
        ownedProcess: ownedChild !== null,
        mcpUrl: OPENVIKING_MCP_URL,
      };
      deps.writeConfigPreset(applyOpenVikingPreset(startedWithEnabled));
      return;
    }

    try {
      await killOwned();
      if (await abandonIfStale(gen)) return;
      ownedChild = await deps.spawnServer({
        confPath: deps.paths.confPath,
        port: OPENVIKING_PORT,
      });
    } catch (error) {
      if (await abandonIfStale(gen)) return;
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
    if (await abandonIfStale(gen)) return;

    const readyTimeout = deps.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    const becameHealthy = await waitUntilHealthy(readyTimeout, gen);
    if (await abandonIfStale(gen)) return;
    if (!becameHealthy) {
      await killOwned();
      if (!isCurrent(gen)) return;
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
    deps.writeConfigPreset(applyOpenVikingPreset(startedWithEnabled));
  }

  return {
    reconcile(config) {
      return runExclusive((gen) => reconcileBody(config, gen));
    },

    getStatus() {
      return { ...status };
    },

    shutdown() {
      shutDown = true;
      return runExclusive(async () => {
        await killOwned();
        status = {
          status: "stopped",
          enabled: false,
          ownedProcess: false,
          mcpUrl: OPENVIKING_MCP_URL,
        };
      });
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
      if (!contentType.includes("application/json")) {
        return false;
      }
      const body = (await res.json()) as { status?: string };
      return body.status === "ok" || body.status === "healthy";
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
        if (child.killed) return;
        if (process.platform === "win32") {
          try {
            await execFileAsync(
              "taskkill",
              ["/pid", String(pid), "/T", "/F"],
              { windowsHide: true },
            );
          } catch {
            child.kill();
          }
          return;
        }
        child.kill();
      },
    };
  };
}
