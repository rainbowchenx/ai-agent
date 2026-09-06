import { describe, expect, it } from "vitest";
import type { RunnerEvent } from "@agent2026/core";
import { toRunEvent } from "./map-run-event.js";

describe("toRunEvent", () => {
  it("keeps runId and toolCallId on tool events", () => {
    const start: RunnerEvent = {
      type: "tool_start",
      runId: "run-keep",
      toolCallId: "call-keep",
      name: "read_file",
      arguments: { path: "a.txt" },
    };
    const end: RunnerEvent = {
      type: "tool_end",
      runId: "run-keep",
      toolCallId: "call-keep",
      name: "read_file",
      result: "ok",
      isError: false,
    };

    expect(toRunEvent(start)).toEqual(start);
    expect(toRunEvent(end)).toEqual(end);
  });

  it("keeps runId on stream and terminal events", () => {
    const start = toRunEvent({
      type: "run_start",
      runId: "r1",
      sessionId: "s1",
      traceId: "t1",
    });
    const delta = toRunEvent({
      type: "message_delta",
      runId: "r1",
      delta: "hi",
    });
    const ended = toRunEvent({
      type: "run_end",
      runId: "r1",
      reason: "stopped",
    });

    expect(start).toEqual({
      type: "run_start",
      runId: "r1",
      sessionId: "s1",
      traceId: "t1",
    });
    expect(delta).toEqual({ type: "message_delta", runId: "r1", delta: "hi" });
    expect(ended).toEqual({ type: "run_end", runId: "r1", reason: "stopped" });
  });
});
