import type { ToolPort } from "@agent2026/core";
import {
  createHttpMcpSession,
  createStdioMcpSession,
  type McpServerSession,
} from "@agent2026/mcp";
import type {
  AppConfig,
  McpServerConfig,
  McpServerStatusView,
} from "@agent2026/shared";

export type McpSessionFactory = {
  createStdio: typeof createStdioMcpSession;
  createHttp: typeof createHttpMcpSession;
};

export type McpSupervisor = {
  reconcile(config: AppConfig): Promise<void>;
  getPort(serverName: string): ToolPort | undefined;
  getStatus(): McpServerStatusView[];
  refreshTools(serverName: string): Promise<void>;
  shutdown(): Promise<void>;
};

type Entry = {
  configKey: string;
  fingerprint: string;
  enabled: boolean;
  transport: "stdio" | "http";
  session: McpServerSession | null;
};

const defaultFactory: McpSessionFactory = {
  createStdio: createStdioMcpSession,
  createHttp: createHttpMcpSession,
};

export function createMcpSupervisor(
  factory: McpSessionFactory = defaultFactory,
): McpSupervisor {
  const entries = new Map<string, Entry>();
  let shutDown = false;

  async function closeEntry(entry: Entry): Promise<void> {
    if (entry.session) {
      await entry.session.close().catch(() => undefined);
      entry.session = null;
    }
  }

  return {
    async reconcile(config) {
      if (shutDown) {
        return;
      }

      const servers = config.mcpServers ?? {};
      const keep = new Set(Object.keys(servers));

      for (const [name, entry] of entries) {
        if (!keep.has(name)) {
          await closeEntry(entry);
          entries.delete(name);
        }
      }

      for (const [name, serverConfig] of Object.entries(servers)) {
        const fingerprint = fingerprintConfig(serverConfig);
        const existing = entries.get(name);

        if (!serverConfig.enabled) {
          if (existing) {
            await closeEntry(existing);
            existing.enabled = false;
            existing.fingerprint = fingerprint;
            existing.transport = serverConfig.transport;
            existing.session = null;
          } else {
            entries.set(name, {
              configKey: name,
              fingerprint,
              enabled: false,
              transport: serverConfig.transport,
              session: null,
            });
          }
          continue;
        }

        if (
          existing &&
          existing.enabled &&
          existing.fingerprint === fingerprint &&
          existing.session &&
          (existing.session.status === "ready" ||
            existing.session.status === "connecting" ||
            existing.session.status === "error")
        ) {
          // Keep current session (including error until refresh/restart).
          continue;
        }

        if (existing) {
          await closeEntry(existing);
        }

        const session = await openSession(name, serverConfig, factory);
        entries.set(name, {
          configKey: name,
          fingerprint,
          enabled: true,
          transport: serverConfig.transport,
          session,
        });
      }
    },

    getPort(serverName) {
      const entry = entries.get(serverName);
      if (!entry?.enabled || !entry.session || entry.session.status !== "ready") {
        return undefined;
      }
      return entry.session.asToolPort();
    },

    getStatus() {
      return [...entries.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, entry]) => toStatusView(name, entry));
    },

    async refreshTools(serverName) {
      const entry = entries.get(serverName);
      if (!entry) {
        throw new Error(`Unknown MCP server: ${serverName}`);
      }
      if (!entry.enabled) {
        throw new Error(`MCP server "${serverName}" is disabled`);
      }
      if (!entry.session) {
        throw new Error(`MCP server "${serverName}" has no session`);
      }
      if (entry.session.status === "error") {
        // Reconnect using stored fingerprint by forcing reopen via fake mismatch.
        // Caller should reconcile; here we try refreshTools on existing client.
      }
      try {
        await entry.session.refreshTools();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to refresh MCP tools for "${serverName}": ${message}`);
      }
    },

    async shutdown() {
      shutDown = true;
      const all = [...entries.values()];
      entries.clear();
      await Promise.all(all.map((entry) => closeEntry(entry)));
    },
  };
}

async function openSession(
  name: string,
  config: McpServerConfig,
  factory: McpSessionFactory,
): Promise<McpServerSession> {
  if (config.transport === "stdio") {
    return factory.createStdio({
      name,
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
    });
  }
  return factory.createHttp({
    name,
    url: config.url,
    headers: config.headers,
    httpSubtype: config.httpSubtype,
  });
}

function fingerprintConfig(config: McpServerConfig): string {
  return JSON.stringify(config);
}

function toStatusView(name: string, entry: Entry): McpServerStatusView {
  if (!entry.enabled) {
    return {
      name,
      enabled: false,
      transport: entry.transport,
      status: "disabled",
      toolCount: 0,
      tools: [],
    };
  }

  const session = entry.session;
  if (!session) {
    return {
      name,
      enabled: true,
      transport: entry.transport,
      status: "closed",
      toolCount: 0,
      tools: [],
    };
  }

  return {
    name,
    enabled: true,
    transport: entry.transport,
    status: session.status,
    toolCount: session.tools.length,
    tools: session.tools.map((tool) => ({
      name: tool.name,
      description: tool.description || undefined,
    })),
    lastError: session.lastError,
  };
}
