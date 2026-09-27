import { createRequire } from "node:module";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { ModelPort } from "@agent2026/core";
import type { AppConfig } from "@agent2026/shared";
import { assembleRuntime } from "./assemble/runtime.js";
import { defaultSqlitePath, openSqlite } from "./db/sqlite.js";
import { createConfigService } from "./config/config-service.js";
import {
  defaultConfigPath,
  defaultCredentialsPath,
} from "./config/load-config.js";
import { createCredentialStore } from "./credentials/store.js";
import { createMcpSupervisor, type McpSupervisor } from "./mcp/supervisor.js";
import {
  createMemoryConsolidator,
  type MemoryConsolidator,
} from "./memory/consolidator.js";
import {
  createDefaultEnsureRuntime,
  createDefaultOpenVikingHealthCheck,
  createDefaultSpawnServer,
  createOpenVikingSupervisor,
  type OpenVikingDeps,
  type OpenVikingSupervisor,
} from "./openviking/supervisor.js";
import { OPENVIKING_SERVER_NAME } from "./openviking/constants.js";
import { defaultOpenVikingPaths } from "./openviking/paths.js";
import { PermissionBroker } from "./permissions/permission-broker.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerCredentialRoutes } from "./routes/credentials.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerOpenVikingRoutes } from "./routes/openviking.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerSessionsRoutes } from "./routes/sessions.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerTraceRoutes } from "./routes/traces.js";
import { SqliteSessionStore } from "./store/sqlite-session-store.js";
import { SqliteTracePort } from "./store/sqlite-trace-port.js";
import { RunHub } from "./ws/run-hub.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export type CreateAppOptions = {
  configPath?: string;
  credentialsPath?: string;
  dbPath?: string;
  /** Injected for tests so CI does not need a real API key. */
  model?: ModelPort;
  workspaceRoot?: string;
  /** Injected MCP supervisor (tests); default creates a real one. */
  mcp?: McpSupervisor;
  /** Skip initial MCP reconcile (tests that do not need MCP). */
  skipMcpReconcile?: boolean;
  /** Injected OpenViking supervisor (tests); default creates a real one. */
  openViking?: OpenVikingSupervisor;
  /**
   * Partial OV deps overrides (tests). Ignored when `openViking` is injected.
   * Enables hanging ensureRuntime/health without replacing the whole supervisor.
   */
  openVikingDeps?: Partial<
    Omit<OpenVikingDeps, "writeConfigPreset" | "paths">
  > & { paths?: OpenVikingDeps["paths"] };
  /** Skip initial OpenViking reconcile (tests that do not need OV). */
  skipOpenVikingReconcile?: boolean;
  /** Injected memory consolidator (tests); default creates a real one. */
  memory?: MemoryConsolidator;
};

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const configPath = options.configPath ?? defaultConfigPath();
  const credentialsPath =
    options.credentialsPath ?? defaultCredentialsPath();
  const dbPath = options.dbPath ?? defaultSqlitePath();
  const workspaceRoot = options.workspaceRoot ?? process.cwd();

  const configService = createConfigService(configPath);
  const credentials = createCredentialStore(credentialsPath);
  const db = openSqlite(dbPath);
  const sessionStore = new SqliteSessionStore(db);
  const tracePort = new SqliteTracePort(db);
  const hub = new RunHub();
  const permissionBroker = new PermissionBroker();
  const mcp = options.mcp ?? createMcpSupervisor();

  const paths = options.openVikingDeps?.paths ?? defaultOpenVikingPaths();
  /** Skip onChange → reconcile while writeConfigPreset persists MCP URL. */
  let applyingPreset = false;
  const openViking =
    options.openViking ??
    createOpenVikingSupervisor({
      paths,
      resolveCredential:
        options.openVikingDeps?.resolveCredential ??
        ((ref) => credentials.resolve(ref)),
      ensureRuntime:
        options.openVikingDeps?.ensureRuntime ??
        createDefaultEnsureRuntime(paths.runtimeProjectDir),
      healthCheck:
        options.openVikingDeps?.healthCheck ??
        createDefaultOpenVikingHealthCheck(),
      spawnServer:
        options.openVikingDeps?.spawnServer ??
        createDefaultSpawnServer(paths.runtimeProjectDir),
      readyTimeoutMs: options.openVikingDeps?.readyTimeoutMs,
      writeConfigPreset: (mutate) => {
        applyingPreset = true;
        try {
          configService.set(mutate(configService.get()));
        } finally {
          applyingPreset = false;
        }
      },
    });

  /**
   * Trailing coalesce: never drop a newer config while reconcile runs.
   * After the current pass finishes, re-run with the latest queued config.
   */
  let reconciling = false;
  let pendingConfig: AppConfig | null = null;

  async function reconcileAll(config: AppConfig): Promise<void> {
    pendingConfig = config;
    if (reconciling) {
      // Let OV see the latest immediately so an in-flight enable can abandon.
      void openViking.reconcile(config).catch(() => undefined);
      return;
    }
    reconciling = true;
    try {
      while (pendingConfig) {
        const next = pendingConfig;
        pendingConfig = null;
        await openViking.reconcile(next);
        await mcp.reconcile(configService.get());
      }
    } finally {
      reconciling = false;
      if (pendingConfig) {
        void reconcileAll(pendingConfig).catch((error) => {
          console.warn(
            "[openviking/mcp] trailing reconcile failed:",
            error instanceof Error ? error.message : error,
          );
        });
      }
    }
  }

  // Do not block listen on OV sync / MCP connect.
  // Status starts empty/connecting; settings + first run see tools once reconcile finishes.
  if (!options.skipOpenVikingReconcile || !options.skipMcpReconcile) {
    void (async () => {
      try {
        if (!options.skipOpenVikingReconcile && !options.skipMcpReconcile) {
          await reconcileAll(configService.get());
        } else if (!options.skipOpenVikingReconcile) {
          await openViking.reconcile(configService.get());
        } else {
          await mcp.reconcile(configService.get());
        }
      } catch (error) {
        console.warn(
          "[openviking/mcp] initial reconcile failed:",
          error instanceof Error ? error.message : error,
        );
      }
    })();
  }

  const unsubscribeConfig = configService.onChange((config) => {
    if (applyingPreset) return;
    void reconcileAll(config).catch((error) => {
      console.warn(
        "[openviking/mcp] reconcile after config change failed:",
        error instanceof Error ? error.message : error,
      );
    });
  });

  const memory =
    options.memory ??
    createMemoryConsolidator({
      getConfig: () => configService.get(),
      getOpenVikingStatus: () => openViking.getStatus(),
      getOpenVikingPort: () => mcp.getPort(OPENVIKING_SERVER_NAME),
      getModel: () =>
        assembleRuntime({
          config: configService.get(),
          workspaceRoot,
          model: options.model,
          resolveCredential: (ref) => credentials.resolve(ref),
          mcp,
        }).model,
    });

  const app = Fastify({ logger: false });
  app.addHook("onClose", async () => {
    unsubscribeConfig();
    await memory.shutdown().catch(() => undefined);
    await openViking.shutdown().catch(() => undefined);
    await mcp.shutdown().catch(() => undefined);
    db.close();
  });

  // Electron renderer (vite) is http://localhost:5173 while the API is
  // http://127.0.0.1:9800 — browsers treat that as cross-origin.
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await app.register(websocket);

  registerHealthRoutes(app, { version });
  registerSystemRoutes(app, {
    version,
    configPath: configService.path,
    credentialsPath,
  });
  registerConfigRoutes(app, {
    getConfig: () => configService.get(),
    setConfig: (next) => {
      configService.set(next);
    },
  });
  registerMcpRoutes(app, { mcp });
  registerOpenVikingRoutes(app, {
    openViking,
    retry: async () => {
      await reconcileAll(configService.get());
      return openViking.getStatus();
    },
  });
  registerMemoryRoutes(app, { memory });
  registerCredentialRoutes(app, {
    store: credentials,
    getConfig: () => configService.get(),
  });
  registerSessionsRoutes(app, { sessionStore });
  registerRunRoutes(app, {
    getConfig: () => configService.get(),
    sessionStore,
    tracePort,
    hub,
    permissionBroker,
    model: options.model,
    workspaceRoot,
    resolveCredential: (ref) => credentials.resolve(ref),
    mcp,
    memory,
  });
  registerTraceRoutes(app, { sessionStore, tracePort });

  // Expose for status routes and tests.
  app.decorate("mcpSupervisor", mcp);
  app.decorate("openVikingSupervisor", openViking);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    mcpSupervisor: McpSupervisor;
    openVikingSupervisor: OpenVikingSupervisor;
  }
}
