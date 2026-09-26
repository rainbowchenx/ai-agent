import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AppConfig, ProviderEntry } from "@agent2026/shared";

export type OvProvider = "openai" | "volcengine";

export type OvConf = {
  embedding: {
    dense: {
      provider: OvProvider;
      model: string;
      api_base: string;
      api_key: string;
      dimension: number;
      input: "text" | "multimodal";
    };
  };
  vlm: {
    provider: OvProvider;
    model: string;
    api_base: string;
    api_key: string;
  };
  storage: {
    workspace: string;
  };
};

export type MapProviderToOvConfInput = {
  config: AppConfig;
  apiKey: string | undefined;
  dataDir: string;
};

export type MapProviderToOvConfResult =
  | { ok: true; conf: OvConf }
  | { ok: false; reason: string };

function inferOvProvider(entry: ProviderEntry): OvProvider {
  if (entry.type === "anthropic") {
    return "openai";
  }
  const base = entry.baseUrl ?? "";
  if (/volces\.com|bytepluses\.com/i.test(base)) {
    return "volcengine";
  }
  return "openai";
}

function embeddingDefaults(provider: OvProvider): {
  model: string;
  dimension: number;
  input: "text" | "multimodal";
} {
  if (provider === "volcengine") {
    return {
      model: "doubao-embedding-vision-251215",
      dimension: 1024,
      input: "multimodal",
    };
  }
  return {
    model: "text-embedding-3-small",
    dimension: 1536,
    input: "text",
  };
}

function modelNameSegment(modelRef: string): string {
  const slash = modelRef.indexOf("/");
  return slash >= 0 ? modelRef.slice(slash + 1) : modelRef;
}

export function mapProviderToOvConf(
  input: MapProviderToOvConfInput,
): MapProviderToOvConfResult {
  const { config, apiKey, dataDir } = input;
  const defaultName = config.providers.default;
  const entry = config.providers.entries[defaultName];

  if (!entry) {
    return {
      ok: false,
      reason: `缺少默认 Provider「${defaultName}」配置`,
    };
  }

  if (!apiKey) {
    return {
      ok: false,
      reason: `缺少 Provider API Key（${entry.apiKeyEnv}）`,
    };
  }

  const ovProvider = inferOvProvider(entry);
  const defaults = embeddingDefaults(ovProvider);
  const overrides = config.openviking;
  const apiBase = entry.baseUrl;

  const conf: OvConf = {
    embedding: {
      dense: {
        provider: ovProvider,
        model: overrides?.embeddingModel ?? defaults.model,
        api_base: apiBase,
        api_key: apiKey,
        dimension: overrides?.embeddingDimension ?? defaults.dimension,
        input: defaults.input,
      },
    },
    vlm: {
      provider: ovProvider,
      model: overrides?.vlmModel ?? modelNameSegment(config.agents.default.model),
      api_base: apiBase,
      api_key: apiKey,
    },
    storage: {
      workspace: dataDir,
    },
  };

  return { ok: true, conf };
}

export function writeOvConf(confPath: string, conf: object): void {
  mkdirSync(dirname(confPath), { recursive: true });
  writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`, "utf8");
}
