import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppConfig, type AppConfig } from "@agent2026/shared";
import { OPENVIKING_MCP_URL, OPENVIKING_SERVER_NAME } from "./constants.js";
import {
  createDefaultOpenVikingHealthCheck,
  createOpenVikingSupervisor,
  type ChildHandle,
  type OpenVikingDeps,
} from "./supervisor.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempPaths() {
  const root = mkdtempSync(join(tmpdir(), "ov-supervisor-"));
  tempDirs.push(root);
  return {
    rootDir: root,
    confPath: join(root, "ov.conf"),
    dataDir: join(root, "data"),
    runtimeProjectDir: join(root, "runtime"),
  };
}

function withEmbedding(config: AppConfig): AppConfig {
  return {
    ...config,
    openviking: {
      ...config.openviking,
      embedding: {
        baseUrl: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
        apiKeyEnv: "OPENVIKING_EMBEDDING_API_KEY",
      },
    },
  };
}

function baseConfig(enabled: boolean): AppConfig {
  const config = defaultAppConfig();
  if (enabled) {
    config.mcpServers = {
      [OPENVIKING_SERVER_NAME]: {
        transport: "http",
        url: OPENVIKING_MCP_URL,
        httpSubtype: "streamable",
        enabled: true,
      },
    };
    return withEmbedding(config);
  }
  return config;
}

function mockChild(): ChildHandle & { killed: boolean } {
  const handle = {
    pid: 4242,
    killed: false,
    async kill() {
      handle.killed = true;
    },
  };
  return handle;
}

type MockedDeps = OpenVikingDeps & {
  ensureRuntime: ReturnType<typeof vi.fn>;
  healthCheck: ReturnType<typeof vi.fn>;
  spawnServer: ReturnType<typeof vi.fn>;
  writeConfigPreset: ReturnType<typeof vi.fn>;
  resolveCredential: ReturnType<typeof vi.fn>;
};

function makeDeps(
  overrides: {
    paths?: OpenVikingDeps["paths"];
    readyTimeoutMs?: number;
    resolveCredential?: OpenVikingDeps["resolveCredential"];
    ensureRuntime?: OpenVikingDeps["ensureRuntime"];
    healthCheck?: OpenVikingDeps["healthCheck"];
    spawnServer?: OpenVikingDeps["spawnServer"];
    writeConfigPreset?: OpenVikingDeps["writeConfigPreset"];
  } = {},
): MockedDeps {
  return {
    paths: overrides.paths ?? tempPaths(),
    readyTimeoutMs: overrides.readyTimeoutMs ?? 500,
    resolveCredential: vi.fn(
      overrides.resolveCredential ?? ((_ref: string) => "sk-test"),
    ),
    ensureRuntime: vi.fn(
      overrides.ensureRuntime ?? (async () => undefined),
    ),
    healthCheck: vi.fn(overrides.healthCheck ?? (async () => false)),
    spawnServer: vi.fn(
      overrides.spawnServer ?? (async () => mockChild()),
    ),
    writeConfigPreset: vi.fn(
      overrides.writeConfigPreset ??
        ((_mutate: (c: AppConfig) => AppConfig) => undefined),
    ),
  };
}

describe("OpenVikingSupervisor", () => {
  it("disabled → stopped and does not call ensureRuntime", async () => {
    const deps = makeDeps();
    const supervisor = createOpenVikingSupervisor(deps);

    await supervisor.reconcile(baseConfig(false));

    expect(deps.ensureRuntime).not.toHaveBeenCalled();
    expect(deps.spawnServer).not.toHaveBeenCalled();
    expect(supervisor.getStatus()).toMatchObject({
      status: "stopped",
      enabled: false,
      ownedProcess: false,
      mcpUrl: OPENVIKING_MCP_URL,
    });
  });

  it("enabled + no embedding block → needs_config", async () => {
    const deps = makeDeps();
    const supervisor = createOpenVikingSupervisor(deps);
    const config = defaultAppConfig();
    config.mcpServers = {
      [OPENVIKING_SERVER_NAME]: {
        transport: "http",
        url: OPENVIKING_MCP_URL,
        httpSubtype: "streamable",
        enabled: true,
      },
    };

    await supervisor.reconcile(config);

    expect(deps.spawnServer).not.toHaveBeenCalled();
    expect(supervisor.getStatus()).toMatchObject({
      status: "needs_config",
      enabled: true,
    });
    expect(supervisor.getStatus().lastError).toMatch(/请配置独立 Embedding/);
  });

  it("enabled + no embedding key → needs_config", async () => {
    const deps = makeDeps({
      resolveCredential: (ref) =>
        ref === "OPENVIKING_EMBEDDING_API_KEY" ? undefined : "sk-chat",
    });
    const supervisor = createOpenVikingSupervisor(deps);

    await supervisor.reconcile(baseConfig(true));

    expect(deps.ensureRuntime).toHaveBeenCalledOnce();
    expect(deps.spawnServer).not.toHaveBeenCalled();
    expect(deps.writeConfigPreset).not.toHaveBeenCalled();
    expect(supervisor.getStatus()).toMatchObject({
      status: "needs_config",
      enabled: true,
    });
    expect(supervisor.getStatus().lastError).toMatch(/缺少 Embedding API Key/);
  });

  it("enabled + no chat key → needs_config", async () => {
    const deps = makeDeps({
      resolveCredential: (ref) =>
        ref === "OPENVIKING_EMBEDDING_API_KEY" ? "sk-emb" : undefined,
    });
    const supervisor = createOpenVikingSupervisor(deps);

    await supervisor.reconcile(baseConfig(true));

    expect(deps.spawnServer).not.toHaveBeenCalled();
    expect(supervisor.getStatus()).toMatchObject({
      status: "needs_config",
      enabled: true,
    });
    expect(supervisor.getStatus().lastError).toMatch(/缺少 Provider API Key/);
  });

  it("enabled + ensureRuntime throws → error (mentions uv)", async () => {
    const deps = makeDeps({
      ensureRuntime: async () => {
        throw new Error("uv: command not found");
      },
    });
    const supervisor = createOpenVikingSupervisor(deps);

    await supervisor.reconcile(baseConfig(true));

    expect(deps.spawnServer).not.toHaveBeenCalled();
    const view = supervisor.getStatus();
    expect(view.status).toBe("error");
    expect(view.enabled).toBe(true);
    expect(view.lastError).toMatch(/uv/i);
  });

  it("enabled + health already true → ready, ownedProcess false, writeConfigPreset", async () => {
    const deps = makeDeps({
      healthCheck: async () => true,
    });
    const supervisor = createOpenVikingSupervisor(deps);

    await supervisor.reconcile(baseConfig(true));

    expect(deps.spawnServer).not.toHaveBeenCalled();
    expect(deps.writeConfigPreset).toHaveBeenCalledOnce();
    const mutate = deps.writeConfigPreset.mock.calls[0]![0] as (
      c: AppConfig,
    ) => AppConfig;
    const next = mutate(baseConfig(true));
    expect(next.mcpServers?.openviking).toMatchObject({
      transport: "http",
      url: OPENVIKING_MCP_URL,
      httpSubtype: "streamable",
      enabled: true,
    });
    expect(next.agents.default.tools.mcpServers).toContain("openviking");
    expect(supervisor.getStatus()).toMatchObject({
      status: "ready",
      enabled: true,
      ownedProcess: false,
      mcpUrl: OPENVIKING_MCP_URL,
    });
  });

  it("enabled + health false then spawn+health → ready, ownedProcess true", async () => {
    let healthy = false;
    const child = mockChild();
    const deps = makeDeps({
      healthCheck: async () => healthy,
      spawnServer: async () => {
        healthy = true;
        return child;
      },
    });
    const supervisor = createOpenVikingSupervisor(deps);

    await supervisor.reconcile(baseConfig(true));

    expect(deps.spawnServer).toHaveBeenCalledOnce();
    expect(deps.spawnServer).toHaveBeenCalledWith({
      confPath: deps.paths.confPath,
      port: 1933,
    });
    expect(deps.writeConfigPreset).toHaveBeenCalledOnce();
    expect(supervisor.getStatus()).toMatchObject({
      status: "ready",
      enabled: true,
      ownedProcess: true,
    });
  });

  it("enabled → disabled → kill owned child and stopped", async () => {
    let healthy = false;
    const child = mockChild();
    const deps = makeDeps({
      healthCheck: async () => healthy,
      spawnServer: async () => {
        healthy = true;
        return child;
      },
    });
    const supervisor = createOpenVikingSupervisor(deps);

    await supervisor.reconcile(baseConfig(true));
    expect(supervisor.getStatus().ownedProcess).toBe(true);
    expect(child.killed).toBe(false);

    await supervisor.reconcile(baseConfig(false));

    expect(child.killed).toBe(true);
    expect(supervisor.getStatus()).toMatchObject({
      status: "stopped",
      enabled: false,
      ownedProcess: false,
    });
  });

  it("overlapping enable then disable → stopped, no orphan child, no ready overwrite", async () => {
    let releaseHealth: (() => void) | undefined;
    const healthGate = new Promise<void>((resolve) => {
      releaseHealth = resolve;
    });
    let healthCalls = 0;
    const child = mockChild();
    const deps = makeDeps({
      healthCheck: async () => {
        healthCalls += 1;
        // First call (pre-spawn): not healthy. After spawn, gate then report healthy
        // so enable can finish unless a newer reconcile/shutdown superseded it.
        if (healthCalls === 1) return false;
        await healthGate;
        return true;
      },
      spawnServer: async () => child,
    });
    const supervisor = createOpenVikingSupervisor(deps);

    const enablePromise = supervisor.reconcile(baseConfig(true));
    // Wait until enable has spawned and is blocked in waitUntilHealthy
    await vi.waitFor(() => {
      expect(deps.spawnServer).toHaveBeenCalledOnce();
    });

    const disablePromise = supervisor.reconcile(baseConfig(false));
    releaseHealth!();

    await Promise.all([enablePromise, disablePromise]);

    expect(child.killed).toBe(true);
    expect(deps.writeConfigPreset).not.toHaveBeenCalled();
    expect(supervisor.getStatus()).toMatchObject({
      status: "stopped",
      enabled: false,
      ownedProcess: false,
    });
  });

  it("writeConfigPreset preserves enabled=false when latest config already disabled", async () => {
    const deps = makeDeps({
      healthCheck: async () => true,
    });
    const supervisor = createOpenVikingSupervisor(deps);

    await supervisor.reconcile(baseConfig(true));
    expect(deps.writeConfigPreset).toHaveBeenCalledOnce();

    const mutate = deps.writeConfigPreset.mock.calls[0]![0] as (
      c: AppConfig,
    ) => AppConfig;
    const latest = baseConfig(false);
    latest.mcpServers = {
      openviking: {
        transport: "http",
        url: OPENVIKING_MCP_URL,
        httpSubtype: "streamable",
        enabled: false,
      },
    };
    const next = mutate(latest);
    expect(next.mcpServers?.openviking?.enabled).toBe(false);
    expect(next.agents.default.tools.mcpServers).toContain("openviking");
  });
});

describe("createDefaultOpenVikingHealthCheck", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when content-type is not JSON even if status is 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => "text/plain" },
        json: async () => ({ status: "ok" }),
      })),
    );
    const check = createDefaultOpenVikingHealthCheck("http://127.0.0.1:9/health");
    expect(await check()).toBe(false);
  });

  it("returns true for JSON body with status ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ status: "ok" }),
      })),
    );
    const check = createDefaultOpenVikingHealthCheck("http://127.0.0.1:9/health");
    expect(await check()).toBe(true);
  });

  it("returns false for JSON body without ok/healthy status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ status: "degraded" }),
      })),
    );
    const check = createDefaultOpenVikingHealthCheck("http://127.0.0.1:9/health");
    expect(await check()).toBe(false);
  });
});
