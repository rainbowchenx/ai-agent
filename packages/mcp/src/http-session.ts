import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMutableMcpSession } from "./session-from-client.js";
import type { McpClientLike, McpServerSession } from "./types.js";

export type HttpSubtype = "streamable" | "sse";

export type CreateHttpMcpSessionOptions = {
  name: string;
  url: string;
  headers?: Record<string, string>;
  httpSubtype?: HttpSubtype;
  /** When streamable fails, retry with SSE (default true if subtype is streamable). */
  fallbackToSse?: boolean;
  /** Test hook: skip network and use a provided connected client. */
  connectClient?: () => Promise<McpClientLike>;
};

export async function createHttpMcpSession(
  options: CreateHttpMcpSessionOptions,
): Promise<McpServerSession> {
  const session = createMutableMcpSession(options.name);
  try {
    const client = options.connectClient
      ? await options.connectClient()
      : await connectHttpClient(options);
    await session.bindClient(client);
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    session.setStatus("error", message);
    return session;
  }
}

async function connectHttpClient(
  options: CreateHttpMcpSessionOptions,
): Promise<McpClientLike> {
  const subtype = options.httpSubtype ?? "streamable";
  const url = new URL(options.url);
  const requestInit =
    options.headers && Object.keys(options.headers).length > 0
      ? { headers: options.headers }
      : undefined;

  if (subtype === "sse") {
    return connectWithTransport(
      options.name,
      new SSEClientTransport(url, { requestInit }),
    );
  }

  try {
    return await connectWithTransport(
      options.name,
      new StreamableHTTPClientTransport(url, { requestInit }),
    );
  } catch (error) {
    const allowFallback = options.fallbackToSse ?? true;
    if (!allowFallback) {
      throw error;
    }
    return connectWithTransport(
      options.name,
      new SSEClientTransport(url, { requestInit }),
    );
  }
}

async function connectWithTransport(
  name: string,
  transport: {
    start(): Promise<void>;
    close(): Promise<void>;
    send(message: unknown): Promise<void>;
  },
): Promise<McpClientLike> {
  const client = new Client({
    name: `agent2026-mcp-${name}`,
    version: "0.0.0",
  });
  // SDK Transport; cast keeps our surface free of SDK types in exports.
  await client.connect(transport as never);
  return client as unknown as McpClientLike;
}
