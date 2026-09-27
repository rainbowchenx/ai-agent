import type {
  AppConfig,
  CredentialInfo,
  DistillStatusView,
  McpServerConfig,
  McpServerStatusView,
  OpenVikingStatusView,
  SystemPathsResponse,
} from "@agent2026/shared";
import { create } from "zustand";
import {
  fetchConfig,
  fetchCredentials,
  fetchDistillStatus,
  fetchMcpStatus,
  fetchOpenVikingStatus,
  fetchSystem,
  putConfig,
  putCredential,
  refreshMcpServer,
  retryOpenViking,
} from "@/lib/api";
import { useSessionStore } from "@/stores/session-store";

const OPENVIKING_SERVER_NAME = "openviking";
const OPENVIKING_MCP_URL = "http://127.0.0.1:1933/mcp";

export type ProviderSaveInput = {
  providerId: string;
  format: "openai_compatible" | "anthropic";
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  models?: string[];
  apiKey?: string;
};

export type AgentSaveInput = {
  systemPrompt: string;
  builtin: Array<"http_fetch" | "read_file">;
  maxTurns?: number;
  maxToolCalls?: number | null;
};

export type PermissionsSaveInput = {
  mode: "default" | "ask_all" | "allowlist";
  allowlist: string[];
};

export type McpServerSaveInput = {
  /** Original name when editing; empty for create. */
  previousName?: string;
  name: string;
  config: McpServerConfig;
  mount: boolean;
};

export type OpenVikingEmbeddingSaveInput = {
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  dimension?: number;
  apiKey?: string;
};

export type OpenVikingOverridesInput = {
  vlmModel: string;
};

type SettingsStore = {
  config: AppConfig | null;
  credentials: Record<string, CredentialInfo>;
  system: SystemPathsResponse | null;
  mcpStatus: McpServerStatusView[];
  openVikingStatus: OpenVikingStatusView | null;
  distillStatus: DistillStatusView | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  saveHint: string | null;
  hydrate: (baseUrl: string) => Promise<void>;
  refreshMcpStatus: (baseUrl: string) => Promise<void>;
  refreshOpenVikingStatus: (baseUrl: string) => Promise<void>;
  retryOpenVikingStatus: (baseUrl: string) => Promise<void>;
  setOpenVikingEnabled: (baseUrl: string, enabled: boolean) => Promise<void>;
  setAutoDistill: (baseUrl: string, enabled: boolean) => Promise<void>;
  saveOpenVikingEmbedding: (
    baseUrl: string,
    input: OpenVikingEmbeddingSaveInput,
  ) => Promise<void>;
  saveOpenVikingOverrides: (
    baseUrl: string,
    input: OpenVikingOverridesInput,
  ) => Promise<void>;
  saveProvider: (baseUrl: string, input: ProviderSaveInput) => Promise<void>;
  saveAgent: (baseUrl: string, input: AgentSaveInput) => Promise<void>;
  savePermissions: (
    baseUrl: string,
    input: PermissionsSaveInput,
  ) => Promise<void>;
  saveMcpServer: (baseUrl: string, input: McpServerSaveInput) => Promise<void>;
  deleteMcpServer: (baseUrl: string, name: string) => Promise<void>;
  setMcpEnabled: (
    baseUrl: string,
    name: string,
    enabled: boolean,
  ) => Promise<void>;
  refreshMcpTools: (baseUrl: string, name: string) => Promise<void>;
  clearHints: () => void;
};

/** Serialize openviking; never write deprecated flat embedding keys. */
function serializeOpenViking(ov: {
  embedding?: NonNullable<AppConfig["openviking"]>["embedding"];
  vlmModel?: string;
  autoDistill?: boolean;
}): AppConfig["openviking"] | undefined {
  const next: {
    embedding?: NonNullable<AppConfig["openviking"]>["embedding"];
    vlmModel?: string;
    autoDistill?: boolean;
  } = {};
  if (
    ov.embedding?.baseUrl &&
    ov.embedding.model &&
    ov.embedding.apiKeyEnv
  ) {
    next.embedding = {
      baseUrl: ov.embedding.baseUrl,
      model: ov.embedding.model,
      apiKeyEnv: ov.embedding.apiKeyEnv,
      ...(ov.embedding.dimension != null
        ? { dimension: ov.embedding.dimension }
        : {}),
      ...(ov.embedding.provider ? { provider: ov.embedding.provider } : {}),
    };
  }
  if (ov.vlmModel) {
    next.vlmModel = ov.vlmModel;
  }
  if (typeof ov.autoDistill === "boolean") {
    next.autoDistill = ov.autoDistill;
  }
  return Object.keys(next).length > 0
    ? (next as AppConfig["openviking"])
    : undefined;
}

function credentialsToMap(items: CredentialInfo[]): Record<string, CredentialInfo> {
  const map: Record<string, CredentialInfo> = {};
  for (const item of items) {
    map[item.ref] = item;
  }
  return map;
}

function syncSessionConfig(config: AppConfig): void {
  useSessionStore.setState({ config });
}

function ensureConfig(config: AppConfig | null): AppConfig {
  if (!config) {
    throw new Error("配置尚未加载");
  }
  return config;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  config: null,
  credentials: {},
  system: null,
  mcpStatus: [],
  openVikingStatus: null,
  distillStatus: null,
  loading: false,
  saving: false,
  error: null,
  saveHint: null,

  clearHints: () => set({ error: null, saveHint: null }),

  hydrate: async (baseUrl) => {
    if (!baseUrl) {
      return;
    }
    set({ loading: true, error: null });
    try {
      const [config, creds, system, mcpStatus, openVikingStatus, distillStatus] =
        await Promise.all([
          fetchConfig(baseUrl),
          fetchCredentials(baseUrl),
          fetchSystem(baseUrl).catch(() => null),
          fetchMcpStatus(baseUrl).catch(() => [] as McpServerStatusView[]),
          fetchOpenVikingStatus(baseUrl).catch(() => null),
          fetchDistillStatus(baseUrl).catch(() => null),
        ]);
      syncSessionConfig(config);
      set({
        config,
        credentials: credentialsToMap(creds.items),
        system,
        mcpStatus,
        openVikingStatus,
        distillStatus,
        loading: false,
        error: null,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  refreshMcpStatus: async (baseUrl) => {
    try {
      const mcpStatus = await fetchMcpStatus(baseUrl);
      set({ mcpStatus });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  refreshOpenVikingStatus: async (baseUrl) => {
    try {
      const openVikingStatus = await fetchOpenVikingStatus(baseUrl);
      set({ openVikingStatus });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  retryOpenVikingStatus: async (baseUrl) => {
    set({ saving: true, error: null, saveHint: null });
    try {
      const openVikingStatus = await retryOpenViking(baseUrl);
      const mcpStatus = await fetchMcpStatus(baseUrl).catch(
        () => get().mcpStatus,
      );
      set({
        openVikingStatus,
        mcpStatus,
        saving: false,
        saveHint: "已重试 OpenViking",
        error: null,
      });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  setOpenVikingEnabled: async (baseUrl, enabled) => {
    const current = ensureConfig(get().config);
    set({ saving: true, error: null, saveHint: null });
    try {
      const servers = { ...(current.mcpServers ?? {}) };
      const existing = servers[OPENVIKING_SERVER_NAME];
      if (enabled) {
        servers[OPENVIKING_SERVER_NAME] = {
          transport: "http",
          url: OPENVIKING_MCP_URL,
          httpSubtype: "streamable",
          enabled: true,
          ...(existing && existing.transport === "http" && existing.headers
            ? { headers: existing.headers }
            : {}),
        };
      } else if (existing) {
        servers[OPENVIKING_SERVER_NAME] = { ...existing, enabled: false };
      } else {
        servers[OPENVIKING_SERVER_NAME] = {
          transport: "http",
          url: OPENVIKING_MCP_URL,
          httpSubtype: "streamable",
          enabled: false,
        };
      }

      let mounted = [...current.agents.default.tools.mcpServers];
      if (enabled) {
        if (!mounted.includes(OPENVIKING_SERVER_NAME)) {
          mounted = [...mounted, OPENVIKING_SERVER_NAME];
        }
      }

      const next: AppConfig = {
        ...current,
        mcpServers: servers,
        agents: {
          ...current.agents,
          default: {
            ...current.agents.default,
            tools: {
              ...current.agents.default.tools,
              mcpServers: mounted,
            },
          },
        },
      };
      const saved = await putConfig(baseUrl, next);
      const openVikingStatus = enabled
        ? await retryOpenViking(baseUrl).catch(() =>
            fetchOpenVikingStatus(baseUrl),
          )
        : await fetchOpenVikingStatus(baseUrl).catch(
            () => get().openVikingStatus,
          );
      const mcpStatus = await fetchMcpStatus(baseUrl).catch(
        () => get().mcpStatus,
      );
      syncSessionConfig(saved);
      set({
        config: saved,
        openVikingStatus,
        mcpStatus,
        saving: false,
        saveHint: enabled
          ? "已启用 OpenViking，正在准备…"
          : "已禁用 OpenViking",
        error: null,
      });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  setAutoDistill: async (baseUrl, enabled) => {
    const current = ensureConfig(get().config);
    set({ saving: true, error: null, saveHint: null });
    try {
      const next: AppConfig = {
        ...current,
        openviking: serializeOpenViking({
          embedding: current.openviking?.embedding,
          vlmModel: current.openviking?.vlmModel,
          autoDistill: enabled,
        }),
      };
      const saved = await putConfig(baseUrl, next);
      const distillStatus = await fetchDistillStatus(baseUrl).catch(
        () => get().distillStatus,
      );
      syncSessionConfig(saved);
      set({
        config: saved,
        distillStatus,
        saving: false,
        saveHint: enabled ? "已开启自动提炼" : "已关闭自动提炼",
        error: null,
      });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  saveOpenVikingEmbedding: async (baseUrl, input) => {
    const current = ensureConfig(get().config);
    set({ saving: true, error: null, saveHint: null });
    try {
      const embBaseUrl = input.baseUrl.trim();
      const model = input.model.trim();
      const apiKeyEnv = input.apiKeyEnv.trim();
      if (!embBaseUrl || !model || !apiKeyEnv) {
        throw new Error("请填写 Embedding 的 Base URL、模型名与 API Key 环境变量");
      }
      const next: AppConfig = {
        ...current,
        openviking: serializeOpenViking({
          embedding: {
            baseUrl: embBaseUrl,
            model,
            apiKeyEnv,
            ...(input.dimension != null && input.dimension > 0
              ? { dimension: input.dimension }
              : {}),
          },
          vlmModel: current.openviking?.vlmModel,
          autoDistill: current.openviking?.autoDistill,
        }),
      };
      const saved = await putConfig(baseUrl, next);
      let credentials = get().credentials;
      const trimmedKey = input.apiKey?.trim();
      if (trimmedKey) {
        const info = await putCredential(baseUrl, apiKeyEnv, trimmedKey);
        credentials = { ...credentials, [info.ref]: info };
      } else {
        try {
          const list = await fetchCredentials(baseUrl);
          credentials = credentialsToMap(list.items);
        } catch {
          // keep previous map
        }
      }
      const openVikingStatus = await retryOpenViking(baseUrl).catch(() =>
        fetchOpenVikingStatus(baseUrl),
      );
      syncSessionConfig(saved);
      set({
        config: saved,
        credentials,
        openVikingStatus,
        saving: false,
        saveHint: "已保存 Embedding 配置",
        error: null,
      });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  saveOpenVikingOverrides: async (baseUrl, input) => {
    const current = ensureConfig(get().config);
    set({ saving: true, error: null, saveHint: null });
    try {
      const vlmModel = input.vlmModel.trim();
      const next: AppConfig = {
        ...current,
        openviking: serializeOpenViking({
          embedding: current.openviking?.embedding,
          vlmModel: vlmModel || undefined,
          autoDistill: current.openviking?.autoDistill,
        }),
      };
      const saved = await putConfig(baseUrl, next);
      const openVikingStatus = await fetchOpenVikingStatus(baseUrl).catch(
        () => get().openVikingStatus,
      );
      syncSessionConfig(saved);
      set({
        config: saved,
        openVikingStatus,
        saving: false,
        saveHint: "已保存 VLM 覆盖",
        error: null,
      });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  saveProvider: async (baseUrl, input) => {
    const current = ensureConfig(get().config);
    set({ saving: true, error: null, saveHint: null });
    try {
      const previous = current.providers.entries[input.providerId];
      const previousModels =
        previous && "models" in previous && previous.models
          ? previous.models
          : [];
      const modelName = input.model.includes("/")
        ? input.model.slice(input.model.indexOf("/") + 1)
        : input.model;
      const seedModels = input.models ?? previousModels;
      const models = seedModels.includes(modelName)
        ? seedModels
        : [...seedModels, modelName];

      const next: AppConfig = {
        ...current,
        providers: {
          ...current.providers,
          default: input.providerId,
          entries: {
            ...current.providers.entries,
            [input.providerId]:
              input.format === "anthropic"
                ? {
                    type: "anthropic",
                    baseUrl: input.baseUrl,
                    apiKeyEnv: input.apiKeyEnv,
                    models,
                  }
                : {
                    type: "openai_compatible",
                    baseUrl: input.baseUrl,
                    apiKeyEnv: input.apiKeyEnv,
                    models,
                  },
          },
        },
        agents: {
          ...current.agents,
          default: {
            ...current.agents.default,
            model: input.model.includes("/")
              ? input.model
              : `${input.providerId}/${modelName}`,
          },
        },
      };

      const saved = await putConfig(baseUrl, next);
      let credentials = get().credentials;

      const trimmedKey = input.apiKey?.trim();
      if (trimmedKey) {
        const info = await putCredential(baseUrl, input.apiKeyEnv, trimmedKey);
        credentials = { ...credentials, [info.ref]: info };
      } else {
        try {
          const list = await fetchCredentials(baseUrl);
          credentials = credentialsToMap(list.items);
        } catch {
          // keep previous map
        }
      }

      syncSessionConfig(saved);
      set({
        config: saved,
        credentials,
        saving: false,
        saveHint: "已保存，下一轮对话生效",
        error: null,
      });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  saveAgent: async (baseUrl, input) => {
    const current = ensureConfig(get().config);
    set({ saving: true, error: null, saveHint: null });
    try {
      const next: AppConfig = {
        ...current,
        agents: {
          ...current.agents,
          default: {
            ...current.agents.default,
            systemPrompt: input.systemPrompt,
            tools: {
              ...current.agents.default.tools,
              builtin: input.builtin,
            },
            maxTurns: input.maxTurns,
            maxToolCalls: input.maxToolCalls,
          },
        },
      };
      const saved = await putConfig(baseUrl, next);
      syncSessionConfig(saved);
      set({
        config: saved,
        saving: false,
        saveHint: "已保存，下一轮对话生效",
        error: null,
      });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  savePermissions: async (baseUrl, input) => {
    const current = ensureConfig(get().config);
    set({ saving: true, error: null, saveHint: null });
    try {
      const next: AppConfig = {
        ...current,
        permissions: {
          mode: input.mode,
          allowlist: input.allowlist,
        },
      };
      const saved = await putConfig(baseUrl, next);
      syncSessionConfig(saved);
      set({
        config: saved,
        saving: false,
        saveHint: "已保存，下一轮对话生效",
        error: null,
      });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  saveMcpServer: async (baseUrl, input) => {
    const current = ensureConfig(get().config);
    set({ saving: true, error: null, saveHint: null });
    try {
      const servers = { ...(current.mcpServers ?? {}) };
      const previousName = input.previousName;
      if (previousName && previousName !== input.name) {
        delete servers[previousName];
      }
      servers[input.name] = input.config;

      let mounted = [...current.agents.default.tools.mcpServers];
      if (previousName && previousName !== input.name) {
        mounted = mounted.map((name) =>
          name === previousName ? input.name : name,
        );
      }
      if (input.mount) {
        if (!mounted.includes(input.name)) {
          mounted.push(input.name);
        }
      } else {
        mounted = mounted.filter((name) => name !== input.name);
      }

      const next: AppConfig = {
        ...current,
        mcpServers: servers,
        agents: {
          ...current.agents,
          default: {
            ...current.agents.default,
            tools: {
              ...current.agents.default.tools,
              mcpServers: mounted,
            },
          },
        },
      };
      const saved = await putConfig(baseUrl, next);
      const mcpStatus = await fetchMcpStatus(baseUrl).catch(
        () => get().mcpStatus,
      );
      syncSessionConfig(saved);
      set({
        config: saved,
        mcpStatus,
        saving: false,
        saveHint: "MCP 已保存，连接状态见下方",
        error: null,
      });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  deleteMcpServer: async (baseUrl, name) => {
    const current = ensureConfig(get().config);
    set({ saving: true, error: null, saveHint: null });
    try {
      const servers = { ...(current.mcpServers ?? {}) };
      delete servers[name];
      const next: AppConfig = {
        ...current,
        mcpServers: Object.keys(servers).length > 0 ? servers : undefined,
        agents: {
          ...current.agents,
          default: {
            ...current.agents.default,
            tools: {
              ...current.agents.default.tools,
              mcpServers: current.agents.default.tools.mcpServers.filter(
                (entry) => entry !== name,
              ),
            },
          },
        },
      };
      const saved = await putConfig(baseUrl, next);
      const mcpStatus = await fetchMcpStatus(baseUrl).catch(
        () => get().mcpStatus,
      );
      syncSessionConfig(saved);
      set({
        config: saved,
        mcpStatus,
        saving: false,
        saveHint: "已删除 MCP Server",
        error: null,
      });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  setMcpEnabled: async (baseUrl, name, enabled) => {
    const current = ensureConfig(get().config);
    const server = current.mcpServers?.[name];
    if (!server) {
      throw new Error(`未知 MCP Server: ${name}`);
    }
    set({ saving: true, error: null, saveHint: null });
    try {
      const next: AppConfig = {
        ...current,
        mcpServers: {
          ...current.mcpServers,
          [name]: { ...server, enabled },
        },
      };
      const saved = await putConfig(baseUrl, next);
      const mcpStatus = await fetchMcpStatus(baseUrl).catch(
        () => get().mcpStatus,
      );
      syncSessionConfig(saved);
      set({
        config: saved,
        mcpStatus,
        saving: false,
        saveHint: enabled ? "已启用，正在连接…" : "已禁用并断开",
        error: null,
      });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  refreshMcpTools: async (baseUrl, name) => {
    set({ saving: true, error: null, saveHint: null });
    try {
      await refreshMcpServer(baseUrl, name);
      const mcpStatus = await fetchMcpStatus(baseUrl);
      set({
        mcpStatus,
        saving: false,
        saveHint: `已刷新 ${name} 工具列表`,
        error: null,
      });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
}));
