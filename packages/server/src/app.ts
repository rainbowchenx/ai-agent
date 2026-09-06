import { createRequire } from "node:module";
import Fastify, { type FastifyInstance } from "fastify";
import { defaultSqlitePath, openSqlite } from "./db/sqlite.js";
import {
  defaultConfigPath,
  loadOrCreateAppConfig,
  writeAppConfig,
} from "./config/load-config.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSessionsRoutes } from "./routes/sessions.js";
import { SqliteSessionStore } from "./store/sqlite-session-store.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export type CreateAppOptions = {
  configPath?: string;
  dbPath?: string;
};

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const configPath = options.configPath ?? defaultConfigPath();
  const dbPath = options.dbPath ?? defaultSqlitePath();

  let config = loadOrCreateAppConfig(configPath);
  const db = openSqlite(dbPath);
  const sessionStore = new SqliteSessionStore(db);

  const app = Fastify({ logger: false });
  app.addHook("onClose", async () => {
    db.close();
  });

  registerHealthRoutes(app, { version });
  registerConfigRoutes(app, {
    getConfig: () => config,
    setConfig: (next) => {
      writeAppConfig(configPath, next);
      config = next;
    },
  });
  registerSessionsRoutes(app, { sessionStore });

  return app;
}
