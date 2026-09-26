import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAppConfig, type AppConfig } from "@agent2026/shared";
import { mapProviderToOvConf, writeOvConf } from "./config-map.js";
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

describe("mapProviderToOvConf", () => {
  it("maps openai_compatible provider into ov.conf", () => {
    const result = mapProviderToOvConf({
      config: withOpenaiProvider(),
      apiKey: "sk-test",
      dataDir: "/tmp/ov-data",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.conf.embedding.dense).toMatchObject({
      api_key: "sk-test",
      api_base: "https://api.openai.com/v1",
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: 1536,
      input: "text",
    });
    expect(result.conf.vlm).toMatchObject({
      api_key: "sk-test",
      api_base: "https://api.openai.com/v1",
      provider: "openai",
      model: "gpt-4.1",
    });
    expect(result.conf.storage.workspace).toBe("/tmp/ov-data");
  });

  it("returns reason when api key missing", () => {
    const result = mapProviderToOvConf({
      config: withOpenaiProvider(),
      apiKey: undefined,
      dataDir: "/tmp/x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/缺少 Provider API Key/);
    expect(result.reason).toMatch(/OPENAI_API_KEY/);
  });

  it("infers volcengine when baseUrl hosts match", () => {
    const config = withOpenaiProvider();
    config.providers.entries.openai = {
      type: "openai_compatible",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKeyEnv: "OPENAI_API_KEY",
    };

    const result = mapProviderToOvConf({
      config,
      apiKey: "sk-volc",
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
    });
    expect(result.conf.vlm.provider).toBe("volcengine");
  });

  it("maps anthropic provider string to openai", () => {
    const config = withOpenaiProvider();
    config.providers.default = "anthropic";
    config.providers.entries.anthropic = {
      type: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKeyEnv: "ANTHROPIC_API_KEY",
    };
    config.agents.default.model = "anthropic/claude-sonnet";

    const result = mapProviderToOvConf({
      config,
      apiKey: "sk-ant",
      dataDir: "/tmp/ov-data",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conf.embedding.dense.provider).toBe("openai");
    expect(result.conf.vlm.provider).toBe("openai");
    expect(result.conf.vlm.model).toBe("claude-sonnet");
    expect(result.conf.vlm.api_base).toBe("https://api.anthropic.com/v1");
  });

  it("applies openviking model overrides", () => {
    const result = mapProviderToOvConf({
      config: withOpenaiProvider({
        openviking: {
          embeddingModel: "text-embedding-3-large",
          embeddingDimension: 3072,
          vlmModel: "gpt-4o",
        },
      }),
      apiKey: "sk-test",
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
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes conf json under parent directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "ov-conf-"));
    dirs.push(dir);
    const confPath = join(dir, "nested", "ov.conf");
    const conf = { storage: { workspace: "/tmp/data" } };

    writeOvConf(confPath, conf);

    expect(JSON.parse(readFileSync(confPath, "utf8"))).toEqual(conf);
  });
});

describe("paths", () => {
  it("findRepoRoot walks up for openviking-runtime pyproject", () => {
    const root = findRepoRoot(process.cwd());
    expect(root).toBeTruthy();
    expect(root.replace(/\\/g, "/")).toMatch(/agent2026$/);
  });

  it("defaultOpenVikingPaths uses injected repo root", () => {
    const paths = defaultOpenVikingPaths("/repo");
    expect(paths.confPath.replace(/\\/g, "/")).toMatch(
      /\.agent2026\/openviking\/ov\.conf$/,
    );
    expect(paths.dataDir.replace(/\\/g, "/")).toMatch(
      /\.agent2026\/openviking\/data$/,
    );
    expect(paths.runtimeProjectDir.replace(/\\/g, "/")).toBe(
      "/repo/packages/openviking-runtime",
    );
  });
});
