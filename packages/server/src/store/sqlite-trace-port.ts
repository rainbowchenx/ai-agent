import type { SpanKind, TracePort } from "@agent2026/core";
import type Database from "better-sqlite3";

export class SqliteTracePort implements TracePort {
  constructor(private readonly db: Database.Database) {}

  async startTrace(input: {
    runId: string;
    sessionId: string;
  }): Promise<{ traceId: string }> {
    const traceId = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO traces (id, run_id, session_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(traceId, input.runId, input.sessionId, now);
    return { traceId };
  }

  async startSpan(input: {
    traceId: string;
    name: string;
    kind: SpanKind;
    parentSpanId?: string;
  }): Promise<{ spanId: string }> {
    const spanId = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO spans (
           id, trace_id, parent_span_id, name, kind,
           status, metadata, started_at, ended_at
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
      )
      .run(
        spanId,
        input.traceId,
        input.parentSpanId ?? null,
        input.name,
        input.kind,
        now,
      );
    return { spanId };
  }

  async endSpan(input: {
    spanId: string;
    status?: "ok" | "error";
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const now = new Date().toISOString();
    const updated = this.db
      .prepare(
        `UPDATE spans SET status = ?, metadata = ?, ended_at = ? WHERE id = ?`,
      )
      .run(
        input.status ?? "ok",
        input.metadata === undefined ? null : JSON.stringify(input.metadata),
        now,
        input.spanId,
      );
    if (updated.changes === 0) {
      throw new Error(`Span not found: ${input.spanId}`);
    }
  }
}
