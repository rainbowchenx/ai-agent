import { createRequire } from "node:module";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { ModelPort } from "@agent2026/core";
import { defaultSqlitePath, openSqlite } from "./db/sqlite.js";
import {
  defaultConfigPath,
  loadOrCreateAppConfig,
  writeAppConfig,
} from "./config/load-config.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerSessionsRoutes } from "./routes/sessions.js";
import { SqliteSessionStore } from "./store/sqlite-session-store.js";
import { SqliteTracePort } from "./store/sqlite-trace-port.js";
import { RunHub } from "./ws/run-hub.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export type CreateAppOptions = {
  configPath?: string;
  dbPath?: string;
  /** Injected for tests so CI does not need a real API key. */
  model?: ModelPort;
  workspaceRoot?: string;
};

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const configPath = options.configPath ?? defaultConfigPath();
  const dbPath = options.dbPath ?? defaultSqlitePath();
  const workspaceRoot = options.workspaceRoot ?? process.cwd();

  let config = loadOrCreateAppConfig(configPath);
  const db = openSqlite(dbPath);
  const sessionStore = new SqliteSessionStore(db);
  const tracePort = new SqliteTracePort(db);
  const hub = new RunHub();

  const app = Fastify({ logger: false });
  app.addHook("onClose", async () => {
    db.close();
  });

  // Electron renderer (vite) is http://localhost:5173 while the API is
  // http://127.0.0.1:8787 — browsers treat that as cross-origin.
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await app.register(websocket);

  registerHealthRoutes(app, { version });
  registerConfigRoutes(app, {
    getConfig: () => config,
    setConfig: (next) => {
      writeAppConfig(configPath, next);
      config = next;
    },
  });
  registerSessionsRoutes(app, { sessionStore });
  registerRunRoutes(app, {
    getConfig: () => config,
    sessionStore,
    tracePort,
    hub,
    model: options.model,
    workspaceRoot,
  });

  return app;
}
