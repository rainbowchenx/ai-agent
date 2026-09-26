import {
  createBuiltinToolPort,
  createCompositeToolPort,
  Runner,
  type BuiltinToolName,
  type ModelPort,
  type PermissionPolicy,
  type ToolPort,
} from "@agent2026/core";
import { createAnthropicModel, createOpenAICompatibleModel } from "@agent2026/providers";
import type { AppConfig } from "@agent2026/shared";
import type { McpSupervisor } from "../mcp/supervisor.js";

export const DEFAULT_MAX_TURNS = 8;

export type AssembleRuntimeInput = {
  config: AppConfig;
  workspaceRoot: string;
  model?: ModelPort;
  env?: NodeJS.ProcessEnv;
  maxTurns?: number;
  /** Resolve API key by apiKeyEnv ref; defaults to process.env only. */
  resolveCredential?: (ref: string) => string | undefined;
  /** Process-level MCP supervisor; optional for tests / no-MCP runs. */
  mcp?: McpSupervisor;
  /** Extra tool ports (tests); merged after builtin + MCP. */
  extraTools?: ToolPort[];
};

export type AssembledRuntime = {
  runner: Runner;
  model: ModelPort;
  tools: ToolPort;
  permissions: PermissionPolicy;
  systemPrompt: string;
};

export function assembleRuntime(input: AssembleRuntimeInput): AssembledRuntime {
  const { config, workspaceRoot } = input;
  const env = input.env ?? process.env;
  const agent = config.agents.default;
  const maxTurns =
    input.maxTurns ?? agent.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxToolCalls =
    agent.maxToolCalls === null || agent.maxToolCalls === undefined
      ? undefined
      : agent.maxToolCalls;

  const builtin = createBuiltinToolPort(
    agent.tools.builtin as BuiltinToolName[],
    { workspaceRoot },
  );

  const ports: ToolPort[] = [builtin];

  const mounted = agent.tools.mcpServers;
  if (input.mcp && mounted.length > 0) {
    let anyReady = false;
    let anyError = false;
    for (const serverName of mounted) {
      const port = input.mcp.getPort(serverName);
      if (port) {
        ports.push(port);
        anyReady = true;
        continue;
      }
      const status = input.mcp
        .getStatus()
        .find((entry) => entry.name === serverName);
      if (status?.status === "error" || status?.enabled) {
        anyError = true;
        console.warn(
          `[mcp] mounted server "${serverName}" is not ready (status=${status?.status ?? "missing"}); continuing with available tools`,
        );
      }
    }
    if (!anyReady && anyError) {
      console.warn(
        "[mcp] all mounted MCP servers failed; run continues with builtin tools only",
      );
    }
  }

  if (input.extraTools) {
    ports.push(...input.extraTools);
  }

  const tools =
    ports.length === 1 ? ports[0]! : createCompositeToolPort(ports);

  return {
    runner: new Runner({ maxTurns, maxToolCalls }),
    model:
      input.model ??
      createModelFromConfig(config, env, input.resolveCredential),
    tools,
    permissions: config.permissions,
    systemPrompt: agent.systemPrompt,
  };
}

function createModelFromConfig(
  config: AppConfig,
  env: NodeJS.ProcessEnv,
  resolveCredential?: (ref: string) => string | undefined,
): ModelPort {
  const modelRef = config.agents.default.model;
  const slash = modelRef.indexOf("/");
  if (slash <= 0 || slash === modelRef.length - 1) {
    throw new Error(`Invalid agents.default.model: ${modelRef}`);
  }

  const providerName = modelRef.slice(0, slash);
  const modelName = modelRef.slice(slash + 1);
  const entry = config.providers.entries[providerName];
  if (!entry) {
    throw new Error(
      `Unknown provider "${providerName}" in agents.default.model`,
    );
  }

  const apiKey =
    resolveCredential?.(entry.apiKeyEnv) ?? env[entry.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `Missing API key for ${entry.apiKeyEnv} (credentials file or environment)`,
    );
  }

  if (entry.type === "anthropic") {
    return createAnthropicModel({
      id: modelRef,
      baseUrl: entry.baseUrl,
      apiKey,
      model: modelName,
    });
  }

  return createOpenAICompatibleModel({
    id: modelRef,
    baseUrl: entry.baseUrl,
    apiKey,
    model: modelName,
  });
}
