import {
  createBuiltinToolPort,
  Runner,
  type BuiltinToolName,
  type ModelPort,
  type PermissionPolicy,
  type ToolPort,
} from "@agent2026/core";
import { createOpenAICompatibleModel } from "@agent2026/providers";
import type { AppConfig } from "@agent2026/shared";

export const DEFAULT_MAX_TURNS = 8;

export type AssembleRuntimeInput = {
  config: AppConfig;
  workspaceRoot: string;
  model?: ModelPort;
  env?: NodeJS.ProcessEnv;
  maxTurns?: number;
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

  return {
    runner: new Runner({ maxTurns: input.maxTurns ?? DEFAULT_MAX_TURNS }),
    model: input.model ?? createModelFromConfig(config, env),
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
  if (entry.type !== "openai_compatible") {
    throw new Error(`Unsupported provider type: ${entry.type}`);
  }

  const apiKey = env[entry.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `Missing API key in environment variable ${entry.apiKeyEnv}`,
    );
  }

  // Env wins so .env OPENAI_BASE_URL works even after an old config.yaml was written.
  const baseUrl = env.OPENAI_BASE_URL?.trim() || entry.baseUrl;

  return createOpenAICompatibleModel({
    id: modelRef,
    baseUrl,
    apiKey,
    model: modelName,
  });
}
