import type { AppConfig, SessionSummary } from "@agent2026/shared";
import { create } from "zustand";
import {
  createSession,
  fetchConfig,
  fetchHealth,
  getServerBaseUrl,
  getSession,
  listSessions,
  putConfig,
  stopRun,
} from "@/lib/api";
import {
  appendUserMessage,
  applyRunEvent,
  emptyProjection,
  projectionFromMessages,
  shouldApplyRunEvent,
  type RunProjection,
} from "@/lib/apply-run-event";
import { RunSocket } from "@/lib/ws-client";

type SessionStore = {
  baseUrl: string;
  health: string;
  config: AppConfig | null;
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  run: RunProjection;
  ready: boolean;
  error: string | null;
  init: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  loadConfig: () => Promise<void>;
  saveProviderSettings: (input: {
    apiBaseUrl: string;
    model: string;
    providerId?: string;
  }) => Promise<void>;
  setDefaultModel: (modelRef: string) => Promise<void>;
  createAndSelect: (title?: string) => Promise<boolean>;
  selectSession: (id: string) => Promise<void>;
  sendMessage: (content: string) => void;
  stopCurrentRun: () => Promise<void>;
  injectDemoTool: () => void;
};

let socket: RunSocket | null = null;

export const useSessionStore = create<SessionStore>((set, get) => ({
  baseUrl: "",
  health: "checking…",
  config: null,
  sessions: [],
  selectedSessionId: null,
  run: emptyProjection(),
  ready: false,
  error: null,

  init: async () => {
    try {
      const baseUrl = await getServerBaseUrl();
      set({ baseUrl });
      socket?.close();
      socket = new RunSocket(
        () => get().baseUrl,
        (event) => {
          const { selectedSessionId, run } = get();
          if (!shouldApplyRunEvent(run, event, selectedSessionId)) {
            return;
          }
          set((state) => ({ run: applyRunEvent(state.run, event) }));
          if (event.type === "run_end") {
            void get().refreshSessions();
          }
        },
      );
      socket.connect();
      try {
        const health = await fetchHealth(baseUrl);
        set({ health: health.ok ? `ok (${health.version})` : "unhealthy" });
      } catch (err) {
        set({
          health: err instanceof Error ? err.message : String(err),
        });
      }
      await get().refreshSessions();
      await get().loadConfig();
      set({ ready: true, error: null });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        ready: true,
      });
    }
  },

  refreshSessions: async () => {
    const { baseUrl } = get();
    if (!baseUrl) {
      return;
    }
    const sessions = await listSessions(baseUrl);
    set({ sessions });
  },

  loadConfig: async () => {
    const { baseUrl } = get();
    if (!baseUrl) {
      return;
    }
    try {
      const config = await fetchConfig(baseUrl);
      set({ config, error: null });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  saveProviderSettings: async ({ apiBaseUrl, model, providerId }) => {
    const { baseUrl, config } = get();
    if (!baseUrl) {
      throw new Error("Server base URL 未就绪");
    }
    const current = config ?? (await fetchConfig(baseUrl));
    const id = providerId ?? current.providers.default ?? "openai";
    const previous = current.providers.entries[id];
    const apiKeyEnv =
      previous && "apiKeyEnv" in previous
        ? previous.apiKeyEnv
        : "OPENAI_API_KEY";
    const previousModels =
      previous && "models" in previous && previous.models
        ? previous.models
        : [];
    const models = previousModels.includes(model)
      ? previousModels
      : [...previousModels, model];

    const next: AppConfig = {
      ...current,
      providers: {
        ...current.providers,
        default: id,
        entries: {
          ...current.providers.entries,
          [id]: {
            type: "openai_compatible",
            baseUrl: apiBaseUrl,
            apiKeyEnv,
            models,
          },
        },
      },
      agents: {
        ...current.agents,
        default: {
          ...current.agents.default,
          model: `${id}/${model}`,
        },
      },
    };

    const saved = await putConfig(baseUrl, next);
    set({ config: saved, error: null });
  },

  setDefaultModel: async (modelRef) => {
    const { baseUrl, config } = get();
    if (!baseUrl) {
      set({ error: "Server base URL 未就绪" });
      return;
    }
    const trimmed = modelRef.trim();
    if (!trimmed) {
      set({ error: "模型不能为空" });
      return;
    }
    try {
      const current = config ?? (await fetchConfig(baseUrl));
      if (current.agents.default.model === trimmed) {
        return;
      }

      const slash = trimmed.indexOf("/");
      const providerId = slash >= 0 ? trimmed.slice(0, slash) : trimmed;
      if (!current.providers.entries[providerId]) {
        set({ error: `未知 Provider：${providerId}` });
        return;
      }

      const next: AppConfig = {
        ...current,
        providers: {
          ...current.providers,
          default: providerId,
        },
        agents: {
          ...current.agents,
          default: {
            ...current.agents.default,
            model: trimmed,
          },
        },
      };

      const saved = await putConfig(baseUrl, next);
      set({ config: saved, error: null });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  createAndSelect: async (title) => {
    try {
      const { baseUrl } = get();
      if (!baseUrl) {
        throw new Error("Server base URL 未就绪，请打开「设置」查看 health");
      }
      const created = await createSession(baseUrl, title);
      await get().refreshSessions();
      await get().selectSession(created.id);
      set({ error: null });
      return true;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  },

  selectSession: async (id) => {
    try {
      const { baseUrl } = get();
      const session = await getSession(baseUrl, id);
      set({
        selectedSessionId: id,
        run: projectionFromMessages(id, session.messages),
        error: null,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  sendMessage: (content) => {
    const trimmed = content.trim();
    const { selectedSessionId, run: previousRun } = get();
    if (!trimmed || !selectedSessionId || !socket) {
      return;
    }
    set((state) => ({
      run: {
        ...appendUserMessage(state.run, trimmed),
        status: "running",
        runId: null,
        traceId: null,
      },
      error: null,
    }));
    try {
      socket.sendRun(selectedSessionId, trimmed);
    } catch (err) {
      set({
        run: previousRun,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  stopCurrentRun: async () => {
    const { baseUrl, run } = get();
    if (run.status !== "running" || !run.runId) {
      return;
    }
    try {
      await stopRun(baseUrl, run.runId);
      set({ error: null });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  injectDemoTool: () => {
    const runId = get().run.runId ?? "demo-run";
    set((state) => {
      let next = applyRunEvent(state.run, {
        type: "tool_start",
        runId,
        toolCallId: "demo-read-file",
        name: "read_file",
        arguments: { path: "README.md" },
      });
      next = applyRunEvent(next, {
        type: "tool_end",
        runId,
        toolCallId: "demo-read-file",
        name: "read_file",
        result: "# demo\nplaceholder tool card (no model call)",
      });
      return { run: next };
    });
  },
}));
