export type RunEvent =
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
  | {
      type: "run_end";
      runId: string;
      reason: "completed" | "stopped" | "error";
    };

export type RunEndReason = Extract<RunEvent, { type: "run_end" }>["reason"];
