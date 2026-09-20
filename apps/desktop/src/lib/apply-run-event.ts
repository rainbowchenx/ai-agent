import type { MessageDto, RunEvent } from "@agent2026/shared";
import { applyTraceEvent, type TraceNode } from "./trace-nodes.js";

export type ChatItem =
  | { kind: "user"; id: string; content: string }
  | { kind: "assistant"; id: string; content: string; streaming: boolean }
  | {
      kind: "tool";
      id: string;
      toolCallId: string;
      name: string;
      arguments?: unknown;
      result?: string;
      isError?: boolean;
      status: "running" | "done";
    }
  | { kind: "error"; id: string; message: string }
  | {
      kind: "permission";
      id: string;
      requestId: string;
      toolName: string;
      arguments?: unknown;
      status: "pending" | "allowed" | "session_allowed" | "denied" | "expired";
    };

export type PermissionResolveStatus = "allowed" | "session_allowed" | "denied";

export type RunStatus = "idle" | "running" | "completed" | "stopped" | "error";

export type RunProjection = {
  items: ChatItem[];
  runId: string | null;
  sessionId: string | null;
  traceId: string | null;
  status: RunStatus;
  traceNodes: TraceNode[];
};

export function emptyProjection(): RunProjection {
  return {
    items: [],
    runId: null,
    sessionId: null,
    traceId: null,
    status: "idle",
    traceNodes: [],
  };
}

export function shouldApplyRunEvent(
  projection: RunProjection,
  event: RunEvent,
  selectedSessionId: string | null,
): boolean {
  if (!selectedSessionId) {
    return false;
  }
  if (event.type === "run_start") {
    return event.sessionId === selectedSessionId;
  }
  if (projection.status !== "running") {
    return false;
  }
  if (projection.sessionId !== selectedSessionId) {
    return false;
  }
  return projection.runId !== null && event.runId === projection.runId;
}

export function applyRunEvent(
  state: RunProjection,
  event: RunEvent,
): RunProjection {
  const next: RunProjection = {
    ...state,
    items: state.items.slice(),
    traceNodes:
      event.type === "run_start"
        ? applyTraceEvent([], event)
        : applyTraceEvent(state.traceNodes, event),
  };

  switch (event.type) {
    case "run_start":
      next.runId = event.runId;
      next.sessionId = event.sessionId;
      next.traceId = event.traceId;
      next.status = "running";
      return next;
    case "message_delta": {
      const last = next.items[next.items.length - 1];
      if (last?.kind === "assistant" && last.streaming) {
        next.items[next.items.length - 1] = {
          ...last,
          content: last.content + event.delta,
        };
      } else {
        next.items.push({
          kind: "assistant",
          id: `delta-${event.runId}-${next.items.length}`,
          content: event.delta,
          streaming: true,
        });
      }
      return next;
    }
    case "tool_start":
      finalizeStreaming(next.items);
      next.items.push({
        kind: "tool",
        id: event.toolCallId,
        toolCallId: event.toolCallId,
        name: event.name,
        arguments: event.arguments,
        status: "running",
      });
      return next;
    case "tool_end": {
      const index = next.items.findIndex(
        (item) => item.kind === "tool" && item.toolCallId === event.toolCallId,
      );
      if (index >= 0 && next.items[index]?.kind === "tool") {
        const current = next.items[index];
        next.items[index] = {
          ...current,
          name: event.name || current.name,
          result: event.result,
          isError: event.isError,
          status: "done",
        };
      } else {
        next.items.push({
          kind: "tool",
          id: event.toolCallId,
          toolCallId: event.toolCallId,
          name: event.name,
          result: event.result,
          isError: event.isError,
          status: "done",
        });
      }
      return next;
    }
    case "permission_request":
      next.items.push({
        kind: "permission",
        id: event.requestId,
        requestId: event.requestId,
        toolName: event.toolName,
        arguments: event.arguments,
        status: "pending",
      });
      return next;
    case "error":
      finalizeStreaming(next.items);
      next.items.push({
        kind: "error",
        id: `err-${event.runId}-${next.items.length}`,
        message: event.message,
      });
      return next;
    case "run_end":
      finalizeStreaming(next.items);
      next.status = event.reason;
      if (!next.runId) {
        next.runId = event.runId;
      }
      expirePendingPermissions(next.items);
      return next;
  }
}

export function resolvePermissionLocally(
  state: RunProjection,
  requestId: string,
  status: PermissionResolveStatus,
): RunProjection {
  return {
    ...state,
    items: state.items.map((item) =>
      item.kind === "permission" && item.requestId === requestId
        ? { ...item, status }
        : item,
    ),
  };
}

export function appendUserMessage(
  state: RunProjection,
  content: string,
  id = crypto.randomUUID(),
): RunProjection {
  return {
    ...state,
    items: [...state.items, { kind: "user", id, content }],
  };
}

export function messagesToChatItems(messages: MessageDto[]): ChatItem[] {
  const items: ChatItem[] = [];
  const pendingToolIds: string[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      items.push({ kind: "user", id: message.id, content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const calls = parseToolCalls(message.content);
      if (calls) {
        for (const call of calls) {
          const toolCallId = call.id || message.id;
          items.push({
            kind: "tool",
            id: toolCallId,
            toolCallId,
            name: call.name || "tool",
            arguments: call.arguments,
            status: "done",
          });
          pendingToolIds.push(toolCallId);
        }
        continue;
      }
      items.push({
        kind: "assistant",
        id: message.id,
        content: message.content,
        streaming: false,
      });
      continue;
    }
    if (message.role === "tool") {
      const pendingId = pendingToolIds.shift();
      const index = pendingId
        ? items.findIndex(
            (item) => item.kind === "tool" && item.toolCallId === pendingId,
          )
        : -1;
      if (index >= 0 && items[index]?.kind === "tool") {
        items[index] = { ...items[index], result: message.content, status: "done" };
      } else {
        items.push({
          kind: "tool",
          id: message.id,
          toolCallId: message.id,
          name: "tool",
          result: message.content,
          status: "done",
        });
      }
    }
  }

  return items;
}

export function projectionFromMessages(
  sessionId: string,
  messages: MessageDto[],
): RunProjection {
  return {
    ...emptyProjection(),
    sessionId,
    items: messagesToChatItems(messages),
  };
}

type StoredToolCall = {
  id?: string;
  name?: string;
  arguments?: unknown;
};

function parseToolCalls(content: string): StoredToolCall[] | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("[")) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    if (
      !parsed.every(
        (item) =>
          item &&
          typeof item === "object" &&
          ("name" in item || "id" in item),
      )
    ) {
      return null;
    }
    return parsed as StoredToolCall[];
  } catch {
    return null;
  }
}

function finalizeStreaming(items: ChatItem[]): void {
  const last = items[items.length - 1];
  if (last?.kind === "assistant" && last.streaming) {
    items[items.length - 1] = { ...last, streaming: false };
  }
}

function expirePendingPermissions(items: ChatItem[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item?.kind === "permission" && item.status === "pending") {
      items[i] = { ...item, status: "expired" };
    }
  }
}
