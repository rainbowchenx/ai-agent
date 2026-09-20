import type { AgentMessage } from "../types/messages.js";
import type { ModelPort } from "../ports/model-port.js";
import type { ToolPort } from "../ports/tool-port.js";
import type {
  PermissionDecision,
  PermissionPolicy,
  PermissionRequest,
} from "../permissions/permission-gate.js";

export type RunnerEndReason = "completed" | "stopped" | "error";

/** Core-local run events; structurally mappable to shared `RunEvent`. */
export type RunnerEvent =
  | { type: "run_start"; runId: string; sessionId: string; traceId: string }
  | { type: "message_delta"; runId: string; delta: string }
  | {
      type: "tool_start";
      runId: string;
      toolCallId: string;
      name: string;
      arguments: unknown;
    }
  | {
      type: "tool_end";
      runId: string;
      toolCallId: string;
      name: string;
      result: string;
      isError?: boolean;
    }
  | {
      type: "permission_request";
      runId: string;
      requestId: string;
      toolName: string;
      arguments: unknown;
    }
  | { type: "error"; runId: string; message: string }
  | { type: "run_end"; runId: string; reason: RunnerEndReason };

export interface RunnerOptions {
  maxTurns: number;
  maxToolCalls?: number;
}

export interface RunnerRunInput {
  messages: AgentMessage[];
  userMessage: Extract<AgentMessage, { role: "user" }>;
  model: ModelPort;
  tools: ToolPort;
  permissions: PermissionPolicy;
  onEvent: (event: RunnerEvent) => void;
  onPermissionRequest?: (
    request: PermissionRequest,
  ) => Promise<PermissionDecision>;
  isPreAllowed?: (toolName: string) => boolean;
  signal?: AbortSignal;
  sessionId?: string;
  runId?: string;
  traceId?: string;
}

export interface RunnerRunResult {
  messages: AgentMessage[];
  runId: string;
  reason: RunnerEndReason;
}
