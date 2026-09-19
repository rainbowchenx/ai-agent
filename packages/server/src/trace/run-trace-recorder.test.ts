import { describe, expect, it } from "vitest";
import type { RunnerEvent } from "@agent2026/core";
import type { TraceRunStatus } from "../store/sqlite-trace-port.js";
import {
  createRunTraceRecorder,
  type RunTraceRecorderPort,
} from "./run-trace-recorder.js";

type StartSpanCall = {
  traceId: string;
  name: string;
  kind: "generation" | "tool" | "permission";
  parentSpanId?: string;
};

type EndSpanCall = {
  spanId: string;
  status?: "ok" | "error";
  metadata?: Record<string, unknown>;
};

type UpdateTraceEndCall = {
  runId: string;
  status: TraceRunStatus;
  endedAt: string;
};

function createFakePort(options?: {
  startSpan?: RunTraceRecorderPort["startSpan"];
  endSpan?: RunTraceRecorderPort["endSpan"];
  updateTraceEnd?: RunTraceRecorderPort["updateTraceEnd"];
}) {
  const startSpanCalls: StartSpanCall[] = [];
  const endSpanCalls: EndSpanCall[] = [];
  const updateTraceEndCalls: UpdateTraceEndCall[] = [];
  let spanCounter = 0;

  const port: RunTraceRecorderPort = {
    startSpan: options?.startSpan ?? (async (input) => {
      startSpanCalls.push(input);
      spanCounter += 1;
      return { spanId: `span-${spanCounter}` };
    }),
    endSpan: options?.endSpan ?? (async (input) => {
      endSpanCalls.push(input);
    }),
    updateTraceEnd: options?.updateTraceEnd ?? (async (input) => {
      updateTraceEndCalls.push(input);
    }),
  };

  return { port, startSpanCalls, endSpanCalls, updateTraceEndCalls };
}

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("createRunTraceRecorder", () => {
  it("records generation, tool, and second generation spans through a run", async () => {
    const { port, startSpanCalls, endSpanCalls, updateTraceEndCalls } =
      createFakePort();
    const recorder = createRunTraceRecorder(port);

    const events: RunnerEvent[] = [
      {
        type: "run_start",
        runId: "run-1",
        sessionId: "session-1",
        traceId: "trace-1",
      },
      { type: "message_delta", runId: "run-1", delta: "Hello" },
      { type: "message_delta", runId: "run-1", delta: " world" },
      {
        type: "tool_start",
        runId: "run-1",
        toolCallId: "call-1",
        name: "read_file",
        arguments: { path: "a.txt" },
      },
      {
        type: "tool_end",
        runId: "run-1",
        toolCallId: "call-1",
        name: "read_file",
        result: "file contents here",
        isError: false,
      },
      { type: "message_delta", runId: "run-1", delta: "Done" },
      { type: "run_end", runId: "run-1", reason: "completed" },
    ];

    for (const event of events) {
      recorder.onEvent(event);
    }
    await flushAsync();

    expect(startSpanCalls).toEqual([
      { traceId: "trace-1", name: "generation", kind: "generation" },
      { traceId: "trace-1", name: "read_file", kind: "tool" },
      { traceId: "trace-1", name: "generation", kind: "generation" },
    ]);

    expect(endSpanCalls).toEqual([
      { spanId: "span-1", status: "ok" },
      {
        spanId: "span-2",
        status: "ok",
        metadata: { summary: "file contents here" },
      },
      { spanId: "span-3", status: "ok" },
    ]);

    expect(updateTraceEndCalls).toHaveLength(1);
    expect(updateTraceEndCalls[0]).toMatchObject({
      runId: "run-1",
      status: "completed",
    });
    expect(updateTraceEndCalls[0]?.endedAt).toBeTruthy();
  });

  it("truncates tool result summary to 200 characters", async () => {
    const { port, endSpanCalls } = createFakePort();
    const recorder = createRunTraceRecorder(port);
    const longResult = "x".repeat(250);

    recorder.onEvent({
      type: "run_start",
      runId: "run-1",
      sessionId: "session-1",
      traceId: "trace-1",
    });
    recorder.onEvent({
      type: "tool_start",
      runId: "run-1",
      toolCallId: "call-1",
      name: "read_file",
      arguments: {},
    });
    recorder.onEvent({
      type: "tool_end",
      runId: "run-1",
      toolCallId: "call-1",
      name: "read_file",
      result: longResult,
      isError: false,
    });
    await flushAsync();

    const summary = endSpanCalls[0]?.metadata?.summary;
    expect(summary).toHaveLength(200);
    expect(summary).toBe(longResult.slice(0, 200));
  });

  it("ends open generation spans on error but waits for run_end to update trace", async () => {
    const { port, endSpanCalls, updateTraceEndCalls } = createFakePort();
    const recorder = createRunTraceRecorder(port);

    recorder.onEvent({
      type: "run_start",
      runId: "run-1",
      sessionId: "session-1",
      traceId: "trace-1",
    });
    recorder.onEvent({ type: "message_delta", runId: "run-1", delta: "oops" });
    recorder.onEvent({
      type: "error",
      runId: "run-1",
      message: "model failed",
    });
    await flushAsync();

    expect(endSpanCalls).toEqual([{ spanId: "span-1", status: "error" }]);
    expect(updateTraceEndCalls).toHaveLength(0);

    recorder.onEvent({ type: "run_end", runId: "run-1", reason: "error" });
    await flushAsync();

    expect(updateTraceEndCalls).toEqual([
      expect.objectContaining({ runId: "run-1", status: "error" }),
    ]);
  });

  it("does not throw when port calls fail", async () => {
    const { port } = createFakePort({
      startSpan: async () => {
        throw new Error("db down");
      },
      endSpan: async () => {
        throw new Error("db down");
      },
      updateTraceEnd: async () => {
        throw new Error("db down");
      },
    });
    const recorder = createRunTraceRecorder(port);

    expect(() => {
      recorder.onEvent({
        type: "run_start",
        runId: "run-1",
        sessionId: "session-1",
        traceId: "trace-1",
      });
      recorder.onEvent({ type: "message_delta", runId: "run-1", delta: "hi" });
      recorder.onEvent({ type: "run_end", runId: "run-1", reason: "completed" });
    }).not.toThrow();

    await flushAsync();
  });
});
