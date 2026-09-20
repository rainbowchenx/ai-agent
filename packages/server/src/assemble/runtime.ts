import {
  createBuiltinToolPort,
  Runner,
  type BuiltinToolName,
  type ModelPort,
  type PermissionPolicy,
  type ToolPort,
} from "@agent2026/core";
import { createAnthropicModel, createOpenAICompatibleModel } from "@agent2026/providers";
import type { AppConfig } from "@agent2026/shared";

export const DEFAULT_MAX_TURNS = 8;

export type AssembleRuntimeInput = {
  config: AppConfig;
  workspaceRoot: string;
  model?: ModelPort;
  env?: NodeJS.ProcessEnv;
  maxTurns?: number;
  /** Resolve API key by apiKeyEnv ref; defaults to process.env only. */
  resolveCredential?: (ref: string) => string | undefined;
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

  return {
    runner: new Runner({ maxTurns, maxToolCalls }),
    model:
      input.model ??
      createModelFromConfig(config, env, input.resolveCredential),
    tools: createBuiltinToolPort(agent.tools.builtin as BuiltinToolName[], {
      workspaceRoot,
    }),
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
