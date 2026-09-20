import { describe, expect, it } from "vitest";
import type { ModelPort } from "../ports/model-port.js";
import type { ToolPort } from "../ports/tool-port.js";
import { Runner } from "./runner.js";
import { ToolRegistry } from "../tools/registry.js";
import type { RunnerEvent } from "./types.js";

function emptyToolPort(): ToolPort {
  return {
    list: () => [],
    execute: async () => {
      throw new Error("no tools registered");
    },
  };
}

function eventTypes(events: RunnerEvent[]): string[] {
  return events.map((e) => e.type);
}

function lastEvent(events: RunnerEvent[]): RunnerEvent | undefined {
  return events[events.length - 1];
}

describe("Runner", () => {
  it("streams text-only completion", async () => {
    const events: string[] = [];
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        yield { type: "text_delta", text: "hello" };
      },
    };
    const runner = new Runner({ maxTurns: 4 });
    await runner.run({
      messages: [],
      userMessage: { role: "user", content: "hi" },
      model,
      tools: emptyToolPort(),
      permissions: { mode: "default", allowlist: [] },
      onEvent: (e) => events.push(e.type),
    });
    expect(events).toContain("run_start");
    expect(events).toContain("message_delta");
    expect(events[events.length - 1]).toBe("run_end");
  });

  it("executes tool_call then streams final text via echo ToolRegistry", async () => {
    const events: RunnerEvent[] = [];
    let turn = 0;
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool_call",
            id: "call_echo_1",
            name: "echo",
            arguments: { text: "ping" },
          };
          return;
        }
        yield { type: "text_delta", text: "pong" };
      },
    };

    const tools = new ToolRegistry();
    tools.register(
      {
        name: "echo",
        description: "Echo the text argument",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
        },
      },
      async (args) => String(args.text ?? ""),
    );

    const runner = new Runner({ maxTurns: 4 });
    const result = await runner.run({
      messages: [],
      userMessage: { role: "user", content: "echo ping" },
      model,
      tools,
      permissions: { mode: "default", allowlist: [] },
      onEvent: (e) => events.push(e),
    });

    expect(eventTypes(events)).toContain("tool_start");
    expect(eventTypes(events)).toContain("tool_end");
    expect(eventTypes(events)).toContain("message_delta");
    expect(lastEvent(events)?.type).toBe("run_end");

    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd?.type === "tool_end" && toolEnd.result).toBe("ping");

    const delta = events.find((e) => e.type === "message_delta");
    expect(delta?.type === "message_delta" && delta.delta).toBe("pong");

    expect(result.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
  });

  it("ends with reason stopped when AbortSignal aborts", async () => {
    const events: RunnerEvent[] = [];
    const ac = new AbortController();
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        yield { type: "text_delta", text: "partial" };
        ac.abort();
      },
    };
    const runner = new Runner({ maxTurns: 4 });
    await runner.run({
      messages: [],
      userMessage: { role: "user", content: "hi" },
      model,
      tools: emptyToolPort(),
      permissions: { mode: "default", allowlist: [] },
      signal: ac.signal,
      onEvent: (e) => events.push(e),
    });

    const end = lastEvent(events);
    expect(end?.type).toBe("run_end");
    expect(end?.type === "run_end" && end.reason).toBe("stopped");
  });

  it("skips permission_request when isPreAllowed returns true", async () => {
    const events: RunnerEvent[] = [];
    let asked = 0;
    let executed = 0;
    let turn = 0;
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool_call",
            id: "call_echo_pre",
            name: "echo",
            arguments: { text: "pre-allowed" },
          };
          return;
        }
        yield { type: "text_delta", text: "ok" };
      },
    };

    const tools = new ToolRegistry();
    tools.register(
      {
        name: "echo",
        description: "Echo the text argument",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
        },
      },
      async (args) => {
        executed += 1;
        return String(args.text ?? "");
      },
    );

    const runner = new Runner({ maxTurns: 4 });
    await runner.run({
      messages: [],
      userMessage: { role: "user", content: "echo pre-allowed" },
      model,
      tools,
      permissions: { mode: "ask_all", allowlist: [] },
      isPreAllowed: (name) => name === "echo",
      onPermissionRequest: async () => {
        asked += 1;
        return { allow: true };
      },
      onEvent: (e) => events.push(e),
    });

    expect(asked).toBe(0);
    expect(eventTypes(events)).not.toContain("permission_request");
    expect(executed).toBe(1);
    expect(eventTypes(events)).toContain("tool_start");
    expect(eventTypes(events)).toContain("tool_end");
    expect(lastEvent(events)?.type).toBe("run_end");
  });

  it("asks permission via onPermissionRequest Promise in ask_all mode", async () => {
    const events: RunnerEvent[] = [];
    let asked = 0;
    let turn = 0;
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool_call",
            id: "call_echo_perm",
            name: "echo",
            arguments: { text: "secret" },
          };
          return;
        }
        yield { type: "text_delta", text: "ok" };
      },
    };

    const tools = new ToolRegistry();
    tools.register(
      {
        name: "echo",
        description: "Echo the text argument",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
        },
      },
      async (args) => String(args.text ?? ""),
    );

    const runner = new Runner({ maxTurns: 4 });
    await runner.run({
      messages: [],
      userMessage: { role: "user", content: "echo secret" },
      model,
      tools,
      permissions: { mode: "ask_all", allowlist: [] },
      onPermissionRequest: async () => {
        asked += 1;
        return { allow: true };
      },
      onEvent: (e) => events.push(e),
    });

    expect(asked).toBe(1);
    expect(eventTypes(events)).toContain("permission_request");
    expect(eventTypes(events)).toContain("tool_start");
    expect(eventTypes(events)).toContain("tool_end");
    expect(lastEvent(events)?.type).toBe("run_end");
  });

  it("turns tool throws into tool result strings without crashing the run", async () => {
    const events: RunnerEvent[] = [];
    let turn = 0;
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool_call",
            id: "call_boom",
            name: "boom",
            arguments: {},
          };
          return;
        }
        yield { type: "text_delta", text: "recovered" };
      },
    };

    const tools = new ToolRegistry();
    tools.register(
      {
        name: "boom",
        description: "Always throws",
        parameters: { type: "object" },
      },
      async () => {
        throw new Error("tool exploded");
      },
    );

    const runner = new Runner({ maxTurns: 4 });
    const result = await runner.run({
      messages: [],
      userMessage: { role: "user", content: "boom" },
      model,
      tools,
      permissions: { mode: "default", allowlist: [] },
      onEvent: (e) => events.push(e),
    });

    expect(lastEvent(events)?.type).toBe("run_end");
    expect(lastEvent(events)?.type === "run_end" && lastEvent(events)?.reason).toBe(
      "completed",
    );

    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd?.type === "tool_end" && toolEnd.isError).toBe(true);
    expect(toolEnd?.type === "tool_end" && toolEnd.result).toContain("tool exploded");

    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.role === "tool" && toolMsg.content).toContain("tool exploded");
  });

  it("stops the loop at maxTurns hard limit", async () => {
    const events: RunnerEvent[] = [];
    let modelCalls = 0;
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        modelCalls += 1;
        yield {
          type: "tool_call",
          id: `call_${modelCalls}`,
          name: "echo",
          arguments: { text: String(modelCalls) },
        };
      },
    };

    const tools = new ToolRegistry();
    tools.register(
      {
        name: "echo",
        description: "Echo the text argument",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
        },
      },
      async (args) => String(args.text ?? ""),
    );

    const runner = new Runner({ maxTurns: 2 });
    await runner.run({
      messages: [],
      userMessage: { role: "user", content: "loop" },
      model,
      tools,
      permissions: { mode: "default", allowlist: [] },
      onEvent: (e) => events.push(e),
    });

    expect(modelCalls).toBe(2);
    const end = lastEvent(events);
    expect(end?.type).toBe("run_end");
    expect(end?.type === "run_end" && end.reason).toBe("completed");
  });

  it("aborts while waiting for ask_all permission without executing", async () => {
    const events: RunnerEvent[] = [];
    const ac = new AbortController();
    let executed = 0;
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        yield {
          type: "tool_call",
          id: "call_perm_abort",
          name: "echo",
          arguments: { text: "secret" },
        };
      },
    };

    const tools = new ToolRegistry();
    tools.register(
      {
        name: "echo",
        description: "Echo the text argument",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
        },
      },
      async (args) => {
        executed += 1;
        return String(args.text ?? "");
      },
    );

    const runner = new Runner({ maxTurns: 4 });
    const result = await runner.run({
      messages: [],
      userMessage: { role: "user", content: "echo secret" },
      model,
      tools,
      permissions: { mode: "ask_all", allowlist: [] },
      signal: ac.signal,
      onPermissionRequest: () => new Promise(() => {
        /* hang until abort wins the race */
      }),
      onEvent: (e) => {
        events.push(e);
        if (e.type === "permission_request") {
          queueMicrotask(() => ac.abort());
        }
      },
    });

    expect(executed).toBe(0);
    expect(eventTypes(events)).toContain("permission_request");
    expect(eventTypes(events)).not.toContain("tool_start");
    expect(result.reason).toBe("stopped");
    const end = lastEvent(events);
    expect(end?.type === "run_end" && end.reason).toBe("stopped");

    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.role === "tool" && toolMsg.toolCallId).toBe("call_perm_abort");
    expect(toolMsg?.role === "tool" && toolMsg.content).toMatch(/cancelled/i);
  });

  it("pairs leftover tool_calls with tool messages when maxToolCalls is hit", async () => {
    let turn = 0;
    let secondTurnToolIds: string[] = [];
    const model: ModelPort = {
      id: "mock",
      async *stream({ messages }) {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool_call",
            id: "call_a",
            name: "echo",
            arguments: { text: "a" },
          };
          yield {
            type: "tool_call",
            id: "call_b",
            name: "echo",
            arguments: { text: "b" },
          };
          return;
        }
        secondTurnToolIds = messages
          .filter((m) => m.role === "tool")
          .map((m) => (m.role === "tool" ? m.toolCallId : ""));
        yield { type: "text_delta", text: "done" };
      },
    };

    const tools = new ToolRegistry();
    tools.register(
      {
        name: "echo",
        description: "Echo the text argument",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
        },
      },
      async (args) => String(args.text ?? ""),
    );

    const runner = new Runner({ maxTurns: 4, maxToolCalls: 1 });
    const result = await runner.run({
      messages: [],
      userMessage: { role: "user", content: "two tools" },
      model,
      tools,
      permissions: { mode: "default", allowlist: [] },
      onEvent: () => undefined,
    });

    expect(secondTurnToolIds.sort()).toEqual(["call_a", "call_b"]);
    const toolMsgs = result.messages.filter((m) => m.role === "tool");
    expect(toolMsgs.map((m) => (m.role === "tool" ? m.toolCallId : ""))).toEqual([
      "call_a",
      "call_b",
    ]);
    const skipped = toolMsgs.find((m) => m.role === "tool" && m.toolCallId === "call_b");
    expect(skipped?.role === "tool" && skipped.content).toMatch(/limit exceeded/i);
    expect(result.reason).toBe("completed");
  });

  it("ends stopped when tool execute throws AbortError", async () => {
    const events: RunnerEvent[] = [];
    let modelCalls = 0;
    const model: ModelPort = {
      id: "mock",
      async *stream() {
        modelCalls += 1;
        if (modelCalls === 1) {
          yield {
            type: "tool_call",
            id: "call_abort_tool",
            name: "abort_me",
            arguments: {},
          };
          return;
        }
        yield { type: "text_delta", text: "should not happen" };
      },
    };

    const tools = new ToolRegistry();
    tools.register(
      {
        name: "abort_me",
        description: "Throws AbortError",
        parameters: { type: "object" },
      },
      async () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      },
    );

    const runner = new Runner({ maxTurns: 4 });
    const result = await runner.run({
      messages: [],
      userMessage: { role: "user", content: "abort tool" },
      model,
      tools,
      permissions: { mode: "default", allowlist: [] },
      onEvent: (e) => events.push(e),
    });

    expect(modelCalls).toBe(1);
    expect(result.reason).toBe("stopped");
    const end = lastEvent(events);
    expect(end?.type === "run_end" && end.reason).toBe("stopped");

    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.role === "tool" && toolMsg.toolCallId).toBe("call_abort_tool");
    expect(toolMsg?.role === "tool" && toolMsg.content).toMatch(/cancelled/i);
    expect(toolMsg?.role === "tool" && toolMsg.content).not.toMatch(/aborted/i);
  });
});
