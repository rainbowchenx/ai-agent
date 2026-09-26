import type { AppConfig } from "@agent2026/shared";

const SENSITIVE_HEADER_KEY = /auth|token|secret|password|api[-_]?key/i;

/** Mask sensitive MCP HTTP header values for GET responses. */
export function maskConfigSecrets(config: AppConfig): AppConfig {
  if (!config.mcpServers) {
    return config;
  }

  const mcpServers: NonNullable<AppConfig["mcpServers"]> = {};
  for (const [name, server] of Object.entries(config.mcpServers)) {
    if (server.transport !== "http" || !server.headers) {
      mcpServers[name] = server;
      continue;
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(server.headers)) {
      headers[key] = SENSITIVE_HEADER_KEY.test(key) ? maskValue(value) : value;
    }
    mcpServers[name] = { ...server, headers };
  }

  return { ...config, mcpServers };
}

/**
 * When the client round-trips a masked GET payload, keep previous secrets
 * instead of persisting the mask string.
 */
export function mergeConfigPreservingSecrets(
  previous: AppConfig,
  next: AppConfig,
): AppConfig {
  if (!next.mcpServers) {
    return next;
  }

  const mcpServers: NonNullable<AppConfig["mcpServers"]> = {};
  for (const [name, server] of Object.entries(next.mcpServers)) {
    if (server.transport !== "http" || !server.headers) {
      mcpServers[name] = server;
      continue;
    }
    const prevServer = previous.mcpServers?.[name];
    const prevHeaders =
      prevServer && prevServer.transport === "http"
        ? prevServer.headers
        : undefined;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(server.headers)) {
      if (
        SENSITIVE_HEADER_KEY.test(key) &&
        prevHeaders?.[key] &&
        (value === maskValue(prevHeaders[key]!) || looksLikeMask(value))
      ) {
        headers[key] = prevHeaders[key]!;
      } else {
        headers[key] = value;
      }
    }
    mcpServers[name] = { ...server, headers };
  }

  return { ...next, mcpServers };
}

function maskValue(value: string): string {
  if (value.length <= 4) {
    return "****";
  }
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

function looksLikeMask(value: string): boolean {
  return /^\*{2,}$/.test(value) || /^..?\*{2,}..?$/.test(value);
}

export function isSensitiveHeaderKey(key: string): boolean {
  return SENSITIVE_HEADER_KEY.test(key);
}
