import { createServer, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { McpClientLike } from "../types.js";

/** In-process mock MCP client with an echo tool (no network / no spawn). */
export async function createMockEchoClient(): Promise<{
  client: McpClientLike;
  close: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "mock-echo", version: "0.0.0" });
  server.registerTool(
    "echo",
    {
      description: "Echo text back",
      inputSchema: {
        text: z.string(),
      },
    },
    async ({ text }) => ({
      content: [{ type: "text", text }],
    }),
  );

  const client = new Client({ name: "mock-client", version: "0.0.0" });
  await server.server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client: client as unknown as McpClientLike,
    close: async () => {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}

export type MockHttpMcpServer = {
  url: string;
  close: () => Promise<void>;
};

/**
 * Lightweight Streamable HTTP MCP fixture for CI (echo tool).
 */
export async function startMockHttpMcpServer(): Promise<MockHttpMcpServer> {
  const mcp = new McpServer({ name: "mock-http-echo", version: "0.0.0" });
  mcp.registerTool(
    "echo",
    {
      description: "Echo text back over HTTP",
      inputSchema: {
        text: z.string(),
      },
    },
    async ({ text }) => ({
      content: [{ type: "text", text }],
    }),
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  await mcp.server.connect(transport);

  const server: Server = createServer((req, res) => {
    void transport.handleRequest(req, res).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock HTTP MCP server");
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      await transport.close().catch(() => undefined);
      await mcp.close().catch(() => undefined);
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
