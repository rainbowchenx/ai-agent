import type {
  AppConfig,
  CredentialInfo,
  SystemPathsResponse,
} from "@agent2026/shared";
import { create } from "zustand";
import {
  fetchConfig,
  fetchCredentials,
  fetchSystem,
  putConfig,
  putCredential,
} from "@/lib/api";
import { useSessionStore } from "@/stores/session-store";

export type ProviderSaveInput = {
  providerId: string;
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

type SettingsStore = {
  config: AppConfig | null;
  credentials: Record<string, CredentialInfo>;
  system: SystemPathsResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  saveHint: string | null;
  hydrate: (baseUrl: string) => Promise<void>;
  saveProvider: (baseUrl: string, input: ProviderSaveInput) => Promise<void>;
  saveAgent: (baseUrl: string, input: AgentSaveInput) => Promise<void>;
  savePermissions: (
    baseUrl: string,
    input: PermissionsSaveInput,
  ) => Promise<void>;
  clearHints: () => void;
};

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
      const [config, creds, system] = await Promise.all([
        fetchConfig(baseUrl),
        fetchCredentials(baseUrl),
        fetchSystem(baseUrl).catch(() => null),
      ]);
      syncSessionConfig(config);
      set({
        config,
        credentials: credentialsToMap(creds.items),
        system,
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
            [input.providerId]: {
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
        // Refresh descriptor for the ref in case env/config changed.
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
}));
