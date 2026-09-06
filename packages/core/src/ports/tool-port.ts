import type { ToolDefinition } from "../types/messages.js";

export interface ToolExecutionContext {
  sessionId: string;
  runId: string;
  signal?: AbortSignal;
}

export interface ToolPort {
  list(): ToolDefinition[];
  execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<string>;
}
