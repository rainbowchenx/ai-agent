import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelPort } from "@agent2026/core";
import type {
  CreateSessionResponse,
  DistillStatusView,
  RunEvent,
  StopRunResponse,
  WsClientMessage,
} from "@agent2026/shared";
import { createApp } from "../app.js";
import type {
  DistillJob,
  MemoryConsolidator,
} from "../memory/consolidator.js";

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
      () =>
        reject(
          new Error(`timed out waiting for run_end: ${JSON.stringify(events)}`),
        ),
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

function mockMemory(
  overrides: Partial<MemoryConsolidator> = {},
): MemoryConsolidator & { enqueue: ReturnType<typeof vi.fn> } {
  const idle: DistillStatusView = { enabled: false, lastStatus: "idle" };
  const enqueue =
    (overrides.enqueue as ReturnType<typeof vi.fn> | undefined) ?? vi.fn();
  return {
    getLastResult: () => idle,
    shutdown: async () => undefined,
    ...overrides,
    enqueue,
  };
}

describe("run completed enqueues memory distill", () => {
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

  async function appWith(
    model: ModelPort,
    memory: MemoryConsolidator,
  ) {
    dir = await mkdtemp(join(tmpdir(), "agent2026-runs-distill-"));
    app = await createApp({
      configPath: join(dir, "config.yaml"),
      dbPath: join(dir, "data.sqlite"),
      workspaceRoot: dir,
      model,
      memory,
      skipMcpReconcile: true,
      skipOpenVikingReconcile: true,
    });
    await app.ready();
    return app;
  }

  it("enqueues once after completed run with new messages", async () => {
    const memory = mockMemory();
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        yield { type: "text_delta", text: "hello" };
      },
    };
    const app = await appWith(model, memory);

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "distill completed" },
    });
    const { id: sessionId } = created.json<CreateSessionResponse>();

    const ws = await app.injectWS("/ws");
    const pending = collectUntilEnd(ws);
    ws.send(
      JSON.stringify({
        type: "run",
        sessionId,
        content: "say hello",
      } satisfies WsClientMessage),
    );
    const events = await pending;
    ws.terminate();

    expect(events.at(-1)).toMatchObject({
      type: "run_end",
      reason: "completed",
    });
    expect(memory.enqueue).toHaveBeenCalledOnce();
    const job = memory.enqueue.mock.calls[0]?.[0] as DistillJob;
    expect(job.sessionId).toBe(sessionId);
    expect(job.runId).toEqual(expect.any(String));
    expect(job.traceId).toEqual(expect.any(String));
    expect(job.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "say hello" }),
        expect.objectContaining({ role: "assistant", content: "hello" }),
      ]),
    );
    expect(job.messages[0]).toMatchObject({
      role: "user",
      content: "say hello",
    });
  });

  it("does not enqueue after stop", async () => {
    const memory = mockMemory();
    const model: ModelPort = {
      id: "mock-slow",
      async *stream({ signal }) {
        yield { type: "text_delta", text: "tick" };
        await abortableDelay(10_000, signal);
        yield { type: "text_delta", text: "should-not-appear" };
      },
    };
    const app = await appWith(model, memory);

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "distill stop" },
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

    expect(events.at(-1)).toMatchObject({
      type: "run_end",
      reason: "stopped",
    });
    expect(memory.enqueue).not.toHaveBeenCalled();
  });

  it("does not enqueue after model error", async () => {
    const memory = mockMemory();
    const model: ModelPort = {
      id: "mock-error",
      async *stream() {
        throw new Error("boom");
      },
    };
    const app = await appWith(model, memory);

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "distill error" },
    });
    const { id: sessionId } = created.json<CreateSessionResponse>();

    const ws = await app.injectWS("/ws");
    const events = await (() => {
      const pending = collectUntilEnd(ws);
      ws.send(
        JSON.stringify({
          type: "run",
          sessionId,
          content: "fail please",
        } satisfies WsClientMessage),
      );
      return pending;
    })();
    ws.terminate();

    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "run_end",
      reason: "error",
    });
    expect(memory.enqueue).not.toHaveBeenCalled();
  });

  it("GET /memory/distill/status is wired through createApp", async () => {
    const status: DistillStatusView = {
      enabled: true,
      lastStatus: "skipped",
      lastMessage: "skipped_busy",
    };
    const memory = mockMemory({
      getLastResult: () => status,
    });
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        yield { type: "text_delta", text: "x" };
      },
    };
    const app = await appWith(model, memory);

    const res = await app.inject({
      method: "GET",
      url: "/memory/distill/status",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(status);
  });
});
