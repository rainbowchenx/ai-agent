import type { ToolDefinition, ToolExecutionContext, ToolPort } from "@agent2026/core";
import { prefixToolName, stripToolPrefix } from "./namespace.js";
import type {
  McpClientLike,
  McpServerSession,
  McpSessionStatus,
} from "./types.js";

function toolResultToString(result: {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}): string {
  const parts = (result.content ?? []).map((block) => {
    if (block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
    return JSON.stringify(block);
  });
  const text = parts.join("\n");
  if (result.isError) {
    return text || "MCP tool error";
  }
  return text;
}

function toToolDefinition(
  serverName: string,
  tool: {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  },
): ToolDefinition {
  return {
    name: prefixToolName(serverName, tool.name),
    description: tool.description ?? "",
    parameters: tool.inputSchema ?? { type: "object", properties: {} },
  };
}

export type MutableMcpSession = McpServerSession & {
  setStatus(status: McpSessionStatus, lastError?: string): void;
  bindClient(client: McpClientLike): Promise<void>;
};

export function createMutableMcpSession(name: string): MutableMcpSession {
  let status: McpSessionStatus = "connecting";
  let lastError: string | undefined;
  let tools: ToolDefinition[] = [];
  let client: McpClientLike | undefined;

  const session: MutableMcpSession = {
    get name() {
      return name;
    },
    get status() {
      return status;
    },
    get lastError() {
      return lastError;
    },
    get tools() {
      return tools;
    },
    setStatus(next, error) {
      status = next;
      lastError = error;
      if (next !== "ready") {
        // keep tools for UI until cleared on close/disabled
      }
    },
    async bindClient(nextClient) {
      client = nextClient;
      await session.refreshTools();
      status = "ready";
      lastError = undefined;
    },
    async refreshTools() {
      if (!client) {
        throw new Error(`MCP session "${name}" has no client`);
      }
      const listed = await client.listTools();
      tools = listed.tools.map((tool) => toToolDefinition(name, tool));
    },
    asToolPort(): ToolPort {
      return {
        list: () => tools,
        execute: async (
          toolName: string,
          args: Record<string, unknown>,
          _ctx: ToolExecutionContext,
        ) => {
          if (!client || status !== "ready") {
            throw new Error(
              `MCP session "${name}" is not ready (status=${status})`,
            );
          }
          const original = stripToolPrefix(name, toolName);
          if (original === null) {
            throw new Error(`Unknown tool: ${toolName}`);
          }
          const result = await client.callTool({
            name: original,
            arguments: args,
          });
          return toolResultToString(result);
        },
      };
    },
    async close() {
      const current = client;
      client = undefined;
      tools = [];
      status = "closed";
      if (current) {
        await current.close().catch(() => undefined);
      }
    },
  };

  return session;
}
