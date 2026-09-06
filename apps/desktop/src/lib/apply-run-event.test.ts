import { describe, expect, it } from "vitest";
import type { MessageDto, RunEvent } from "@agent2026/shared";
import {
  applyRunEvent,
  emptyProjection,
  messagesToChatItems,
  appendUserMessage,
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
    expect(state.traceLines).toHaveLength(4);
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

describe("trace line", () => {
  it("keeps raw RunEvent JSON for the details pane", () => {
    const event: RunEvent = { type: "run_end", runId: "r", reason: "error" };
    const state = applyRunEvent(emptyProjection(), event);
    expect(state.traceLines[0]).toBe(JSON.stringify(event));
  });
});
