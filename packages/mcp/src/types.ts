import type { ToolDefinition, ToolPort } from "@agent2026/core";

export type McpSessionStatus =
  | "connecting"
  | "ready"
  | "error"
  | "closed"
  | "disabled";

export type McpClientLike = {
  listTools(): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
  }>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{
    content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
    isError?: boolean;
  }>;
  close(): Promise<void>;
};

export type McpServerSession = {
  readonly name: string;
  readonly status: McpSessionStatus;
  readonly lastError?: string;
  readonly tools: ToolDefinition[];
  asToolPort(): ToolPort;
  refreshTools(): Promise<void>;
  close(): Promise<void>;
};
