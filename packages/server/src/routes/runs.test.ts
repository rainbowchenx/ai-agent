import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelPort } from "@agent2026/core";
import type {
  AppConfig,
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

  it("ask_all allow once: permission_response runs tool then completes", async () => {
    let turn = 0;
    const model: ModelPort = {
      id: "mock-ask-once",
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool_call",
            id: "call_read_once",
            name: "read_file",
            arguments: { path: "note.txt" },
          };
          return;
        }
        yield { type: "text_delta", text: "allowed once" };
      },
    };
    const app = await appWithModel(model);
    await writeFile(join(dir, "note.txt"), "file-body", "utf8");
    await setAskAll(app);

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "ask once" },
    });
    const { id: sessionId } = created.json<CreateSessionResponse>();

    const ws = await app.injectWS("/ws");
    const events: RunEvent[] = [];
    const pending = collectUntilEnd(ws);
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString()) as RunEvent;
      events.push(event);
      if (event.type === "permission_request") {
        ws.send(
          JSON.stringify({
            type: "permission_response",
            requestId: event.requestId,
            allow: true,
          } satisfies WsClientMessage),
        );
      }
    });
    ws.send(
      JSON.stringify({
        type: "run",
        sessionId,
        content: "read note",
      } satisfies WsClientMessage),
    );
    const ended = await pending;
    ws.terminate();

    expect(ended.some((e) => e.type === "permission_request")).toBe(true);
    expect(ended.some((e) => e.type === "tool_start")).toBe(true);
    expect(ended.some((e) => e.type === "tool_end" && !e.isError)).toBe(true);
    expect(ended.at(-1)).toMatchObject({ type: "run_end", reason: "completed" });
  });

  it("ask_all session scope: second run skips permission_request", async () => {
    let turn = 0;
    const model: ModelPort = {
      id: "mock-ask-session",
      async *stream() {
        turn += 1;
        if (turn % 2 === 1) {
          yield {
            type: "tool_call",
            id: `call_read_${turn}`,
            name: "read_file",
            arguments: { path: "note.txt" },
          };
          return;
        }
        yield { type: "text_delta", text: `done-${turn}` };
      },
    };
    const app = await appWithModel(model);
    await writeFile(join(dir, "note.txt"), "file-body", "utf8");
    await setAskAll(app);

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "ask session" },
    });
    const { id: sessionId } = created.json<CreateSessionResponse>();

    const ws = await app.injectWS("/ws");

    const firstEvents: RunEvent[] = [];
    const firstDone = collectUntilEnd(ws);
    const onFirst = (data: Buffer) => {
      const event = JSON.parse(data.toString()) as RunEvent;
      firstEvents.push(event);
      if (event.type === "permission_request") {
        ws.send(
          JSON.stringify({
            type: "permission_response",
            requestId: event.requestId,
            allow: true,
            scope: "session",
          } satisfies WsClientMessage),
        );
      }
    };
    ws.on("message", onFirst);
    ws.send(
      JSON.stringify({
        type: "run",
        sessionId,
        content: "read first",
      } satisfies WsClientMessage),
    );
    const first = await firstDone;
    expect(first.some((e) => e.type === "permission_request")).toBe(true);
    expect(first.some((e) => e.type === "tool_start")).toBe(true);
    expect(first.at(-1)).toMatchObject({ type: "run_end", reason: "completed" });

    const secondEvents: RunEvent[] = [];
    const secondDone = new Promise<RunEvent[]>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(`timed out second run: ${JSON.stringify(secondEvents)}`),
          ),
        3000,
      );
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as RunEvent;
        secondEvents.push(event);
        if (event.type === "run_end") {
          clearTimeout(timer);
          resolve(secondEvents);
        }
      });
    });
    ws.send(
      JSON.stringify({
        type: "run",
        sessionId,
        content: "read second",
      } satisfies WsClientMessage),
    );
    const second = await secondDone;
    ws.terminate();

    expect(second.some((e) => e.type === "permission_request")).toBe(false);
    expect(second.some((e) => e.type === "tool_start")).toBe(true);
    expect(second.some((e) => e.type === "tool_end" && !e.isError)).toBe(true);
    expect(second.at(-1)).toMatchObject({ type: "run_end", reason: "completed" });
  });

  it("ask_all deny: Permission denied tool result, run still completes", async () => {
    let turn = 0;
    const model: ModelPort = {
      id: "mock-ask-deny",
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool_call",
            id: "call_read_deny",
            name: "read_file",
            arguments: { path: "note.txt" },
          };
          return;
        }
        yield { type: "text_delta", text: "denied then continued" };
      },
    };
    const app = await appWithModel(model);
    await writeFile(join(dir, "note.txt"), "file-body", "utf8");
    await setAskAll(app);

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "ask deny" },
    });
    const { id: sessionId } = created.json<CreateSessionResponse>();

    const ws = await app.injectWS("/ws");
    const pending = collectUntilEnd(ws);
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString()) as RunEvent;
      if (event.type === "permission_request") {
        ws.send(
          JSON.stringify({
            type: "permission_response",
            requestId: event.requestId,
            allow: false,
          } satisfies WsClientMessage),
        );
      }
    });
    ws.send(
      JSON.stringify({
        type: "run",
        sessionId,
        content: "try read",
      } satisfies WsClientMessage),
    );
    const events = await pending;
    ws.terminate();

    expect(events.some((e) => e.type === "permission_request")).toBe(true);
    expect(events.some((e) => e.type === "tool_start")).toBe(false);
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd).toMatchObject({
      type: "tool_end",
      isError: true,
    });
    expect(
      toolEnd?.type === "tool_end" && toolEnd.result,
    ).toMatch(/Permission denied/);
    expect(events.at(-1)).toMatchObject({ type: "run_end", reason: "completed" });
  });

  it("ask_all stop while waiting: stopped without successful tool execution", async () => {
    const model: ModelPort = {
      id: "mock-ask-stop",
      async *stream() {
        yield {
          type: "tool_call",
          id: "call_read_stop_perm",
          name: "read_file",
          arguments: { path: "note.txt" },
        };
      },
    };
    const app = await appWithModel(model);
    await writeFile(join(dir, "note.txt"), "file-body", "utf8");
    await setAskAll(app);

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "ask stop" },
    });
    const { id: sessionId } = created.json<CreateSessionResponse>();

    const ws = await app.injectWS("/ws");
    const events: RunEvent[] = [];
    const permissionSeen = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("no permission_request")),
        3000,
      );
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as RunEvent;
        events.push(event);
        if (event.type === "permission_request") {
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
        content: "read then stop at permission",
      } satisfies WsClientMessage),
    );

    const runId = await permissionSeen;
    const stopped = await app.inject({
      method: "POST",
      url: `/runs/${runId}/stop`,
    });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json<StopRunResponse>()).toEqual({ ok: true });

    await ended;
    ws.terminate();

    expect(events.some((e) => e.type === "tool_start")).toBe(false);
    expect(
      events.some((e) => e.type === "tool_end" && !e.isError),
    ).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "run_end",
      runId,
      reason: "stopped",
    });
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

async function setAskAll(
  app: Awaited<ReturnType<typeof createApp>>,
): Promise<void> {
  const current = await app.inject({ method: "GET", url: "/config" });
  expect(current.statusCode).toBe(200);
  const config = current.json<AppConfig>();
  const updated = await app.inject({
    method: "PUT",
    url: "/config",
    payload: {
      ...config,
      permissions: { mode: "ask_all", allowlist: [] },
    },
  });
  expect(updated.statusCode).toBe(200);
}

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
