import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ServerManager, findRepoRoot } from "./server-manager.js";

const PORT = 18787;

describe("ServerManager live spawn", () => {
  const userData = mkdtempSync(join(tmpdir(), "agent2026-live-"));
  const manager = new ServerManager({
    userDataDir: userData,
    repoRoot: findRepoRoot(process.cwd()),
    isDev: true,
    port: PORT,
    waitTimeoutMs: 30_000,
  });

  afterAll(async () => {
    await manager.stop();
  });

  it("spawns the agent server and /health succeeds without a pre-started process", async () => {
    const state = await manager.start();
    expect(state.reused).toBe(false);
    expect(state.baseUrl).toBe(`http://127.0.0.1:${PORT}`);
    const res = await fetch(`${state.baseUrl}/health`);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  }, 35_000);
});
