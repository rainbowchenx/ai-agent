import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { AppConfig, OpenVikingStatusView } from "@agent2026/shared";
import type { McpSupervisor } from "../mcp/supervisor.js";
import type { OpenVikingSupervisor } from "../openviking/supervisor.js";
import { createApp } from "../app.js";
import { registerOpenVikingRoutes } from "./openviking.js";

const stoppedStatus: OpenVikingStatusView = {
  status: "stopped",
  enabled: false,
  ownedProcess: false,
  mcpUrl: "http://127.0.0.1:1933/mcp",
};

const readyStatus: OpenVikingStatusView = {
  status: "ready",
  enabled: true,
  ownedProcess: true,
  mcpUrl: "http://127.0.0.1:1933/mcp",
};

function mockOpenViking(
  overrides: Partial<OpenVikingSupervisor> = {},
): OpenVikingSupervisor {
  return {
    reconcile: async () => undefined,
    getStatus: () => stoppedStatus,
    shutdown: async () => undefined,
    ...overrides,
  };
}

function mockMcp(overrides: Partial<McpSupervisor> = {}): McpSupervisor {
  return {
    reconcile: async () => undefined,
    getPort: () => undefined,
    getStatus: () => [],
    refreshTools: async () => undefined,
    shutdown: async () => undefined,
    ...overrides,
  };
}

describe("OpenViking routes", () => {
  it("GET /openviking/status returns supervisor status shape", async () => {
    const openViking = mockOpenViking({
      getStatus: () => readyStatus,
    });

    const app = Fastify();
    registerOpenVikingRoutes(app, {
      openViking,
      retry: async () => readyStatus,
    });
    const res = await app.inject({ method: "GET", url: "/openviking/status" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(readyStatus);
  });

  it("POST /openviking/retry runs retry and returns latest status", async () => {
    const retry = vi.fn(async () => readyStatus);
    const openViking = mockOpenViking();

    const app = Fastify();
    registerOpenVikingRoutes(app, { openViking, retry });
    const res = await app.inject({
      method: "POST",
      url: "/openviking/retry",
    });
    await app.close();

    expect(retry).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(readyStatus);
  });
});

describe("OpenViking app wiring", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("createApp does not block on OpenViking ready", async () => {
    dir = await mkdtemp(join(tmpdir(), "agent2026-ov-app-"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const openViking = mockOpenViking({
      reconcile: async () => {
        await gate;
      },
    });
    const mcp = mockMcp();

    const app = await createApp({
      configPath: join(dir, "config.yaml"),
      credentialsPath: join(dir, "credentials.yaml"),
      dbPath: join(dir, "data.sqlite"),
      openViking,
      mcp,
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);

    release();
    await app.close();
  });

  it("retry runs OpenViking reconcile before MCP reconcile", async () => {
    dir = await mkdtemp(join(tmpdir(), "agent2026-ov-order-"));
    const order: string[] = [];

    const mcp = mockMcp({
      reconcile: async () => {
        order.push("mcp");
      },
    });
    const openViking = mockOpenViking({
      reconcile: async () => {
        order.push("openviking");
      },
      getStatus: () => readyStatus,
    });

    const app = await createApp({
      configPath: join(dir, "config.yaml"),
      credentialsPath: join(dir, "credentials.yaml"),
      dbPath: join(dir, "data.sqlite"),
      openViking,
      mcp,
      skipOpenVikingReconcile: true,
      skipMcpReconcile: true,
    });

    const res = await app.inject({
      method: "POST",
      url: "/openviking/retry",
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(readyStatus);
    expect(order).toEqual(["openviking", "mcp"]);
  });

  it("writeConfigPreset during reconcile does not cause infinite onChange loop", async () => {
    dir = await mkdtemp(join(tmpdir(), "agent2026-ov-loop-"));
    let ovCalls = 0;
    let mcpCalls = 0;

    const mcp = mockMcp({
      reconcile: async () => {
        mcpCalls += 1;
      },
    });

    const app = await createApp({
      configPath: join(dir, "config.yaml"),
      credentialsPath: join(dir, "credentials.yaml"),
      dbPath: join(dir, "data.sqlite"),
      mcp,
      skipOpenVikingReconcile: true,
      skipMcpReconcile: true,
      openViking: {
        reconcile: async () => {
          ovCalls += 1;
          if (ovCalls > 5) {
            throw new Error("infinite reconcile loop detected");
          }
          const got = await app.inject({ method: "GET", url: "/config" });
          const config = got.json<AppConfig>();
          config.agents.default.systemPrompt = `preset-${ovCalls}`;
          const put = await app.inject({
            method: "PUT",
            url: "/config",
            payload: config,
          });
          expect(put.statusCode).toBe(200);
        },
        getStatus: () => readyStatus,
        shutdown: async () => undefined,
      },
    });

    await app.inject({ method: "POST", url: "/openviking/retry" });
    await new Promise((r) => setTimeout(r, 50));

    expect(ovCalls).toBe(1);
    expect(mcpCalls).toBe(1);

    await app.close();
  });

  it("onClose shuts down OpenViking then MCP", async () => {
    dir = await mkdtemp(join(tmpdir(), "agent2026-ov-close-"));
    const order: string[] = [];

    const openViking = mockOpenViking({
      shutdown: async () => {
        order.push("openviking");
      },
    });
    const mcp = mockMcp({
      shutdown: async () => {
        order.push("mcp");
      },
    });

    const app = await createApp({
      configPath: join(dir, "config.yaml"),
      credentialsPath: join(dir, "credentials.yaml"),
      dbPath: join(dir, "data.sqlite"),
      openViking,
      mcp,
      skipOpenVikingReconcile: true,
      skipMcpReconcile: true,
    });

    await app.close();
    expect(order).toEqual(["openviking", "mcp"]);
  });
});
