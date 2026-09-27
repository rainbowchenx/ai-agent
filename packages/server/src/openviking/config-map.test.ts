import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAppConfig, type AppConfig } from "@agent2026/shared";
import { mapToOvConf, writeOvConf } from "./config-map.js";
import { defaultOpenVikingPaths, findRepoRoot } from "./paths.js";

function withOpenaiProvider(overrides?: Partial<AppConfig>): AppConfig {
  const config = defaultAppConfig();
  return {
    ...config,
    ...overrides,
    providers: overrides?.providers ?? config.providers,
    agents: overrides?.agents ?? config.agents,
    openviking: overrides?.openviking,
  };
}

function withIndependentEmbedding(
  overrides?: Partial<AppConfig>,
  embedding?: Partial<NonNullable<AppConfig["openviking"]>["embedding"]>,
): AppConfig {
  return withOpenaiProvider({
    ...overrides,
    openviking: {
      ...overrides?.openviking,
      embedding: {
        baseUrl: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
        apiKeyEnv: "OPENVIKING_EMBEDDING_API_KEY",
        ...embedding,
      },
    },
  });
}

describe("mapToOvConf", () => {
  it("maps independent embedding into ov.conf dense and chat provider into vlm", () => {
    const result = mapToOvConf({
      config: withIndependentEmbedding(),
      embeddingApiKey: "sk-emb",
      chatApiKey: "sk-chat",
      dataDir: "/tmp/ov-data",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.conf.embedding.dense).toMatchObject({
      api_key: "sk-emb",
      api_base: "https://api.openai.com/v1",
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: 1536,
      input: "text",
    });
    expect(result.conf.vlm).toMatchObject({
      api_key: "sk-chat",
      api_base: "https://api.openai.com/v1",
      provider: "openai",
      model: "gpt-4.1",
    });
    expect(result.conf.storage.workspace).toBe("/tmp/ov-data");
  });

  it("fails when independent embedding block is missing", () => {
    const result = mapToOvConf({
      config: withOpenaiProvider(),
      embeddingApiKey: "sk-emb",
      chatApiKey: "sk-chat",
      dataDir: "/tmp/x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/请配置独立 Embedding/);
  });

  it("fails when only deprecated flat embeddingModel is present", () => {
    const result = mapToOvConf({
      config: withOpenaiProvider({
        openviking: { embeddingModel: "text-embedding-3-small" },
      }),
      embeddingApiKey: "sk-emb",
      chatApiKey: "sk-chat",
      dataDir: "/tmp/x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/请配置独立 Embedding/);
  });

  it("fails when embedding api key missing", () => {
    const result = mapToOvConf({
      config: withIndependentEmbedding(),
      embeddingApiKey: undefined,
      chatApiKey: "sk-chat",
      dataDir: "/tmp/x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/缺少 Embedding API Key/);
    expect(result.reason).toMatch(/OPENVIKING_EMBEDDING_API_KEY/);
  });

  it("fails when chat api key missing", () => {
    const result = mapToOvConf({
      config: withIndependentEmbedding(),
      embeddingApiKey: "sk-emb",
      chatApiKey: undefined,
      dataDir: "/tmp/x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/缺少 Provider API Key/);
  });

  it("infers volcengine from embedding.baseUrl", () => {
    const result = mapToOvConf({
      config: withIndependentEmbedding(undefined, {
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        model: "doubao-embedding-vision-251215",
      }),
      embeddingApiKey: "sk-volc",
      chatApiKey: "sk-chat",
      dataDir: "/tmp/ov-data",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conf.embedding.dense).toMatchObject({
      provider: "volcengine",
      model: "doubao-embedding-vision-251215",
      dimension: 1024,
      input: "multimodal",
      api_base: "https://ark.cn-beijing.volces.com/api/v3",
      api_key: "sk-volc",
    });
  });

  it("does not use chat provider baseUrl for dense when embedding differs", () => {
    const config = withIndependentEmbedding(
      {
        providers: {
          default: "openai",
          entries: {
            openai: {
              type: "openai_compatible",
              baseUrl: "https://api.deepseek.com/v1",
              apiKeyEnv: "OPENAI_API_KEY",
            },
          },
        },
      },
      {
        baseUrl: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
      },
    );

    const result = mapToOvConf({
      config,
      embeddingApiKey: "sk-emb",
      chatApiKey: "sk-chat",
      dataDir: "/tmp/ov-data",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conf.embedding.dense.api_base).toBe(
      "https://api.openai.com/v1",
    );
    expect(result.conf.vlm.api_base).toBe("https://api.deepseek.com/v1");
  });

  it("maps anthropic chat provider string to openai for vlm", () => {
    const config = withIndependentEmbedding({
      providers: {
        default: "anthropic",
        entries: {
          anthropic: {
            type: "anthropic",
            baseUrl: "https://api.anthropic.com/v1",
            apiKeyEnv: "ANTHROPIC_API_KEY",
          },
        },
      },
      agents: {
        default: {
          ...defaultAppConfig().agents.default,
          model: "anthropic/claude-sonnet",
        },
      },
    });

    const result = mapToOvConf({
      config,
      embeddingApiKey: "sk-emb",
      chatApiKey: "sk-ant",
      dataDir: "/tmp/ov-data",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conf.embedding.dense.provider).toBe("openai");
    expect(result.conf.vlm.provider).toBe("openai");
    expect(result.conf.vlm.model).toBe("claude-sonnet");
    expect(result.conf.vlm.api_base).toBe("https://api.anthropic.com/v1");
  });

  it("applies dimension and vlmModel overrides", () => {
    const result = mapToOvConf({
      config: withIndependentEmbedding(
        { openviking: { vlmModel: "gpt-4o" } },
        { dimension: 3072, model: "text-embedding-3-large" },
      ),
      embeddingApiKey: "sk-emb",
      chatApiKey: "sk-chat",
      dataDir: "/tmp/ov-data",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conf.embedding.dense.model).toBe("text-embedding-3-large");
    expect(result.conf.embedding.dense.dimension).toBe(3072);
    expect(result.conf.vlm.model).toBe("gpt-4o");
  });
});

describe("writeOvConf", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("writes json with mode 0o600 when supported", () => {
    const dir = mkdtempSync(join(tmpdir(), "ov-conf-"));
    dirs.push(dir);
    const path = join(dir, "ov.conf");
    writeOvConf(path, { hello: "world" });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ hello: "world" });
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });
});

describe("defaultOpenVikingPaths", () => {
  it("resolves under home and finds repo runtime", () => {
    const paths = defaultOpenVikingPaths();
    expect(paths.rootDir).toMatch(/openviking/);
    expect(findRepoRoot()).toBeTruthy();
  });
});
