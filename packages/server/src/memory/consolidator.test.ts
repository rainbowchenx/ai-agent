import { describe, expect, it, vi } from "vitest";
import type { ModelPort, ModelStreamEvent, ToolPort } from "@agent2026/core";
import { defaultAppConfig, type AppConfig } from "@agent2026/shared";
import {
  createMemoryConsolidator,
  type DistillJob,
  type MemoryConsolidatorDeps,
} from "./consolidator.js";
import { DISTILL_QUEUE_MAX } from "./constants.js";

const VALID_ITEM = {
  kind: "preference",
  when: "user asks for package manager",
  do: "default to pnpm for installs",
  outcome: "user said prefer pnpm in run",
  confidence: 0.8,
};

function baseJob(overrides: Partial<DistillJob> = {}): DistillJob {
  return {
    runId: "run-1",
    sessionId: "sess-1",
    traceId: "trace-1",
    messages: [{ role: "user", content: "please use pnpm" }],
    ...overrides,
  };
}

function configWith(ov?: AppConfig["openviking"]): AppConfig {
  const cfg = defaultAppConfig();
  if (ov !== undefined) {
    return { ...cfg, openviking: ov };
  }
  return cfg;
}

function textModel(chunks: string[]): ModelPort {
  return {
    id: "mock-distill",
    async *stream(): AsyncIterable<ModelStreamEvent> {
      for (const text of chunks) {
        yield { type: "text_delta", text };
      }
    },
  };
}

function jsonModel(payload: unknown): ModelPort {
  return textModel([JSON.stringify(payload)]);
}

function hangModel(gate: Promise<void>): ModelPort {
  return {
    id: "mock-hang",
    async *stream(): AsyncIterable<ModelStreamEvent> {
      await gate;
      yield {
        type: "text_delta",
        text: JSON.stringify({ items: [VALID_ITEM] }),
      };
    },
  };
}

function throwModel(err: Error): ModelPort {
  return {
    id: "mock-throw",
    async *stream(): AsyncIterable<ModelStreamEvent> {
      throw err;
    },
  };
}

function mockPort(execute?: ToolPort["execute"]): ToolPort {
  return {
    list: () => [],
    execute:
      execute ??
      (async () => {
        return "ok";
      }),
  };
}

function makeDeps(
  overrides: Partial<{
    config: AppConfig;
    ovStatus: { status: string; enabled: boolean };
    port: ToolPort | undefined;
    model: ModelPort;
  }> = {},
): MemoryConsolidatorDeps & {
  modelCalls: number;
  portExecute: ReturnType<typeof vi.fn>;
} {
  const portExecute = vi.fn(
    overrides.port?.execute ??
      (async () => {
        return "ok";
      }),
  );
  const port =
    "port" in overrides
      ? overrides.port
      : mockPort(portExecute);

  let modelCalls = 0;
  const inner =
    overrides.model ?? jsonModel({ items: [VALID_ITEM] });
  const model: ModelPort = {
    id: inner.id,
    async *stream(input) {
      modelCalls += 1;
      yield* inner.stream(input);
    },
  };

  const deps: MemoryConsolidatorDeps & {
    modelCalls: number;
    portExecute: ReturnType<typeof vi.fn>;
  } = {
    getConfig: () => overrides.config ?? configWith({ autoDistill: true }),
    getOpenVikingStatus: () =>
      overrides.ovStatus ?? { status: "ready", enabled: true },
    getOpenVikingPort: () => port,
    getModel: () => model,
    modelCalls: 0,
    portExecute,
  };

  Object.defineProperty(deps, "modelCalls", {
    get: () => modelCalls,
  });

  return deps;
}

async function waitForStatus(
  get: () => { lastStatus: string },
  statuses: string[],
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (statuses.includes(get().lastStatus)) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `timed out waiting for status in [${statuses.join(", ")}]; got ${get().lastStatus}`,
  );
}

describe("createMemoryConsolidator", () => {
  it("initial getLastResult is idle with gate-derived enabled", () => {
    const deps = makeDeps({
      ovStatus: { status: "ready", enabled: true },
      config: configWith({ autoDistill: true }),
    });
    const c = createMemoryConsolidator(deps);
    expect(c.getLastResult()).toEqual({
      enabled: true,
      lastStatus: "idle",
    });
  });

  it("skips when autoDistill is false without calling model or port", async () => {
    const deps = makeDeps({
      config: configWith({ autoDistill: false }),
    });
    const c = createMemoryConsolidator(deps);
    c.enqueue(baseJob());
    await waitForStatus(() => c.getLastResult(), ["skipped"]);
    expect(c.getLastResult().lastStatus).toBe("skipped");
    expect(deps.modelCalls).toBe(0);
    expect(deps.portExecute).not.toHaveBeenCalled();
  });

  it("skips when OpenViking is not ready", async () => {
    const deps = makeDeps({
      ovStatus: { status: "starting", enabled: true },
    });
    const c = createMemoryConsolidator(deps);
    c.enqueue(baseJob());
    await waitForStatus(() => c.getLastResult(), ["skipped"]);
    expect(deps.modelCalls).toBe(0);
    expect(deps.portExecute).not.toHaveBeenCalled();
  });

  it("skips when OpenViking is disabled", async () => {
    const deps = makeDeps({
      ovStatus: { status: "ready", enabled: false },
    });
    const c = createMemoryConsolidator(deps);
    c.enqueue(baseJob());
    await waitForStatus(() => c.getLastResult(), ["skipped"]);
    expect(deps.modelCalls).toBe(0);
    expect(deps.portExecute).not.toHaveBeenCalled();
  });

  it("writes one valid item and sets lastStatus ok", async () => {
    const deps = makeDeps({
      model: jsonModel({ items: [VALID_ITEM] }),
    });
    const c = createMemoryConsolidator(deps);
    c.enqueue(baseJob());
    await waitForStatus(() => c.getLastResult(), ["ok"]);
    const result = c.getLastResult();
    expect(result.lastStatus).toBe("ok");
    expect(result.lastWritten).toBe(1);
    expect(result.lastRunId).toBe("run-1");
    expect(deps.portExecute).toHaveBeenCalled();
    expect(deps.portExecute.mock.calls[0]?.[0]).toBe("openviking__write");
  });

  it("sets error on bad JSON and does not write", async () => {
    const deps = makeDeps({
      model: textModel(["not-json{{{"]),
    });
    const c = createMemoryConsolidator(deps);
    c.enqueue(baseJob());
    await waitForStatus(() => c.getLastResult(), ["error"]);
    expect(c.getLastResult().lastStatus).toBe("error");
    expect(deps.portExecute).not.toHaveBeenCalled();
  });

  it("returns ok with written 0 when confidence is too low", async () => {
    const deps = makeDeps({
      model: jsonModel({
        items: [{ ...VALID_ITEM, confidence: 0.2 }],
      }),
    });
    const c = createMemoryConsolidator(deps);
    c.enqueue(baseJob());
    await waitForStatus(() => c.getLastResult(), ["ok"]);
    expect(c.getLastResult()).toMatchObject({
      lastStatus: "ok",
      lastWritten: 0,
    });
    expect(deps.portExecute).not.toHaveBeenCalled();
  });

  it("enqueue returns immediately even when model hangs", async () => {
    let resolveHang!: () => void;
    const hang = new Promise<void>((r) => {
      resolveHang = r;
    });
    const deps = makeDeps({ model: hangModel(hang) });
    const c = createMemoryConsolidator(deps);

    let returned = false;
    c.enqueue(baseJob());
    returned = true;
    expect(returned).toBe(true);

    await Promise.resolve();
    const status = c.getLastResult().lastStatus;
    expect(["idle", "running"]).toContain(status);

    resolveHang();
    await waitForStatus(() => c.getLastResult(), ["ok"]);
  });

  it("skips the 4th job with skipped_busy when queue is full", async () => {
    let resolveHang!: () => void;
    const hang = new Promise<void>((r) => {
      resolveHang = r;
    });
    const deps = makeDeps({ model: hangModel(hang) });
    const c = createMemoryConsolidator(deps);

    for (let i = 0; i < DISTILL_QUEUE_MAX; i++) {
      c.enqueue(baseJob({ runId: `run-${i}` }));
    }
    c.enqueue(baseJob({ runId: "run-overflow" }));

    expect(c.getLastResult()).toMatchObject({
      lastStatus: "skipped",
      lastMessage: "skipped_busy",
    });

    resolveHang();
    await waitForStatus(() => c.getLastResult(), ["ok"]);
  });

  it("model throw sets error without bubbling to enqueue caller", async () => {
    const deps = makeDeps({
      model: throwModel(new Error("boom")),
    });
    const c = createMemoryConsolidator(deps);
    expect(() => c.enqueue(baseJob())).not.toThrow();
    await waitForStatus(() => c.getLastResult(), ["error"]);
    expect(c.getLastResult().lastStatus).toBe("error");
    expect(c.getLastResult().lastMessage).toMatch(/boom/);
    expect(deps.portExecute).not.toHaveBeenCalled();
  });
});
