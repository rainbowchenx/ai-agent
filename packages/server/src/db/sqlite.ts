import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";

export function defaultSqlitePath(): string {
  return join(homedir(), ".agent2026", "data.sqlite");
}

export function openSqlite(
  dbPath: string = defaultSqlitePath(),
): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}
