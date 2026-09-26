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

  it("rejects agent mcpServers refs when top-level mcpServers block is missing", () => {
    expect(() =>
      parseAppConfig({
        providers: {
          default: "openai",
          entries: {
            openai: {
              type: "openai_compatible",
              baseUrl: "https://api.openai.com/v1",
              apiKeyEnv: "OPENAI_API_KEY",
            },
          },
        },
        agents: {
          default: {
            model: "openai/gpt-4.1",
            systemPrompt: "hi",
            tools: { builtin: [], mcpServers: ["filesystem"], sidecars: [] },
          },
        },
        permissions: { mode: "default", allowlist: [] },
        a2a: { enabled: false },
      }),
    ).toThrow(/mcpServers block is missing/);
  });

  it("rejects agent mcpServers refs to unknown server names", () => {
    expect(() =>
      parseAppConfig({
        providers: {
          default: "openai",
          entries: {
            openai: {
              type: "openai_compatible",
              baseUrl: "https://api.openai.com/v1",
              apiKeyEnv: "OPENAI_API_KEY",
            },
          },
        },
        agents: {
          default: {
            model: "openai/gpt-4.1",
            systemPrompt: "hi",
            tools: { builtin: [], mcpServers: ["filesystem"], sidecars: [] },
          },
        },
        mcpServers: {},
        permissions: { mode: "default", allowlist: [] },
        a2a: { enabled: false },
      }),
    ).toThrow(/unknown mcpServers entry.*filesystem/);
  });

  it("accepts stdio and http mcpServers and defaults enabled to true", () => {
    const config = parseAppConfig({
      providers: {
        default: "openai",
        entries: {
          openai: {
            type: "openai_compatible",
            baseUrl: "https://api.openai.com/v1",
            apiKeyEnv: "OPENAI_API_KEY",
          },
        },
      },
      agents: {
        default: {
          model: "openai/gpt-4.1",
          systemPrompt: "hi",
          tools: {
            builtin: [],
            mcpServers: ["filesystem", "openviking"],
            sidecars: [],
          },
        },
      },
      mcpServers: {
        filesystem: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        },
        openviking: {
          transport: "http",
          url: "http://localhost:1933/mcp",
        },
      },
      permissions: { mode: "default", allowlist: [] },
      a2a: { enabled: false },
    });

    expect(config.mcpServers?.filesystem).toMatchObject({
      transport: "stdio",
      command: "npx",
      enabled: true,
    });
    expect(config.mcpServers?.openviking).toMatchObject({
      transport: "http",
      url: "http://localhost:1933/mcp",
      enabled: true,
      httpSubtype: "streamable",
    });
  });

  it("rejects http mcpServers missing url", () => {
    expect(() =>
      parseAppConfig({
        providers: {
          default: "openai",
          entries: {
            openai: {
              type: "openai_compatible",
              baseUrl: "https://api.openai.com/v1",
              apiKeyEnv: "OPENAI_API_KEY",
            },
          },
        },
        agents: {
          default: {
            model: "openai/gpt-4.1",
            systemPrompt: "hi",
            tools: { builtin: [], mcpServers: [], sidecars: [] },
          },
        },
        mcpServers: {
          bad: { transport: "http" },
        },
        permissions: { mode: "default", allowlist: [] },
        a2a: { enabled: false },
      }),
    ).toThrow();
  });

  it("rejects unknown mcp transport", () => {
    expect(() =>
      parseAppConfig({
        providers: {
          default: "openai",
          entries: {
            openai: {
              type: "openai_compatible",
              baseUrl: "https://api.openai.com/v1",
              apiKeyEnv: "OPENAI_API_KEY",
            },
          },
        },
        agents: {
          default: {
            model: "openai/gpt-4.1",
            systemPrompt: "hi",
            tools: { builtin: [], mcpServers: [], sidecars: [] },
          },
        },
        mcpServers: {
          bad: { transport: "websocket", command: "x", args: [] },
        },
        permissions: { mode: "default", allowlist: [] },
        a2a: { enabled: false },
      }),
    ).toThrow();
  });

  it("rejects illegal mcpServers key characters", () => {
    expect(() =>
      parseAppConfig({
        providers: {
          default: "openai",
          entries: {
            openai: {
              type: "openai_compatible",
              baseUrl: "https://api.openai.com/v1",
              apiKeyEnv: "OPENAI_API_KEY",
            },
          },
        },
        agents: {
          default: {
            model: "openai/gpt-4.1",
            systemPrompt: "hi",
            tools: { builtin: [], mcpServers: [], sidecars: [] },
          },
        },
        mcpServers: {
          "bad name": {
            transport: "stdio",
            command: "npx",
            args: [],
          },
        },
        permissions: { mode: "default", allowlist: [] },
        a2a: { enabled: false },
      }),
    ).toThrow(/must match/);
  });
});
