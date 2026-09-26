import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMutableMcpSession } from "./session-from-client.js";
import type { McpClientLike, McpServerSession } from "./types.js";

export type CreateStdioMcpSessionOptions = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string | null;
  /** Test hook: skip spawn and use a provided connected client. */
  connectClient?: () => Promise<McpClientLike>;
};

export async function createStdioMcpSession(
  options: CreateStdioMcpSessionOptions,
): Promise<McpServerSession> {
  const session = createMutableMcpSession(options.name);
  try {
    const client = options.connectClient
      ? await options.connectClient()
      : await connectStdioClient(options);
    await session.bindClient(client);
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    session.setStatus("error", message);
    return session;
  }
}

async function connectStdioClient(
  options: CreateStdioMcpSessionOptions,
): Promise<McpClientLike> {
  const transport = new StdioClientTransport({
    command: options.command,
    args: options.args,
    env: options.env,
    cwd: options.cwd ?? undefined,
  });
  const client = new Client({
    name: `agent2026-mcp-${options.name}`,
    version: "0.0.0",
  });
  await client.connect(transport);
  return client as unknown as McpClientLike;
}
