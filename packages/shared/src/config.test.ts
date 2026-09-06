import { describe, expect, it } from "vitest";
import { defaultAppConfig, parseAppConfig } from "./config.js";

describe("parseAppConfig", () => {
  it("rejects missing providers.entries", () => {
    expect(() =>
      parseAppConfig({
        providers: { default: "openai", entries: {} },
        agents: {
          default: {
            model: "openai/gpt-4.1",
            systemPrompt: "hi",
            tools: { builtin: [], mcpServers: [], sidecars: [] },
          },
        },
        permissions: { mode: "default", allowlist: [] },
        a2a: { enabled: false },
      }),
    ).toThrow();
  });

  it("parses valid default config", () => {
    const config = parseAppConfig(defaultAppConfig());
    expect(config.providers.default).toBe("openai");
    expect(config.providers.entries.openai?.type).toBe("openai_compatible");
    expect(config.providers.entries.openai?.apiKeyEnv).toBe("OPENAI_API_KEY");
    expect(config.agents.default.tools.builtin).toContain("read_file");
    expect(config.permissions.mode).toBe("default");
  });
});
