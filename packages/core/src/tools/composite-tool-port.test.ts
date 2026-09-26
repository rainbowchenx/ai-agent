import { describe, expect, it } from "vitest";
import type { ToolPort } from "../ports/tool-port.js";
import { createCompositeToolPort } from "./composite-tool-port.js";

function fakePort(
  tools: Array<{ name: string; result?: string }>,
): ToolPort {
  return {
    list: () =>
      tools.map((tool) => ({
        name: tool.name,
        description: tool.name,
        parameters: { type: "object", properties: {} },
      })),
    execute: async (name) => {
      const tool = tools.find((entry) => entry.name === name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return tool.result ?? `ok:${name}`;
    },
  };
}

describe("createCompositeToolPort", () => {
  it("merges list and routes execute", async () => {
    const composite = createCompositeToolPort([
      fakePort([{ name: "read_file", result: "file" }]),
      fakePort([{ name: "svc__echo", result: "echoed" }]),
    ]);

    expect(composite.list().map((tool) => tool.name)).toEqual([
      "read_file",
      "svc__echo",
    ]);
    expect(
      await composite.execute("svc__echo", {}, { sessionId: "s", runId: "r" }),
    ).toBe("echoed");
    expect(
      await composite.execute("read_file", {}, { sessionId: "s", runId: "r" }),
    ).toBe("file");
  });

  it("throws on duplicate tool names", () => {
    expect(() =>
      createCompositeToolPort([
        fakePort([{ name: "dup" }]),
        fakePort([{ name: "dup" }]),
      ]),
    ).toThrow(/Duplicate tool name/);
  });

  it("throws when executing unknown tool", async () => {
    const composite = createCompositeToolPort([fakePort([{ name: "a" }])]);
    await expect(
      composite.execute("missing", {}, { sessionId: "s", runId: "r" }),
    ).rejects.toThrow(/Unknown tool/);
  });
});
