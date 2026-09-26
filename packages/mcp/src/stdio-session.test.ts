import { afterEach, describe, expect, it } from "vitest";
import { createStdioMcpSession } from "./stdio-session.js";
import { createMockEchoClient } from "./test/mock-mcp.js";

describe("createStdioMcpSession", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (closers.length > 0) {
      const close = closers.pop();
      await close?.();
    }
  });

  it("lists namespaced tools and executes after stripping prefix", async () => {
    const mock = await createMockEchoClient();
    closers.push(mock.close);

    const session = await createStdioMcpSession({
      name: "demo",
      command: "unused",
      args: [],
      connectClient: async () => mock.client,
    });
    closers.push(() => session.close());

    expect(session.status).toBe("ready");
    expect(session.tools.map((tool) => tool.name)).toEqual(["demo__echo"]);

    const port = session.asToolPort();
    const result = await port.execute(
      "demo__echo",
      { text: "hello" },
      { sessionId: "s", runId: "r" },
    );
    expect(result).toBe("hello");
  });

  it("marks error status when connect fails", async () => {
    const session = await createStdioMcpSession({
      name: "broken",
      command: "unused",
      args: [],
      connectClient: async () => {
        throw new Error("spawn failed");
      },
    });
    closers.push(() => session.close());
    expect(session.status).toBe("error");
    expect(session.lastError).toMatch(/spawn failed/);
  });
});
