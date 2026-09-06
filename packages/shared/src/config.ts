import { parse as parseYaml } from "yaml";
import { z } from "zod";

const builtinToolNameSchema = z.enum(["http_fetch", "read_file"]);

const openaiCompatibleProviderSchema = z.object({
  type: z.literal("openai_compatible"),
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
  models: z.array(z.string().min(1)).optional(),
});

const anthropicProviderSchema = z.object({
  type: z.literal("anthropic"),
  apiKeyEnv: z.string().min(1),
  models: z.array(z.string().min(1)).optional(),
});

const providerEntrySchema = z.discriminatedUnion("type", [
  openaiCompatibleProviderSchema,
  anthropicProviderSchema,
]);

const agentToolsSchema = z.object({
  builtin: z.array(builtinToolNameSchema),
  mcpServers: z.array(z.string().min(1)),
  sidecars: z.array(z.string().min(1)),
});

const agentConfigSchema = z.object({
  model: z.string().min(1),
  systemPrompt: z.string(),
  tools: agentToolsSchema,
});

const mcpServerConfigSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()),
});

export const appConfigSchema = z
  .object({
    providers: z.object({
      default: z.string().min(1),
      entries: z.record(z.string(), providerEntrySchema),
    }),
    agents: z.object({
      default: agentConfigSchema,
    }),
    mcpServers: z.record(z.string(), mcpServerConfigSchema).optional(),
    permissions: z.object({
      mode: z.enum(["default", "ask_all", "allowlist"]),
      allowlist: z.array(z.string()),
    }),
    a2a: z.object({
      enabled: z.boolean(),
    }),
  })
  .superRefine((config, ctx) => {
    const { default: defaultProvider, entries } = config.providers;

    if (!entries[defaultProvider]) {
      ctx.addIssue({
        code: "custom",
        message: `providers.default "${defaultProvider}" must exist in providers.entries`,
        path: ["providers", "default"],
      });
    }

    const modelProvider = config.agents.default.model.split("/")[0];

    if (!entries[modelProvider]) {
      ctx.addIssue({
        code: "custom",
        message: `agents.default.model references unknown provider "${modelProvider}"`,
        path: ["agents", "default", "model"],
      });
    }

    const referencedMcpServers = config.agents.default.tools.mcpServers;

    if (referencedMcpServers.length > 0) {
      if (!config.mcpServers) {
        ctx.addIssue({
          code: "custom",
          message:
            "agents.default.tools.mcpServers references MCP servers but top-level mcpServers block is missing",
          path: ["mcpServers"],
        });
      } else {
        for (const serverName of referencedMcpServers) {
          if (!config.mcpServers[serverName]) {
            ctx.addIssue({
              code: "custom",
              message: `agents.default.tools.mcpServers references unknown mcpServers entry "${serverName}"`,
              path: ["agents", "default", "tools", "mcpServers"],
            });
          }
        }
      }
    }
  });

export type AppConfig = z.infer<typeof appConfigSchema>;
export type ProviderEntry = z.infer<typeof providerEntrySchema>;
export type BuiltinToolName = z.infer<typeof builtinToolNameSchema>;

export function defaultAppConfig(): AppConfig {
  const baseUrl =
    (typeof process !== "undefined" && process.env.OPENAI_BASE_URL) ||
    "https://api.openai.com/v1";

  return {
    providers: {
      default: "openai",
      entries: {
        openai: {
          type: "openai_compatible",
          baseUrl,
          apiKeyEnv: "OPENAI_API_KEY",
          models: ["gpt-4.1"],
        },
      },
    },
    agents: {
      default: {
        model: "openai/gpt-4.1",
        systemPrompt: "You are a helpful assistant.",
        tools: {
          builtin: ["http_fetch", "read_file"],
          mcpServers: [],
          sidecars: [],
        },
      },
    },
    permissions: {
      mode: "default",
      allowlist: [],
    },
    a2a: {
      enabled: false,
    },
  };
}

export function parseAppConfig(input: unknown): AppConfig {
  return appConfigSchema.parse(input);
}

export function parseAppConfigYaml(yamlText: string): AppConfig {
  const parsed = parseYaml(yamlText);
  return parseAppConfig(parsed);
}
