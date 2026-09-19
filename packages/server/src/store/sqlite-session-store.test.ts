import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "@agent2026/core";
import { defaultSqlitePath, openSqlite } from "../db/sqlite.js";
import { SqliteSessionStore } from "./sqlite-session-store.js";
import { SqliteTracePort } from "./sqlite-trace-port.js";

describe("defaultSqlitePath", () => {
  it("points at ~/.agent2026/data.sqlite", () => {
    expect(defaultSqlitePath()).toBe(
      join(homedir(), ".agent2026", "data.sqlite"),
    );
  });
});

describe("SqliteSessionStore", () => {
  let dir = "";
  let dbPath = "";

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  async function freshDb() {
    dir = await mkdtemp(join(tmpdir(), "agent2026-session-"));
    dbPath = join(dir, "data.sqlite");
    return openSqlite(dbPath);
  }

  it("creates sessions, messages, traces, and spans tables", async () => {
    const db = await freshDb();
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    db.close();

    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(["sessions", "messages", "traces", "spans"]),
    );
  });

  it("creates a session, appends messages, and reloads them after reopen", async () => {
    const db = await freshDb();
    const store = new SqliteSessionStore(db);
    const { id } = await store.create({ title: "chat" });

    const user: AgentMessage = { role: "user", content: "hello" };
    const assistant: AgentMessage = {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "c1", name: "read_file", arguments: { path: "a.txt" } },
      ],
    };
    const tool: AgentMessage = {
      role: "tool",
      toolCallId: "c1",
      content: "ok",
    };

    await store.appendMessage(id, user);
    await store.appendMessage(id, assistant);
    await store.appendMessage(id, tool);
    db.close();

    const reopened = openSqlite(dbPath);
    const reloaded = new SqliteSessionStore(reopened);
    const session = await reloaded.get(id);
    const messages = await reloaded.getMessages(id);
    const listed = await reloaded.list();
    reopened.close();

    expect(session?.id).toBe(id);
    expect(session?.title).toBe("chat");
    expect(session?.createdAt).toBeInstanceOf(Date);
    expect(session?.updatedAt).toBeInstanceOf(Date);
    expect(messages).toEqual([user, assistant, tool]);
    expect(listed.map((item) => item.id)).toContain(id);
  });

  it("appends assistant+tool in one transaction via appendMessagesBatch", async () => {
    const db = await freshDb();
    const store = new SqliteSessionStore(db);
    const { id } = await store.create({ title: "batch" });

    const assistant: AgentMessage = {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "c1", name: "read_file", arguments: { path: "a.txt" } },
      ],
    };
    const tool: AgentMessage = {
      role: "tool",
      toolCallId: "c1",
      content: "ok",
    };

    try {
      await store.appendMessagesBatch(id, [assistant, tool]);
      const messages = await store.getMessages(id);
      expect(messages).toEqual([assistant, tool]);
    } finally {
      db.close();
    }
  });

  it("rolls back appendMessagesBatch when the session is missing", async () => {
    const db = await freshDb();
    const store = new SqliteSessionStore(db);
    const assistant: AgentMessage = {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.txt" } }],
    };

    try {
      await expect(
        store.appendMessagesBatch("does-not-exist", [assistant]),
      ).rejects.toThrow(/Session not found/);

      const leftover = db
        .prepare(`SELECT COUNT(*) as n FROM messages`)
        .get() as { n: number };
      expect(leftover.n).toBe(0);
    } finally {
      db.close();
    }
  });

  it("returns null for a missing session", async () => {
    const db = await freshDb();
    const store = new SqliteSessionStore(db);
    const missing = await store.get("does-not-exist");
    db.close();
    expect(missing).toBeNull();
  });
});

describe("SqliteTracePort", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("persists startTrace, startSpan, and endSpan across reopen", async () => {
    dir = await mkdtemp(join(tmpdir(), "agent2026-trace-"));
    const dbPath = join(dir, "data.sqlite");
    const db = openSqlite(dbPath);
    const sessions = new SqliteSessionStore(db);
    const traces = new SqliteTracePort(db);
    const { id: sessionId } = await sessions.create();

    const { traceId } = await traces.startTrace({
      runId: "run-1",
      sessionId,
    });
    const { spanId } = await traces.startSpan({
      traceId,
      name: "model.generate",
      kind: "generation",
    });
    const { spanId: childId } = await traces.startSpan({
      traceId,
      name: "read_file",
      kind: "tool",
      parentSpanId: spanId,
    });
    await traces.endSpan({
      spanId: childId,
      status: "ok",
      metadata: { path: "a.txt" },
    });
    await traces.endSpan({
      spanId,
      status: "error",
      metadata: { reason: "limit" },
    });
    db.close();

    const reopened = openSqlite(dbPath);
    const traceRow = reopened
      .prepare(`SELECT id, run_id, session_id FROM traces WHERE id = ?`)
      .get(traceId) as
      | { id: string; run_id: string; session_id: string }
      | undefined;
    const spans = reopened
      .prepare(
        `SELECT id, name, kind, parent_span_id, status, metadata, ended_at
         FROM spans WHERE trace_id = ?`,
      )
      .all(traceId) as Array<{
      id: string;
      name: string;
      kind: string;
      parent_span_id: string | null;
      status: string | null;
      metadata: string | null;
      ended_at: string | null;
    }>;
    reopened.close();

    const byId = new Map(spans.map((span) => [span.id, span]));
    const parent = byId.get(spanId);
    const child = byId.get(childId);

    expect(traceRow).toEqual({
      id: traceId,
      run_id: "run-1",
      session_id: sessionId,
    });
    expect(spans).toHaveLength(2);
    expect(parent).toMatchObject({
      name: "model.generate",
      kind: "generation",
      parent_span_id: null,
      status: "error",
    });
    expect(parent?.ended_at).toBeTruthy();
    expect(JSON.parse(parent?.metadata ?? "{}")).toEqual({ reason: "limit" });
    expect(child).toMatchObject({
      name: "read_file",
      kind: "tool",
      parent_span_id: spanId,
      status: "ok",
    });
    expect(JSON.parse(child?.metadata ?? "{}")).toEqual({ path: "a.txt" });
  });

  it("startTrace sets status running; updateTraceEnd + listRunsBySession + getByRunId roundtrip", async () => {
    dir = await mkdtemp(join(tmpdir(), "agent2026-trace-query-"));
    const dbPath = join(dir, "data.sqlite");
    const db = openSqlite(dbPath);
    const port = new SqliteTracePort(db);
    const { traceId } = await port.startTrace({ runId: "r1", sessionId: "s1" });
    const { spanId } = await port.startSpan({
      traceId,
      name: "generation",
      kind: "generation",
    });
    await port.endSpan({ spanId, status: "ok" });
    await port.updateTraceEnd({
      runId: "r1",
      status: "completed",
      endedAt: new Date().toISOString(),
    });
    const runs = await port.listRunsBySession("s1", 20);
    expect(runs[0]).toMatchObject({ runId: "r1", traceId, status: "completed" });
    const full = await port.getByRunId("r1");
    expect(full?.spans).toHaveLength(1);
    expect(full?.spans[0]?.kind).toBe("generation");
    db.close();
  });
});
