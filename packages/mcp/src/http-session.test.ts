import { afterEach, describe, expect, it } from "vitest";
import { createHttpMcpSession } from "./http-session.js";
import {
  createMockEchoClient,
  startMockHttpMcpServer,
} from "./test/mock-mcp.js";

describe("createHttpMcpSession", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (closers.length > 0) {
      const close = closers.pop();
      await close?.();
    }
  });

  it("lists namespaced tools via injected mock client", async () => {
    const mock = await createMockEchoClient();
    closers.push(mock.close);

    const session = await createHttpMcpSession({
      name: "httpdemo",
      url: "http://127.0.0.1:9/mcp",
      connectClient: async () => mock.client,
    });
    closers.push(() => session.close());

    expect(session.status).toBe("ready");
    expect(session.tools[0]?.name).toBe("httpdemo__echo");
    const result = await session
      .asToolPort()
      .execute(
        "httpdemo__echo",
        { text: "via-http" },
        { sessionId: "s", runId: "r" },
      );
    expect(result).toBe("via-http");
  });

  it("connects to streamable HTTP mock fixture", async () => {
    const fixture = await startMockHttpMcpServer();
    closers.push(fixture.close);

    const session = await createHttpMcpSession({
      name: "fixture",
      url: fixture.url,
      httpSubtype: "streamable",
      fallbackToSse: false,
    });
    closers.push(() => session.close());

    expect(session.status).toBe("ready");
    expect(session.tools.map((tool) => tool.name)).toContain("fixture__echo");

    const result = await session
      .asToolPort()
      .execute(
        "fixture__echo",
        { text: "streamable" },
        { sessionId: "s", runId: "r" },
      );
    expect(result).toBe("streamable");
  });
});
