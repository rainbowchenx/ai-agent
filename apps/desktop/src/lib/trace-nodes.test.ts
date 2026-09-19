import { describe, expect, it } from "vitest";
import type { RunEvent } from "@agent2026/shared";
import { applyTraceEvent, spansToNodes, type TraceNode } from "./trace-nodes.js";

function applyEvents(events: RunEvent[]): TraceNode[] {
  let nodes: TraceNode[] = [];
  for (const event of events) {
    nodes = applyTraceEvent(nodes, event);
  }
  return nodes;
}

describe("applyTraceEvent", () => {
  it("projects run_start, generation, tool, and run_end through a run", () => {
    const nodes = applyEvents([
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
    ]);

    expect(nodes).toEqual([
      { id: "run-1:start", kind: "run_start" },
      { id: "run-1:gen-1", kind: "generation", status: "ok", name: "generation" },
      {
        id: "call-1",
        kind: "tool",
        name: "read_file",
        toolCallId: "call-1",
        status: "ok",
        summary: "file contents here",
      },
      { id: "run-1:gen-2", kind: "generation", status: "ok", name: "generation" },
      { id: "run-1:end", kind: "run_end", reason: "completed" },
    ]);
  });

  it("keeps a single running generation across multiple deltas", () => {
    let nodes = applyEvents([
      {
        type: "run_start",
        runId: "r1",
        sessionId: "s1",
        traceId: "t1",
      },
      { type: "message_delta", runId: "r1", delta: "a" },
    ]);
    nodes = applyTraceEvent(nodes, {
      type: "message_delta",
      runId: "r1",
      delta: "b",
    });

    const generations = nodes.filter((n) => n.kind === "generation");
    expect(generations).toHaveLength(1);
    expect(generations[0]).toMatchObject({ status: "running" });
  });

  it("truncates tool summary to 200 characters", () => {
    const longResult = "x".repeat(250);
    const nodes = applyEvents([
      {
        type: "run_start",
        runId: "run-1",
        sessionId: "s1",
        traceId: "t1",
      },
      {
        type: "tool_start",
        runId: "run-1",
        toolCallId: "call-1",
        name: "read_file",
        arguments: {},
      },
      {
        type: "tool_end",
        runId: "run-1",
        toolCallId: "call-1",
        name: "read_file",
        result: longResult,
      },
    ]);

    const tool = nodes.find((n) => n.kind === "tool");
    expect(tool?.kind === "tool" && tool.summary).toHaveLength(200);
  });

  it("finalizes open spans on error and adds error node", () => {
    const nodes = applyEvents([
      {
        type: "run_start",
        runId: "run-1",
        sessionId: "s1",
        traceId: "t1",
      },
      { type: "message_delta", runId: "run-1", delta: "oops" },
      { type: "error", runId: "run-1", message: "model failed" },
    ]);

    expect(nodes).toContainEqual({
      id: "run-1:gen-1",
      kind: "generation",
      status: "error",
      name: "generation",
    });
    expect(nodes).toContainEqual({
      id: "run-1:error",
      kind: "error",
      message: "model failed",
    });
  });

  it("adds run_end after error with terminal span status", () => {
    const nodes = applyEvents([
      {
        type: "run_start",
        runId: "run-1",
        sessionId: "s1",
        traceId: "t1",
      },
      { type: "message_delta", runId: "run-1", delta: "oops" },
      { type: "error", runId: "run-1", message: "model failed" },
      { type: "run_end", runId: "run-1", reason: "error" },
    ]);

    expect(nodes[nodes.length - 1]).toEqual({
      id: "run-1:end",
      kind: "run_end",
      reason: "error",
    });
  });
});

describe("spansToNodes", () => {
  it("maps persisted spans into TraceNode timeline", () => {
    const nodes = spansToNodes(
      [
        {
          spanId: "span-1",
          name: "generation",
          kind: "generation",
          status: "ok",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: "2026-01-01T00:00:01.000Z",
        },
        {
          spanId: "span-2",
          name: "read_file",
          kind: "tool",
          status: "ok",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:02.000Z",
          summary: "file body",
        },
        {
          spanId: "span-3",
          name: "generation",
          kind: "generation",
          status: "ok",
          startedAt: "2026-01-01T00:00:02.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
      ],
      { status: "completed" },
    );

    expect(nodes).toEqual([
      { id: "history:start", kind: "run_start" },
      { id: "span-1", kind: "generation", status: "ok", name: "generation" },
      {
        id: "span-2",
        kind: "tool",
        name: "read_file",
        toolCallId: "span-2",
        status: "ok",
        summary: "file body",
      },
      { id: "span-3", kind: "generation", status: "ok", name: "generation" },
      { id: "history:end", kind: "run_end", reason: "completed" },
    ]);
  });

  it("marks last span running when trace status is running", () => {
    const nodes = spansToNodes(
      [
        {
          spanId: "span-1",
          name: "generation",
          kind: "generation",
          status: "ok",
          startedAt: "t1",
          endedAt: "t2",
        },
        {
          spanId: "span-2",
          name: "generation",
          kind: "generation",
          startedAt: "t2",
        },
      ],
      { status: "running" },
    );

    expect(nodes).not.toContainEqual(
      expect.objectContaining({ kind: "run_end" }),
    );
    expect(nodes[nodes.length - 1]).toEqual({
      id: "span-2",
      kind: "generation",
      status: "running",
      name: "generation",
    });
  });
});
