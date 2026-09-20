import { describe, expect, it } from "vitest";
import type { MessageDto, RunEvent } from "@agent2026/shared";
import {
  applyRunEvent,
  emptyProjection,
  markRunDisconnected,
  messagesToChatItems,
  appendUserMessage,
  resolvePermissionLocally,
  shouldApplyRunEvent,
} from "./apply-run-event.js";

describe("applyRunEvent", () => {
  it("projects streaming deltas onto one assistant bubble", () => {
    let state = emptyProjection();
    state = applyRunEvent(state, {
      type: "run_start",
      runId: "r1",
      sessionId: "s1",
      traceId: "t1",
    });
    state = applyRunEvent(state, { type: "message_delta", runId: "r1", delta: "hel" });
    state = applyRunEvent(state, { type: "message_delta", runId: "r1", delta: "lo" });
    state = applyRunEvent(state, { type: "run_end", runId: "r1", reason: "completed" });

    expect(state.runId).toBe("r1");
    expect(state.traceId).toBe("t1");
    expect(state.status).toBe("completed");
    expect(state.items).toEqual([
      { kind: "assistant", id: "delta-r1-0", content: "hello", streaming: false },
    ]);
    expect(state.traceNodes).toHaveLength(3);
    expect(state.traceNodes[0]).toMatchObject({ kind: "run_start" });
    expect(state.traceNodes[state.traceNodes.length - 1]).toMatchObject({
      kind: "run_end",
      reason: "completed",
    });
  });

  it("resets traceNodes on a second run_start in the same session", () => {
    let state = applyRunEvent(emptyProjection(), {
      type: "run_start",
      runId: "r1",
      sessionId: "s1",
      traceId: "t1",
    });
    state = applyRunEvent(state, { type: "message_delta", runId: "r1", delta: "a" });
    state = applyRunEvent(state, { type: "run_end", runId: "r1", reason: "completed" });
    expect(state.traceNodes.length).toBeGreaterThan(1);

    state = applyRunEvent(state, {
      type: "run_start",
      runId: "r2",
      sessionId: "s1",
      traceId: "t2",
    });
    expect(state.runId).toBe("r2");
    expect(state.traceNodes).toEqual([
      expect.objectContaining({ kind: "run_start" }),
    ]);
    expect(state.items.length).toBeGreaterThan(0);
  });

  it("opens and closes expandable tool cards", () => {
    let state = emptyProjection();
    state = applyRunEvent(state, {
      type: "tool_start",
      runId: "r1",
      toolCallId: "c1",
      name: "read_file",
      arguments: { path: "a.txt" },
    });
    expect(state.items[0]).toMatchObject({
      kind: "tool",
      toolCallId: "c1",
      name: "read_file",
      status: "running",
    });
    state = applyRunEvent(state, {
      type: "tool_end",
      runId: "r1",
      toolCallId: "c1",
      name: "read_file",
      result: "ok",
    });
    expect(state.items[0]).toMatchObject({
      status: "done",
      result: "ok",
    });
  });

  it("marks stop reason without dropping prior bubbles", () => {
    let state = appendUserMessage(emptyProjection(), "hi", "u1");
    state = applyRunEvent(state, { type: "message_delta", runId: "r1", delta: "ab" });
    state = applyRunEvent(state, { type: "run_end", runId: "r1", reason: "stopped" });
    expect(state.status).toBe("stopped");
    expect(state.items[0]).toEqual({ kind: "user", id: "u1", content: "hi" });
    expect(state.items[1]).toMatchObject({ content: "ab", streaming: false });
  });
});

describe("messagesToChatItems", () => {
  it("pairs stored toolCalls JSON with following tool results", () => {
    const messages: MessageDto[] = [
      { id: "m1", role: "user", content: "read it", createdAt: "t" },
      {
        id: "m2",
        role: "assistant",
        content: JSON.stringify([
          { id: "c1", name: "read_file", arguments: { path: "a.txt" } },
        ]),
        createdAt: "t",
      },
      { id: "m3", role: "tool", content: "file body", createdAt: "t" },
      { id: "m4", role: "assistant", content: "done", createdAt: "t" },
    ];
    expect(messagesToChatItems(messages)).toEqual([
      { kind: "user", id: "m1", content: "read it" },
      {
        kind: "tool",
        id: "c1",
        toolCallId: "c1",
        name: "read_file",
        arguments: { path: "a.txt" },
        result: "file body",
        status: "done",
      },
      { kind: "assistant", id: "m4", content: "done", streaming: false },
    ]);
  });
});

describe("shouldApplyRunEvent", () => {
  it("accepts run_start only for the selected session", () => {
    const event = {
      type: "run_start" as const,
      runId: "r1",
      sessionId: "s1",
      traceId: "t1",
    };
    expect(shouldApplyRunEvent(emptyProjection(), event, "s1")).toBe(true);
    expect(shouldApplyRunEvent(emptyProjection(), event, "s2")).toBe(false);
    expect(shouldApplyRunEvent(emptyProjection(), event, null)).toBe(false);
  });

  it("ignores deltas for other runs or after run ends", () => {
    let projection = emptyProjection();
    projection = applyRunEvent(projection, {
      type: "run_start",
      runId: "r1",
      sessionId: "s1",
      traceId: "t1",
    });
    const delta = { type: "message_delta" as const, runId: "r1", delta: "x" };
    expect(shouldApplyRunEvent(projection, delta, "s1")).toBe(true);
    expect(
      shouldApplyRunEvent(projection, { ...delta, runId: "r2" }, "s1"),
    ).toBe(false);
    expect(shouldApplyRunEvent(projection, delta, "s2")).toBe(false);

    projection = applyRunEvent(projection, {
      type: "run_end",
      runId: "r1",
      reason: "completed",
    });
    expect(shouldApplyRunEvent(projection, delta, "s1")).toBe(false);
  });

  it("ignores events while waiting for run_start after send", () => {
    const projection = {
      ...appendUserMessage(emptyProjection(), "hi", "u1"),
      sessionId: "s1",
      status: "running" as const,
      runId: null,
      traceId: null,
    };
    expect(
      shouldApplyRunEvent(projection, {
        type: "message_delta",
        runId: "r-old",
        delta: "x",
      }, "s1"),
    ).toBe(false);
  });
});

describe("permission projection", () => {
  it("creates permission_request items with pending status", () => {
    let state = applyRunEvent(emptyProjection(), {
      type: "run_start",
      runId: "r1",
      sessionId: "s1",
      traceId: "t1",
    });
    state = applyRunEvent(state, {
      type: "permission_request",
      runId: "r1",
      requestId: "req-1",
      toolName: "read_file",
      arguments: { path: "a.txt" },
    });

    expect(state.items).toEqual([
      {
        kind: "permission",
        id: "req-1",
        requestId: "req-1",
        toolName: "read_file",
        arguments: { path: "a.txt" },
        status: "pending",
      },
    ]);
  });

  it("resolves permission status locally", () => {
    let state = applyRunEvent(emptyProjection(), {
      type: "permission_request",
      runId: "r1",
      requestId: "req-1",
      toolName: "read_file",
      arguments: { path: "a.txt" },
    });

    state = resolvePermissionLocally(state, "req-1", "allowed");
    expect(state.items[0]).toMatchObject({ status: "allowed" });

    state = resolvePermissionLocally(state, "req-1", "session_allowed");
    expect(state.items[0]).toMatchObject({ status: "session_allowed" });

    state = resolvePermissionLocally(state, "req-1", "denied");
    expect(state.items[0]).toMatchObject({ status: "denied" });
  });

  it("marks pending permissions as expired on run_end", () => {
    let state = applyRunEvent(emptyProjection(), {
      type: "run_start",
      runId: "r1",
      sessionId: "s1",
      traceId: "t1",
    });
    state = applyRunEvent(state, {
      type: "permission_request",
      runId: "r1",
      requestId: "req-1",
      toolName: "read_file",
      arguments: { path: "a.txt" },
    });
    state = applyRunEvent(state, {
      type: "permission_request",
      runId: "r1",
      requestId: "req-2",
      toolName: "write_file",
      arguments: { path: "b.txt" },
    });
    state = resolvePermissionLocally(state, "req-1", "allowed");
    state = applyRunEvent(state, {
      type: "run_end",
      runId: "r1",
      reason: "completed",
    });

    expect(state.items[0]).toMatchObject({ requestId: "req-1", status: "allowed" });
    expect(state.items[1]).toMatchObject({ requestId: "req-2", status: "expired" });
  });

  it("markRunDisconnected expires pending and stops a running projection", () => {
    let state = applyRunEvent(emptyProjection(), {
      type: "run_start",
      runId: "r1",
      sessionId: "s1",
      traceId: "t1",
    });
    state = applyRunEvent(state, {
      type: "permission_request",
      runId: "r1",
      requestId: "req-1",
      toolName: "read_file",
      arguments: { path: "a.txt" },
    });

    state = markRunDisconnected(state);

    expect(state.status).toBe("stopped");
    expect(state.items[0]).toMatchObject({
      requestId: "req-1",
      status: "expired",
    });
  });
});

describe("trace nodes", () => {
  it("projects run_end into TraceNode timeline", () => {
    const event: RunEvent = { type: "run_end", runId: "r", reason: "error" };
    const state = applyRunEvent(emptyProjection(), event);
    expect(state.traceNodes).toEqual([
      { id: "r:end", kind: "run_end", reason: "error" },
    ]);
  });
});
