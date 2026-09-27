import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelPort } from "@agent2026/core";
import type {
  CreateSessionResponse,
  RunEvent,
  WsClientMessage,
} from "@agent2026/shared";
import { createApp } from "../app.js";
import type { MemoryRecaller } from "../memory/recaller.js";

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

describe("run injects recall block into model system context", () => {
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

  it("passes system prompt containing recall block to model", async () => {
    const seen: Array<{ role: string; content: string }> = [];
    const model: ModelPort = {
      id: "mock",
      async *stream(req) {
        for (const m of req.messages) {
          seen.push({ role: m.role, content: m.content });
        }
        yield { type: "text_delta" as const, text: "ok" };
      },
    };

    const resolveForRun = vi.fn(async () => "## 相关长期记忆（自动召回）\n1. 用 pnpm");
    const memoryRecaller: MemoryRecaller = {
      resolveForRun,
      getCache: () => undefined,
      clearSession: () => undefined,
      refresh: async () => ({
        block: "",
        query: "",
        fetchedAt: new Date().toISOString(),
        hitCount: 0,
        source: "empty",
      }),
    };

    dir = await mkdtemp(join(tmpdir(), "agent2026-runs-recall-"));
    app = await createApp({
      configPath: join(dir, "config.yaml"),
      credentialsPath: join(dir, "credentials.yaml"),
      dbPath: join(dir, "data.sqlite"),
      model,
      memoryRecaller,
      skipMcpReconcile: true,
      skipOpenVikingReconcile: true,
    });

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "recall" },
    });
    const session = created.json<CreateSessionResponse>();
    const ws = await app.injectWS("/ws");
    const pending = collectUntilEnd(ws);
    const request: WsClientMessage = {
      type: "run",
      sessionId: session.id,
      content: "按我的习惯装依赖",
    };
    ws.send(JSON.stringify(request));
    await pending;
    ws.terminate();

    expect(resolveForRun).toHaveBeenCalledOnce();
    const system = seen.find((m) => m.role === "system");
    expect(system?.content).toMatch(/相关长期记忆/);
    expect(system?.content).toMatch(/pnpm/);

    const stored = await app.inject({
      method: "GET",
      url: `/sessions/${session.id}`,
    });
    const body = stored.json<{ messages: Array<{ role: string; content: string }> }>();
    expect(body.messages.every((m) => m.role !== "system")).toBe(true);
    expect(body.messages.some((m) => m.content.includes("相关长期记忆"))).toBe(
      false,
    );
  });
});
