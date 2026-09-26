import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { McpSupervisor } from "../mcp/supervisor.js";
import { registerMcpRoutes } from "./mcp.js";
import { maskConfigSecrets } from "./config-mask.js";
import { defaultAppConfig } from "@agent2026/shared";

describe("MCP routes", () => {
  it("GET /mcp/status returns supervisor status shape", async () => {
    const mcp: McpSupervisor = {
      reconcile: async () => undefined,
      getPort: () => undefined,
      getStatus: () => [
        {
          name: "demo",
          enabled: true,
          transport: "stdio",
          status: "ready",
          toolCount: 1,
          tools: [{ name: "demo__echo", description: "echo" }],
        },
      ],
      refreshTools: async () => undefined,
      shutdown: async () => undefined,
    };

    const app = Fastify();
    registerMcpRoutes(app, { mcp });
    const res = await app.inject({ method: "GET", url: "/mcp/status" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        name: "demo",
        enabled: true,
        transport: "stdio",
        status: "ready",
        toolCount: 1,
        tools: [{ name: "demo__echo", description: "echo" }],
      },
    ]);
  });

  it("POST /mcp/:serverName/refresh triggers refreshTools", async () => {
    const refreshTools = vi.fn(async () => undefined);
    const mcp: McpSupervisor = {
      reconcile: async () => undefined,
      getPort: () => undefined,
      getStatus: () => [
        {
          name: "demo",
          enabled: true,
          transport: "http",
          status: "ready",
          toolCount: 0,
          tools: [],
        },
      ],
      refreshTools,
      shutdown: async () => undefined,
    };

    const app = Fastify();
    registerMcpRoutes(app, { mcp });
    const res = await app.inject({
      method: "POST",
      url: "/mcp/demo/refresh",
    });
    await app.close();

    expect(refreshTools).toHaveBeenCalledWith("demo");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: { name: "demo" } });
  });
});

describe("maskConfigSecrets", () => {
  it("masks Authorization and token-like headers on GET config", () => {
    const config = defaultAppConfig();
    config.mcpServers = {
      ov: {
        transport: "http",
        url: "http://localhost:1933/mcp",
        enabled: true,
        headers: {
          Authorization: "Bearer super-secret-token",
          "X-Api-Key": "abcdefghij",
          "X-Trace-Id": "plain-ok",
        },
      },
    };

    const masked = maskConfigSecrets(config);
    const headers = masked.mcpServers?.ov;
    expect(headers && headers.transport === "http" && headers.headers).toEqual({
      Authorization: "Be****en",
      "X-Api-Key": "ab****ij",
      "X-Trace-Id": "plain-ok",
    });
    // original untouched
    expect(
      config.mcpServers?.ov &&
        config.mcpServers.ov.transport === "http" &&
        config.mcpServers.ov.headers?.Authorization,
    ).toBe("Bearer super-secret-token");
  });
});
