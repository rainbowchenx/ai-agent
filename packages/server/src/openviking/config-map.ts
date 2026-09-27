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

export type MapToOvConfInput = {
  config: AppConfig;
  embeddingApiKey: string | undefined;
  chatApiKey: string | undefined;
  dataDir: string;
};

/** @deprecated Use MapToOvConfInput — kept for call-site transition. */
export type MapProviderToOvConfInput = {
  config: AppConfig;
  apiKey: string | undefined;
  dataDir: string;
};

export type MapProviderToOvConfResult =
  | { ok: true; conf: OvConf }
  | { ok: false; reason: string };

function inferOvProviderFromBaseUrl(baseUrl: string): OvProvider {
  if (/volces\.com|bytepluses\.com/i.test(baseUrl)) {
    return "volcengine";
  }
  return "openai";
}

function inferOvProvider(entry: ProviderEntry): OvProvider {
  if (entry.type === "anthropic") {
    return "openai";
  }
  return inferOvProviderFromBaseUrl(entry.baseUrl ?? "");
}

function embeddingDefaults(provider: OvProvider): {
  dimension: number;
  input: "text" | "multimodal";
} {
  if (provider === "volcengine") {
    return { dimension: 1024, input: "multimodal" };
  }
  return { dimension: 1536, input: "text" };
}

function modelNameSegment(modelRef: string): string {
  const slash = modelRef.indexOf("/");
  return slash >= 0 ? modelRef.slice(slash + 1) : modelRef;
}

export function mapToOvConf(input: MapToOvConfInput): MapProviderToOvConfResult {
  const { config, embeddingApiKey, chatApiKey, dataDir } = input;
  const embedding = config.openviking?.embedding;

  if (!embedding?.baseUrl || !embedding.model || !embedding.apiKeyEnv) {
    return {
      ok: false,
      reason: "请配置独立 Embedding（baseUrl / model / apiKeyEnv）",
    };
  }

  if (!embeddingApiKey) {
    return {
      ok: false,
      reason: `缺少 Embedding API Key（${embedding.apiKeyEnv}）`,
    };
  }

  const defaultName = config.providers.default;
  const entry = config.providers.entries[defaultName];

  if (!entry) {
    return {
      ok: false,
      reason: `缺少默认 Provider「${defaultName}」配置`,
    };
  }

  if (!chatApiKey) {
    return {
      ok: false,
      reason: `缺少 Provider API Key（${entry.apiKeyEnv}）`,
    };
  }

  const embProvider =
    embedding.provider ?? inferOvProviderFromBaseUrl(embedding.baseUrl);
  const embDefaults = embeddingDefaults(embProvider);
  const overrides = config.openviking;
  const vlmProvider = inferOvProvider(entry);

  const conf: OvConf = {
    embedding: {
      dense: {
        provider: embProvider,
        model: embedding.model,
        api_base: embedding.baseUrl,
        api_key: embeddingApiKey,
        dimension: embedding.dimension ?? embDefaults.dimension,
        input: embDefaults.input,
      },
    },
    vlm: {
      provider: vlmProvider,
      model: overrides?.vlmModel ?? modelNameSegment(config.agents.default.model),
      api_base: entry.baseUrl,
      api_key: chatApiKey,
    },
    storage: {
      workspace: dataDir,
    },
  };

  return { ok: true, conf };
}

/**
 * @deprecated Prefer mapToOvConf. Forwards chat apiKey as both keys only when
 * independent embedding is absent (always fails mapping without embedding block).
 */
export function mapProviderToOvConf(
  input: MapProviderToOvConfInput,
): MapProviderToOvConfResult {
  return mapToOvConf({
    config: input.config,
    embeddingApiKey: input.apiKey,
    chatApiKey: input.apiKey,
    dataDir: input.dataDir,
  });
}

export function writeOvConf(confPath: string, conf: object): void {
  mkdirSync(dirname(confPath), { recursive: true });
  writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
