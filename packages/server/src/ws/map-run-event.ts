import type { RunnerEvent } from "@agent2026/core";
import type { RunEvent } from "@agent2026/shared";

/** Map core Runner events onto the shared WS contract. Never drop runId / toolCallId. */
export function toRunEvent(event: RunnerEvent): RunEvent {
  switch (event.type) {
    case "run_start":
      return {
        type: "run_start",
        runId: event.runId,
        sessionId: event.sessionId,
        traceId: event.traceId,
      };
    case "message_delta":
      return {
        type: "message_delta",
        runId: event.runId,
        delta: event.delta,
      };
    case "tool_start":
      return {
        type: "tool_start",
        runId: event.runId,
        toolCallId: event.toolCallId,
        name: event.name,
        arguments: event.arguments,
      };
    case "tool_end":
      return {
        type: "tool_end",
        runId: event.runId,
        toolCallId: event.toolCallId,
        name: event.name,
        result: event.result,
        ...(event.isError !== undefined ? { isError: event.isError } : {}),
      };
    case "permission_request":
      return {
        type: "permission_request",
        runId: event.runId,
        requestId: event.requestId,
        toolName: event.toolName,
        arguments: event.arguments,
      };
    case "error":
      return {
        type: "error",
        runId: event.runId,
        message: event.message,
      };
    case "run_end":
      return {
        type: "run_end",
        runId: event.runId,
        reason: event.reason,
      };
  }
}
