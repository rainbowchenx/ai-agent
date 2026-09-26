# @agent2026/mcp

Official MCP Client adapters that expose MCP tools as `ToolPort`.

## Boundary

- **Only** this package depends on `@modelcontextprotocol/sdk`.
- `packages/core` must never import the SDK.
- Server-side lifecycle (`McpSupervisor`) lives in `@agent2026/server` and calls this package.

## Namespace

Tool names are exposed as `{serverName}__{originalToolName}` so multiple servers and builtins do not collide.

## Transports

### stdio

Uses SDK `StdioClientTransport` (`@modelcontextprotocol/sdk/client/stdio.js`).

```ts
import { createStdioMcpSession } from "@agent2026/mcp";

const session = await createStdioMcpSession({
  name: "filesystem",
  command: "npx",
  args: [
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "/path/to/workspace",
  ],
});

const port = session.asToolPort(); // tools like filesystem__read_file
```

### HTTP

Default: SDK `StreamableHTTPClientTransport`. Optional `httpSubtype: "sse"` uses `SSEClientTransport`. When subtype is `streamable` (default), initialize failure may fall back to SSE.

```ts
import { createHttpMcpSession } from "@agent2026/mcp";

const session = await createHttpMcpSession({
  name: "openviking",
  url: "http://localhost:1933/mcp",
  headers: { Authorization: "Bearer …" }, // optional; prefer credentials refs in product config
  httpSubtype: "streamable",
});
```

## CI fixtures

- In-memory echo client: `src/test/mock-mcp.ts` (`createMockEchoClient`)
- Streamable HTTP mock: `startMockHttpMcpServer()` (no OpenViking in CI)

## SDK classes (locked)

| Role | Class | Import |
|------|-------|--------|
| Client | `Client` | `@modelcontextprotocol/sdk/client/index.js` |
| stdio | `StdioClientTransport` | `@modelcontextprotocol/sdk/client/stdio.js` |
| HTTP (default) | `StreamableHTTPClientTransport` | `@modelcontextprotocol/sdk/client/streamableHttp.js` |
| HTTP (SSE) | `SSEClientTransport` | `@modelcontextprotocol/sdk/client/sse.js` |

Pinned: `@modelcontextprotocol/sdk@1.30.1`
