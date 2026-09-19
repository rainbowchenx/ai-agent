import type {
  AppConfig,
  GetRunTraceResponse,
  ListSessionRunsResponse,
  SessionSummary,
} from "@agent2026/shared";
import { create } from "zustand";
import {
  createSession,
  fetchConfig,
  fetchHealth,
  getRunTrace,
  getServerBaseUrl,
  getSession,
  listSessionRuns,
  listSessions,
  putConfig,
  stopRun,
} from "@/lib/api";
import { isLiveTraceSelection } from "@/lib/trace-view";
import {
  appendUserMessage,
  applyRunEvent,
  emptyProjection,
  projectionFromMessages,
  shouldApplyRunEvent,
  type RunProjection,
} from "@/lib/apply-run-event";
import { RunSocket } from "@/lib/ws-client";

type SessionRunSummary = ListSessionRunsResponse["runs"][number];

type SessionStore = {
  baseUrl: string;
  health: string;
  config: AppConfig | null;
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  run: RunProjection;
  tracePanelOpen: boolean;
  selectedTraceRunId: string | null;
  sessionRuns: SessionRunSummary[];
  historicalTrace: GetRunTraceResponse | null;
  historicalTraceLoading: boolean;
  historicalTraceError: string | null;
  ready: boolean;
  error: string | null;
  init: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshSessionRuns: () => Promise<void>;
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
  setTracePanelOpen: (open: boolean) => void;
  selectTraceRun: (runId: string | null) => Promise<void>;
  injectDemoTool: () => void;
};

let socket: RunSocket | null = null;

function clearHistoricalTraceState(): Pick<
  SessionStore,
  "historicalTrace" | "historicalTraceLoading" | "historicalTraceError"
> {
  return {
    historicalTrace: null,
    historicalTraceLoading: false,
    historicalTraceError: null,
  };
}

async function loadHistoricalTrace(
  get: () => SessionStore,
  set: (
    partial:
      | Partial<SessionStore>
      | ((state: SessionStore) => Partial<SessionStore>),
  ) => void,
  runId: string,
): Promise<void> {
  const { baseUrl } = get();
  if (!baseUrl) {
    return;
  }

  set({
    historicalTrace: null,
    historicalTraceLoading: true,
    historicalTraceError: null,
  });

  try {
    const historicalTrace = await getRunTrace(baseUrl, runId);
    const current = get();
    if (current.selectedTraceRunId !== runId) {
      return;
    }
    set({
      historicalTrace,
      historicalTraceLoading: false,
      historicalTraceError: null,
    });
  } catch (err) {
    const current = get();
    if (current.selectedTraceRunId !== runId) {
      return;
    }
    set({
      historicalTrace: null,
      historicalTraceLoading: false,
      historicalTraceError: err instanceof Error ? err.message : String(err),
    });
  }
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  baseUrl: "",
  health: "checking…",
  config: null,
  sessions: [],
  selectedSessionId: null,
  run: emptyProjection(),
  tracePanelOpen: true,
  selectedTraceRunId: null,
  sessionRuns: [],
  historicalTrace: null,
  historicalTraceLoading: false,
  historicalTraceError: null,
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
            void get().refreshSessionRuns();
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

  refreshSessionRuns: async () => {
    const { baseUrl, selectedSessionId } = get();
    if (!baseUrl || !selectedSessionId) {
      set({ sessionRuns: [] });
      return;
    }
    try {
      const response = await listSessionRuns(baseUrl, selectedSessionId);
      set({ sessionRuns: response.runs });
    } catch {
      set({ sessionRuns: [] });
    }
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
        selectedTraceRunId: null,
        sessionRuns: [],
        ...clearHistoricalTraceState(),
        error: null,
      });
      await get().refreshSessionRuns();
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

  setTracePanelOpen: (open) => {
    set({ tracePanelOpen: open });
  },

  selectTraceRun: async (runId) => {
    const { run } = get();
    set({ selectedTraceRunId: runId });

    if (isLiveTraceSelection(runId, run.runId)) {
      set(clearHistoricalTraceState());
      return;
    }

    if (!runId) {
      return;
    }

    await loadHistoricalTrace(get, set, runId);
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
