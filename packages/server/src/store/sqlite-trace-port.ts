import type { SpanKind, TracePort } from "@agent2026/core";
import type Database from "better-sqlite3";

export type TraceRunStatus = "running" | "completed" | "stopped" | "error";

export type TraceRunSummary = {
  runId: string;
  traceId: string;
  status: TraceRunStatus;
  createdAt: string;
  endedAt?: string;
};

export type TraceSpanRow = {
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: "generation" | "tool" | "permission";
  status?: "ok" | "error";
  startedAt: string;
  endedAt?: string;
  summary?: string;
};

type TraceRow = {
  id: string;
  run_id: string;
  session_id: string;
  status: string | null;
  created_at: string;
  ended_at: string | null;
};

type SpanRow = {
  id: string;
  parent_span_id: string | null;
  name: string;
  kind: string;
  status: string | null;
  metadata: string | null;
  started_at: string;
  ended_at: string | null;
};

function parseSpanSummary(metadata: string | null): string | undefined {
  if (!metadata) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(metadata) as { summary?: unknown };
    return typeof parsed.summary === "string" ? parsed.summary : undefined;
  } catch {
    return undefined;
  }
}

function toTraceRunSummary(row: TraceRow): TraceRunSummary {
  return {
    runId: row.run_id,
    traceId: row.id,
    status: (row.status ?? "completed") as TraceRunStatus,
    createdAt: row.created_at,
    endedAt: row.ended_at ?? undefined,
  };
}

function toTraceSpanRow(row: SpanRow): TraceSpanRow {
  return {
    spanId: row.id,
    parentSpanId: row.parent_span_id ?? undefined,
    name: row.name,
    kind: row.kind as TraceSpanRow["kind"],
    status: row.status === "ok" || row.status === "error" ? row.status : undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    summary: parseSpanSummary(row.metadata),
  };
}

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
        `INSERT INTO traces (
           id, run_id, session_id, created_at, status, ended_at
         ) VALUES (?, ?, ?, ?, 'running', NULL)`,
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

  async updateTraceEnd(input: {
    runId: string;
    status: TraceRunStatus;
    endedAt: string;
  }): Promise<void> {
    const updated = this.db
      .prepare(
        `UPDATE traces SET status = ?, ended_at = ? WHERE run_id = ?`,
      )
      .run(input.status, input.endedAt, input.runId);
    if (updated.changes === 0) {
      throw new Error(`Trace not found for run: ${input.runId}`);
    }
  }

  async listRunsBySession(
    sessionId: string,
    limit: number,
  ): Promise<TraceRunSummary[]> {
    const rows = this.db
      .prepare(
        `SELECT id, run_id, session_id, status, created_at, ended_at
         FROM traces
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(sessionId, limit) as TraceRow[];
    return rows.map(toTraceRunSummary);
  }

  async getByRunId(
    runId: string,
  ): Promise<{ trace: TraceRunSummary; spans: TraceSpanRow[] } | null> {
    const traceRow = this.db
      .prepare(
        `SELECT id, run_id, session_id, status, created_at, ended_at
         FROM traces
         WHERE run_id = ?`,
      )
      .get(runId) as TraceRow | undefined;
    if (!traceRow) {
      return null;
    }

    const spanRows = this.db
      .prepare(
        `SELECT id, parent_span_id, name, kind, status, metadata, started_at, ended_at
         FROM spans
         WHERE trace_id = ?
         ORDER BY started_at ASC`,
      )
      .all(traceRow.id) as SpanRow[];

    return {
      trace: toTraceRunSummary(traceRow),
      spans: spanRows.map(toTraceSpanRow),
    };
  }
}
