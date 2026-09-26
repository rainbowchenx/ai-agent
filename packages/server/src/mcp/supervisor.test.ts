import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "@agent2026/core";
import type { McpServerSession } from "@agent2026/mcp";
import type { AppConfig } from "@agent2026/shared";
import { defaultAppConfig } from "@agent2026/shared";
import { createMcpSupervisor, type McpSessionFactory } from "./supervisor.js";

function fakeSession(
  name: string,
  tools: ToolDefinition[],
  status: McpServerSession["status"] = "ready",
): McpServerSession & { closed: boolean } {
  const session = {
    name,
    status,
    lastError: status === "error" ? "boom" : undefined,
    tools,
    closed: false,
    asToolPort() {
      return {
        list: () => tools,
        execute: async () => "ok",
      };
    },
    async refreshTools() {
      // no-op
    },
    async close() {
      session.closed = true;
      session.status = "closed";
    },
  };
  return session;
}

function baseConfig(): AppConfig {
  return defaultAppConfig();
}

describe("McpSupervisor", () => {
  it("does not connect disabled servers", async () => {
    const createStdio = vi.fn();
    const factory: McpSessionFactory = {
      createStdio,
      createHttp: vi.fn(),
    };
    const supervisor = createMcpSupervisor(factory);
    const config = baseConfig();
    config.mcpServers = {
      demo: {
        transport: "stdio",
        command: "npx",
        args: [],
        enabled: false,
      },
    };

    await supervisor.reconcile(config);

    expect(createStdio).not.toHaveBeenCalled();
    expect(supervisor.getStatus()).toEqual([
      {
        name: "demo",
        enabled: false,
        transport: "stdio",
        status: "disabled",
        toolCount: 0,
        tools: [],
      },
    ]);
    expect(supervisor.getPort("demo")).toBeUndefined();
  });

  it("preconnects enabled servers even when not mounted", async () => {
    const session = fakeSession("demo", [
      {
        name: "demo__echo",
        description: "echo",
        parameters: { type: "object", properties: {} },
      },
    ]);
    const factory: McpSessionFactory = {
      createStdio: vi.fn(async () => session),
      createHttp: vi.fn(),
    };
    const supervisor = createMcpSupervisor(factory);
    const config = baseConfig();
    config.mcpServers = {
      demo: {
        transport: "stdio",
        command: "npx",
        args: ["x"],
        enabled: true,
      },
    };
    // not mounted in agents.default.tools.mcpServers

    await supervisor.reconcile(config);

    expect(factory.createStdio).toHaveBeenCalledOnce();
    expect(supervisor.getPort("demo")?.list()[0]?.name).toBe("demo__echo");
    expect(supervisor.getStatus()[0]?.status).toBe("ready");
  });

  it("shutdown closes sessions", async () => {
    const session = fakeSession("demo", []);
    const factory: McpSessionFactory = {
      createStdio: vi.fn(async () => session),
      createHttp: vi.fn(),
    };
    const supervisor = createMcpSupervisor(factory);
    const config = baseConfig();
    config.mcpServers = {
      demo: {
        transport: "stdio",
        command: "npx",
        args: [],
        enabled: true,
      },
    };
    await supervisor.reconcile(config);
    await supervisor.shutdown();
    expect(session.closed).toBe(true);
    expect(supervisor.getPort("demo")).toBeUndefined();
  });

  it("disabling an enabled server closes the session", async () => {
    const session = fakeSession("demo", []);
    const factory: McpSessionFactory = {
      createStdio: vi.fn(async () => session),
      createHttp: vi.fn(),
    };
    const supervisor = createMcpSupervisor(factory);
    const config = baseConfig();
    config.mcpServers = {
      demo: {
        transport: "stdio",
        command: "npx",
        args: [],
        enabled: true,
      },
    };
    await supervisor.reconcile(config);

    config.mcpServers.demo = {
      ...config.mcpServers.demo,
      enabled: false,
    };
    await supervisor.reconcile(config);

    expect(session.closed).toBe(true);
    expect(supervisor.getStatus()[0]?.status).toBe("disabled");
  });
});
