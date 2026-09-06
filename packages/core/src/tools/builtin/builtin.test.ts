import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBuiltinToolPort } from "./index.js";

const ctx = { sessionId: "s1", runId: "r1" };

describe("read_file", () => {
  let workspaceRoot = "";

  afterEach(async () => {
    workspaceRoot = "";
  });

  it("reads file content under workspaceRoot", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "read-file-"));
    await writeFile(join(workspaceRoot, "hello.txt"), "hello world", "utf8");

    const tools = createBuiltinToolPort(["read_file"], { workspaceRoot });
    const content = await tools.execute(
      "read_file",
      { path: "hello.txt" },
      ctx,
    );

    expect(content).toBe("hello world");
  });

  it("rejects path traversal with ../", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "read-file-"));

    const tools = createBuiltinToolPort(["read_file"], { workspaceRoot });

    await expect(
      tools.execute("read_file", { path: "../secret.txt" }, ctx),
    ).rejects.toThrow(/path traversal|outside workspace/i);
  });
});

describe("http_fetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects non-http(s) URLs", async () => {
    const tools = createBuiltinToolPort(["http_fetch"], {
      workspaceRoot: "/tmp",
    });

    await expect(
      tools.execute("http_fetch", { url: "file:///etc/passwd" }, ctx),
    ).rejects.toThrow(/http/i);
  });

  it("returns truncated body from mocked fetch", async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => "abcdefghijklmnop",
    }));

    const tools = createBuiltinToolPort(["http_fetch"], {
      workspaceRoot: "/tmp",
      fetch: mockFetch as typeof fetch,
    });

    const result = await tools.execute(
      "http_fetch",
      { url: "https://example.com", maxChars: 5 },
      ctx,
    );

    expect(result).toContain("abcde");
    expect(result).not.toContain("fghij");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("times out slow responses", async () => {
    const mockFetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const tools = createBuiltinToolPort(["http_fetch"], {
      workspaceRoot: "/tmp",
      fetchTimeoutMs: 50,
      fetch: mockFetch as typeof fetch,
    });

    await expect(
      tools.execute(
        "http_fetch",
        { url: "https://slow.example", timeoutMs: 50 },
        ctx,
      ),
    ).rejects.toThrow(/timed out/i);
  });
});

describe("createBuiltinToolPort", () => {
  it("lists only requested tools", () => {
    const tools = createBuiltinToolPort(["read_file"], {
      workspaceRoot: "/tmp",
    });

    expect(tools.list().map((t) => t.name)).toEqual(["read_file"]);
  });
});
