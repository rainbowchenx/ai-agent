import { createRequire } from "node:module";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { ModelPort } from "@agent2026/core";
import { defaultSqlitePath, openSqlite } from "./db/sqlite.js";
import { createConfigService } from "./config/config-service.js";
import {
  defaultConfigPath,
  defaultCredentialsPath,
} from "./config/load-config.js";
import { createCredentialStore } from "./credentials/store.js";
import { PermissionBroker } from "./permissions/permission-broker.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerCredentialRoutes } from "./routes/credentials.js";
import { registerHealthRoutes } from "./routes/health.js";
import { PermissionBroker } from "./permissions/permission-broker.js";
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

  const app = Fastify({ logger: false });
  app.addHook("onClose", async () => {
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
  });
  registerTraceRoutes(app, { sessionStore, tracePort });

  return app;
}
