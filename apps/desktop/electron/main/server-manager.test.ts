import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  ServerManager,
  findRepoRoot,
  healthUrl,
  killProcessTree,
  resolveSpawnPlan,
  writeServerState,
} from "./server-manager.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("healthUrl", () => {
  it("points at the local health endpoint", () => {
    expect(healthUrl(DEFAULT_HOST, DEFAULT_PORT)).toBe(
      "http://127.0.0.1:9800/health",
    );
  });
});

describe("findRepoRoot", () => {
  it("walks up until pnpm-workspace.yaml", () => {
    const root = tempDir("agent2026-root-");
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const nested = join(root, "apps", "desktop");
    mkdirSync(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBe(root);
  });
});

describe("writeServerState", () => {
  it("writes port and baseUrl to userData/server.json", () => {
    const userData = tempDir("agent2026-ud-");
    writeServerState(userData, {
      host: DEFAULT_HOST,
      port: 9800,
      baseUrl: "http://127.0.0.1:9800",
      reused: true,
    });
    const raw = JSON.parse(readFileSync(join(userData, "server.json"), "utf8"));
    expect(raw.port).toBe(9800);
    expect(raw.baseUrl).toBe("http://127.0.0.1:9800");
  });
});

describe("resolveSpawnPlan", () => {
  it("reuses 9800 in DEV when health already succeeds", () => {
    const plan = resolveSpawnPlan({
      isDev: true,
      repoRoot: "/repo",
      existingHealthy: true,
    });
    expect(plan).toEqual({
      kind: "reuse",
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
    });
  });

  it("spawns pnpm+tsx in DEV when nothing is listening", () => {
    const plan = resolveSpawnPlan({
      isDev: true,
      repoRoot: "/repo",
      existingHealthy: false,
    });
    expect(plan.kind).toBe("spawn");
    if (plan.kind !== "spawn") return;
    expect(plan.cwd).toBe("/repo");
    expect(plan.args).toEqual([
      "--filter",
      "@agent2026/server",
      "exec",
      "tsx",
      "src/index.ts",
    ]);
    expect(plan.command).toMatch(/pnpm/);
  });

  it("spawns node on server dist in PROD when the file exists", () => {
    const dist = join("/repo", "packages", "server", "dist", "index.js");
    const plan = resolveSpawnPlan({
      isDev: false,
      repoRoot: "/repo",
      existingHealthy: false,
      serverDistEntry: dist,
    });
    expect(plan).toMatchObject({
      kind: "spawn",
      args: [dist],
    });
    if (plan.kind !== "spawn") return;
    expect(plan.command).not.toMatch(/pnpm/);
  });

  it("falls back to pnpm+tsx in PROD when dist is missing", () => {
    const plan = resolveSpawnPlan({
      isDev: false,
      repoRoot: "/repo",
      existingHealthy: false,
    });
    expect(plan.kind).toBe("spawn");
    if (plan.kind !== "spawn") return;
    expect(plan.args).toContain("tsx");
  });
});

describe("killProcessTree", () => {
  it("uses taskkill /T on Windows and SIGTERM elsewhere", async () => {
    const spawned: Array<{ command: string; args: string[] }> = [];
    const spawnImpl = ((command: string, args: string[]) => {
      spawned.push({ command, args });
      return {
        once: (event: string, cb: () => void) => {
          if (event === "exit") queueMicrotask(cb);
        },
      };
    }) as unknown as typeof import("node:child_process").spawn;

    await killProcessTree(4242, spawnImpl);

    if (process.platform === "win32") {
      expect(spawned[0]?.command).toBe("taskkill");
      expect(spawned[0]?.args).toEqual(["/PID", "4242", "/T", "/F"]);
    } else {
      expect(spawned).toHaveLength(0);
    }
  });
});

describe("ServerManager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects to an already-healthy DEV server and does not spawn", async () => {
    const userData = tempDir("agent2026-mgr-");
    const spawnImpl = vi.fn();
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, version: "0.0.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const manager = new ServerManager({
      userDataDir: userData,
      repoRoot: "/repo",
      isDev: true,
      fetchImpl,
      spawnImpl,
    });

    const state = await manager.start();
    expect(state.reused).toBe(true);
    expect(state.baseUrl).toBe("http://127.0.0.1:9800");
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(manager.getBaseUrl()).toBe("http://127.0.0.1:9800");
    const saved = JSON.parse(readFileSync(join(userData, "server.json"), "utf8"));
    expect(saved.port).toBe(9800);
  });

  it("spawns the server and waits until /health is ok", async () => {
    const userData = tempDir("agent2026-mgr2-");
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("not ready");
      return new Response(JSON.stringify({ ok: true, version: "0.0.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const child = { pid: 99, on: vi.fn() };
    const spawnImpl = vi.fn(() => child);

    const manager = new ServerManager({
      userDataDir: userData,
      repoRoot: "/repo",
      isDev: true,
      fetchImpl,
      spawnImpl: spawnImpl as unknown as typeof import("node:child_process").spawn,
      waitTimeoutMs: 2000,
      pollIntervalMs: 1,
    });

    const state = await manager.start();
    expect(state.reused).toBe(false);
    expect(state.pid).toBe(99);
    expect(spawnImpl).toHaveBeenCalledOnce();
    const saved = JSON.parse(readFileSync(join(userData, "server.json"), "utf8"));
    expect(saved.baseUrl).toBe("http://127.0.0.1:9800");
  });
});
