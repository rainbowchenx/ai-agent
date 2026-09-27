import { describe, expect, it, vi } from "vitest";
import type { ToolPort } from "@agent2026/core";
import type { MemoryItem } from "@agent2026/shared";
import {
  memoryItemToMarkdown,
  memoryWriteUri,
  writeFrozenMemory,
} from "./write-openviking.js";

const frozenItem = (): MemoryItem => ({
  kind: "preference",
  when: "user asks for package manager",
  do: "default to pnpm for installs",
  outcome: "user said prefer pnpm",
  confidence: 0.8,
  status: "frozen",
  sourceRunId: "run-abc",
  sourceSessionId: "sess-1",
  sourceTraceId: "trace-1",
});

const ALLOWED = new Set(["openviking__write", "openviking__remember"]);

function mockPort(
  execute: ToolPort["execute"],
): ToolPort {
  return {
    list: () => [],
    execute: async (name, args, ctx) => {
      if (!ALLOWED.has(name)) {
        throw new Error(`unexpected tool call: ${name}`);
      }
      return execute(name, args, ctx);
    },
  };
}

describe("memoryWriteUri", () => {
  it("builds UTC date path with runId and index", () => {
    const uri = memoryWriteUri("run-abc", 2, new Date("2026-09-27T15:30:00Z"));
    expect(uri).toBe(
      "viking://~/memories/agent2026/2026-09-27/run-abc-2.md",
    );
  });
});

describe("memoryItemToMarkdown", () => {
  it("includes YAML front matter and when/do/outcome body", () => {
    const md = memoryItemToMarkdown(frozenItem());
    expect(md).toContain("---");
    expect(md).toContain("kind: preference");
    expect(md).toContain("status: frozen");
    expect(md).toContain("confidence: 0.8");
    expect(md).toContain("sourceRunId: run-abc");
    expect(md).toContain("sourceSessionId: sess-1");
    expect(md).toContain("sourceTraceId: trace-1");
    expect(md).toMatch(/##\s*when/i);
    expect(md).toContain("user asks for package manager");
    expect(md).toContain("default to pnpm for installs");
    expect(md).toContain("user said prefer pnpm");
  });
});

describe("writeFrozenMemory", () => {
  it("calls only openviking__write on success with expected uri", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const port = mockPort(async (name, args) => {
      calls.push({ name, args });
      return "ok";
    });

    const result = await writeFrozenMemory({
      port,
      item: frozenItem(),
      index: 0,
      ctx: { sessionId: "sess-1", runId: "run-abc" },
    });

    expect(result).toEqual({ ok: true, via: "write" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("openviking__write");
    expect(calls[0]!.args.uri).toEqual(
      expect.stringContaining("viking://~/memories/agent2026/"),
    );
    expect(calls[0]!.args.uri).toEqual(expect.stringContaining("run-abc"));
    expect(calls[0]!.args.mode).toBe("replace");
    expect(typeof calls[0]!.args.content).toBe("string");
  });

  it("falls back to openviking__remember when write throws", async () => {
    const calls: string[] = [];
    const port = mockPort(async (name, args) => {
      calls.push(name);
      if (name === "openviking__write") {
        throw new Error("write failed");
      }
      expect(args).toEqual({
        messages: [
          {
            role: "user",
            content: expect.any(String),
          },
        ],
      });
      return "remembered";
    });

    const result = await writeFrozenMemory({
      port,
      item: frozenItem(),
      index: 1,
      ctx: { sessionId: "sess-1", runId: "run-abc" },
    });

    expect(result).toEqual({ ok: true, via: "remember" });
    expect(calls).toEqual(["openviking__write", "openviking__remember"]);
  });

  it("returns ok false when both write and remember fail", async () => {
    const port = mockPort(async () => {
      throw new Error("ov down");
    });

    const result = await writeFrozenMemory({
      port,
      item: frozenItem(),
      index: 0,
      ctx: { sessionId: "sess-1", runId: "run-abc" },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ov down/i);
  });

  it("never calls tools outside the whitelist", async () => {
    const execute = vi.fn(async (name: string) => {
      if (!ALLOWED.has(name)) {
        throw new Error(`unexpected tool call: ${name}`);
      }
      return "ok";
    });
    const port: ToolPort = {
      list: () => [
        { name: "openviking__write" },
        { name: "openviking__remember" },
        { name: "openviking__forget" },
        { name: "openviking__find" },
      ],
      execute,
    };

    await writeFrozenMemory({
      port,
      item: frozenItem(),
      index: 0,
      ctx: { sessionId: "sess-1", runId: "run-abc" },
    });

    for (const call of execute.mock.calls) {
      expect(ALLOWED.has(call[0] as string)).toBe(true);
    }
    expect(
      execute.mock.calls.some((c) => (c[0] as string) === "openviking__forget"),
    ).toBe(false);
  });
});
