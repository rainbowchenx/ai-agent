import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelPort } from "@agent2026/core";
import type {
  CreateSessionResponse,
  GetRunTraceResponse,
  GetSessionResponse,
  ListSessionRunsResponse,
  RunEvent,
  StopRunResponse,
  WsClientMessage,
} from "@agent2026/shared";
import { createApp } from "../app.js";

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      },
      { once: true },
    );
  });
}

async function collectUntilEnd(
  ws: { on: (event: string, listener: (data: Buffer) => void) => void },
  timeoutMs = 3000,
): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for run_end: ${JSON.stringify(events)}`)),
      timeoutMs,
    );
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString()) as RunEvent;
      events.push(event);
      if (event.type === "run_end") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return events;
}

describe("WebSocket run + stop", () => {
  let dir = "";
  let app: Awaited<ReturnType<typeof createApp>> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  async function appWithModel(model: ModelPort) {
    dir = await mkdtemp(join(tmpdir(), "agent2026-runs-"));
    app = await createApp({
      configPath: join(dir, "config.yaml"),
      dbPath: join(dir, "data.sqlite"),
      workspaceRoot: dir,
      model,
    });
    await app.ready();
    return app;
  }

  it("streams mock model deltas over /ws and persists user + assistant", async () => {
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        yield { type: "text_delta", text: "hel" };
        yield { type: "text_delta", text: "lo" };
      },
    };
    const app = await appWithModel(model);

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "ws run" },
    });
    const { id: sessionId } = created.json<CreateSessionResponse>();

    const ws = await app.injectWS("/ws");
    const pending = collectUntilEnd(ws);
    const request: WsClientMessage = {
      type: "run",
      sessionId,
      content: "say hello",
    };
    ws.send(JSON.stringify(request));
    const events = await pending;
    ws.terminate();

    expect(events[0]).toMatchObject({
      type: "run_start",
      sessionId,
    });
    expect(events[0]?.type === "run_start" && events[0].runId).toEqual(
      expect.any(String),
    );
    expect(events[0]?.type === "run_start" && events[0].traceId).toEqual(
      expect.any(String),
    );
    expect(events.filter((e) => e.type === "message_delta")).toEqual([
      { type: "message_delta", runId: events[0] && "runId" in events[0] ? events[0].runId : "", delta: "hel" },
      { type: "message_delta", runId: events[0] && "runId" in events[0] ? events[0].runId : "", delta: "lo" },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "run_end", reason: "completed" });

    const session = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    const body = session.json<GetSessionResponse>();
    expect(body.messages.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: "user", content: "say hello" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("POST /runs/:runId/stop aborts the in-flight mock stream", async () => {
    const model: ModelPort = {
      id: "mock-slow",
      async *stream({ signal }) {
        yield { type: "text_delta", text: "tick" };
        await abortableDelay(10_000, signal);
        yield { type: "text_delta", text: "should-not-appear" };
      },
    };
    const app = await appWithModel(model);

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "stop me" },
    });
    const { id: sessionId } = created.json<CreateSessionResponse>();

    const ws = await app.injectWS("/ws");
    const events: RunEvent[] = [];
    const started = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no run_start")), 3000);
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as RunEvent;
        events.push(event);
        if (event.type === "run_start") {
          clearTimeout(timer);
          resolve(event.runId);
        }
      });
    });
    const ended = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no run_end: ${JSON.stringify(events)}`)),
        3000,
      );
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as RunEvent;
        if (event.type === "run_end") {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "run",
        sessionId,
        content: "please hang",
      } satisfies WsClientMessage),
    );

    const runId = await started;
    const stopped = await app.inject({
      method: "POST",
      url: `/runs/${runId}/stop`,
    });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json<StopRunResponse>()).toEqual({ ok: true });

    await ended;
    ws.terminate();

    expect(events.some((e) => e.type === "message_delta" && e.delta === "tick")).toBe(
      true,
    );
    expect(
      events.some((e) => e.type === "message_delta" && e.delta === "should-not-appear"),
    ).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "run_end",
      runId,
      reason: "stopped",
    });
  });

  it("after run_end, GET session shows paired assistant(toolCalls)+tool", async () => {
    let turn = 0;
    const model: ModelPort = {
      id: "mock-tools",
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool_call",
            id: "call_read_1",
            name: "read_file",
            arguments: { path: "note.txt" },
          };
          return;
        }
        yield { type: "text_delta", text: "done reading" };
      },
    };
    const app = await appWithModel(model);
    await writeFile(join(dir, "note.txt"), "file-body", "utf8");

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "tool run" },
    });
    const { id: sessionId } = created.json<CreateSessionResponse>();

    const ws = await app.injectWS("/ws");
    const pending = collectUntilEnd(ws);
    ws.send(
      JSON.stringify({
        type: "run",
        sessionId,
        content: "read note.txt",
      } satisfies WsClientMessage),
    );
    const events = await pending;
    ws.terminate();

    expect(events.some((e) => e.type === "tool_start")).toBe(true);
    expect(events.some((e) => e.type === "tool_end")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_end", reason: "completed" });

    const session = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    const body = session.json<GetSessionResponse>();
    const roles = body.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);

    const toolCalls = JSON.parse(body.messages[1]?.content ?? "[]") as Array<{
      id: string;
      name: string;
    }>;
    expect(toolCalls).toEqual([
      { id: "call_read_1", name: "read_file", arguments: { path: "note.txt" } },
    ]);
    expect(body.messages[2]?.content).toBe("file-body");
    expect(body.messages[3]?.content).toBe("done reading");

    const runs = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/runs`,
    });
    expect(runs.statusCode).toBe(200);
    const runsBody = runs.json<ListSessionRunsResponse>();
    expect(runsBody.runs.length).toBeGreaterThanOrEqual(1);
    const runId = runsBody.runs[0]?.runId;
    expect(runId).toEqual(expect.any(String));

    const trace = await app.inject({
      method: "GET",
      url: `/runs/${runId}/trace`,
    });
    expect(trace.statusCode).toBe(200);
    const traceBody = trace.json<GetRunTraceResponse>();
    expect(traceBody.spans.some((s) => s.kind === "tool")).toBe(true);
  });

  it("GET /runs/nope/trace returns 404 for unknown runId", async () => {
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        yield { type: "text_delta", text: "x" };
      },
    };
    const app = await appWithModel(model);
    const trace = await app.inject({
      method: "GET",
      url: "/runs/nope/trace",
    });
    expect(trace.statusCode).toBe(404);
  });

  it("GET /sessions/:sessionId/runs returns 404 for missing session", async () => {
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        yield { type: "text_delta", text: "x" };
      },
    };
    const app = await appWithModel(model);
    const runs = await app.inject({
      method: "GET",
      url: "/sessions/missing-session/runs",
    });
    expect(runs.statusCode).toBe(404);
  });

  it("after stop-during-tools, GET session has no unpaired toolCalls", async () => {
    const model: ModelPort = {
      id: "mock-stop-tools",
      async *stream({ signal }) {
        yield {
          type: "tool_call",
          id: "call_read_stop",
          name: "read_file",
          arguments: { path: "note.txt" },
        };
        await abortableDelay(10_000, signal);
      },
    };
    const app = await appWithModel(model);
    await writeFile(join(dir, "note.txt"), "file-body", "utf8");

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "stop tools" },
    });
    const { id: sessionId } = created.json<CreateSessionResponse>();

    const ws = await app.injectWS("/ws");
    const events: RunEvent[] = [];
    const started = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no run_start")), 3000);
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as RunEvent;
        events.push(event);
        if (event.type === "run_start") {
          clearTimeout(timer);
          resolve(event.runId);
        }
      });
    });
    const ended = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no run_end: ${JSON.stringify(events)}`)),
        3000,
      );
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as RunEvent;
        if (event.type === "run_end") {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "run",
        sessionId,
        content: "read then stop",
      } satisfies WsClientMessage),
    );

    const runId = await started;
    const stopped = await app.inject({
      method: "POST",
      url: `/runs/${runId}/stop`,
    });
    expect(stopped.statusCode).toBe(200);
    await ended;
    ws.terminate();

    expect(events.at(-1)).toMatchObject({
      type: "run_end",
      runId,
      reason: "stopped",
    });

    const session = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    const body = session.json<GetSessionResponse>();
    expect(unpairedToolCallAssistants(body.messages)).toEqual([]);
    expect(body.messages.some((m) => m.role === "tool")).toBe(true);
  });
});

function unpairedToolCallAssistants(
  messages: GetSessionResponse["messages"],
): number[] {
  const unpaired: number[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.role !== "assistant") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      continue;
    }
    if (
      !parsed.every((call) => call && typeof call === "object" && "id" in call)
    ) {
      continue;
    }
    const hasFollowingTool = messages.slice(i + 1).some((m) => m.role === "tool");
    if (!hasFollowingTool) {
      unpaired.push(i);
    }
  }
  return unpaired;
}
