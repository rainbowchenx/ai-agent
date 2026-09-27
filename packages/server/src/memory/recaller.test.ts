import { describe, expect, it, vi } from "vitest";
import { defaultAppConfig, type AppConfig } from "@agent2026/shared";
import { createMemoryRecaller } from "./recaller.js";

function configWith(ov: Partial<NonNullable<AppConfig["openviking"]>>): AppConfig {
  const cfg = defaultAppConfig();
  return { ...cfg, openviking: { autoDistill: true, autoRecall: true, ...ov } };
}

function makeDeps(overrides: {
  config?: AppConfig;
  status?: { status: string; enabled: boolean };
  execute?: (name: string, args: Record<string, unknown>) => Promise<string>;
}) {
  const execute =
    overrides.execute ??
    (async () =>
      "---\nkind: preference\n---\n\n## do\n使用 pnpm\n\n## when\n装依赖\n");
  const port = { execute: vi.fn(execute) };
  return {
    getConfig: () => overrides.config ?? configWith({ autoRecall: true }),
    getOpenVikingStatus: () =>
      overrides.status ?? { status: "ready", enabled: true },
    getOpenVikingPort: () => port,
    port,
  };
}

describe("createMemoryRecaller", () => {
  it("skips when autoRecall is false", async () => {
    const deps = makeDeps({ config: configWith({ autoRecall: false }) });
    const r = createMemoryRecaller(deps);
    const block = await r.resolveForRun({
      sessionId: "s1",
      userText: "装依赖",
    });
    expect(block).toBe("");
    expect(deps.port.execute).not.toHaveBeenCalled();
  });

  it("skips when OV not ready", async () => {
    const deps = makeDeps({
      status: { status: "needs_config", enabled: true },
    });
    const r = createMemoryRecaller(deps);
    await r.resolveForRun({ sessionId: "s1", userText: "hi" });
    expect(deps.port.execute).not.toHaveBeenCalled();
  });

  it("fetches once then serves cache", async () => {
    const deps = makeDeps({});
    const r = createMemoryRecaller(deps);
    const a = await r.resolveForRun({ sessionId: "s1", userText: "装依赖" });
    const b = await r.resolveForRun({ sessionId: "s1", userText: "随便聊聊" });
    expect(a).toMatch(/pnpm/);
    expect(b).toBe(a);
    expect(deps.port.execute).toHaveBeenCalledTimes(1);
  });

  it("refreshes on cue phrase", async () => {
    let n = 0;
    const deps = makeDeps({
      execute: async () => {
        n += 1;
        return `---\nkind: preference\n---\n\n## do\nversion ${n}\n`;
      },
    });
    const r = createMemoryRecaller(deps);
    await r.resolveForRun({ sessionId: "s1", userText: "装依赖" });
    const second = await r.resolveForRun({
      sessionId: "s1",
      userText: "请记住我改用 yarn",
    });
    expect(second).toMatch(/version 2/);
    expect(deps.port.execute.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("forceRefresh bypasses cache", async () => {
    let n = 0;
    const deps = makeDeps({
      execute: async () => {
        n += 1;
        return `- item ${n}`;
      },
    });
    const r = createMemoryRecaller(deps);
    await r.resolveForRun({ sessionId: "s1", userText: "a" });
    const block = await r.resolveForRun({
      sessionId: "s1",
      userText: "b",
      forceRefresh: true,
    });
    expect(block).toMatch(/item 2/);
  });

  it("falls back to search when find empty/error", async () => {
    const deps = makeDeps({
      execute: async (name) => {
        if (name.endsWith("__find")) {
          return "Error executing tool find: 404";
        }
        return "- from search hit";
      },
    });
    const r = createMemoryRecaller(deps);
    const block = await r.resolveForRun({ sessionId: "s1", userText: "q" });
    expect(block).toMatch(/from search hit/);
    expect(r.getCache("s1")?.source).toBe("search");
  });

  it("refresh API path writes cache", async () => {
    const deps = makeDeps({});
    const r = createMemoryRecaller(deps);
    const entry = await r.refresh({ sessionId: "s9", query: "pnpm" });
    expect(entry.hitCount).toBeGreaterThan(0);
    expect(r.getCache("s9")?.block).toBe(entry.block);
  });
});
