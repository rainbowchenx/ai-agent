import type { AgentMessage, ToolDefinition } from "../types/messages.js";

export type ModelStreamEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | { type: "usage"; inputTokens?: number; outputTokens?: number };

export interface ModelPort {
  id: string;
  stream(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
    signal?: AbortSignal;
  }): AsyncIterable<ModelStreamEvent>;
}
