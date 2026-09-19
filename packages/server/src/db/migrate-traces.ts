import type Database from "better-sqlite3";

type TableInfoRow = { name: string };

export function migrateTracesSchema(db: Database.Database): void {
  const columns = db.pragma("table_info(traces)") as TableInfoRow[];
  const names = new Set(columns.map((column) => column.name));

  if (!names.has("status")) {
    db.exec("ALTER TABLE traces ADD COLUMN status TEXT");
  }
  if (!names.has("ended_at")) {
    db.exec("ALTER TABLE traces ADD COLUMN ended_at TEXT");
  }
}
