import type { AppConfig } from "@agent2026/shared";
import { ChevronDown, User } from "lucide-react";
import { useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useUiStore } from "@/stores/ui-store";
import { ChatPane } from "./chat-pane";
import { RunDetails } from "./run-details";
import { SessionList } from "./session-list";

function collectModelOptions(
  config: AppConfig | null,
  currentModel: string,
): string[] {
  const fromConfig = config
    ? Object.entries(config.providers.entries).flatMap(([pid, entry]) =>
        (entry.models ?? []).map((m) => `${pid}/${m}`),
      )
    : [];
  const set = new Set(fromConfig);
  if (currentModel) {
    set.add(currentModel);
  }
  return [...set];
}

export function Workbench() {
  const error = useSessionStore((s) => s.error);
  const config = useSessionStore((s) => s.config);
  const tracePanelOpen = useSessionStore((s) => s.tracePanelOpen);
  const setDefaultModel = useSessionStore((s) => s.setDefaultModel);
  const currentModel = config?.agents.default.model ?? "deepseek/deepseek-chat";
  const setView = useUiStore((s) => s.setView);
  const [switching, setSwitching] = useState(false);
  const modelOptions = collectModelOptions(config, currentModel);

  const onModelChange = async (next: string) => {
    if (!next || next === currentModel || switching) {
      return;
    }
    setSwitching(true);
    try {
      await setDefaultModel(next);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-workbench>
      <header className="topbar">
        <span className="topbar-title">Agent 工作台</span>
        <label className="model-switcher-trigger">
          <select
            className="model-switcher-select font-mono text-xs"
            value={currentModel}
            disabled={!config || switching}
            aria-label="选择默认模型"
            data-current-model={currentModel}
            onChange={(e) => {
              void onModelChange(e.target.value);
            }}
          >
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <ChevronDown width={14} height={14} aria-hidden />
        </label>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-open-settings
          onClick={() => setView("settings")}
        >
          设置
        </button>
        <button type="button" className="avatar" aria-label="用户菜单">
          <User />
        </button>
      </header>
      {error ? (
        <p
          className="border-b px-7 py-2 text-sm"
          style={{
            borderColor: "var(--border)",
            color: "var(--destructive)",
            background: "color-mix(in srgb, var(--destructive) 10%, transparent)",
          }}
          data-app-error
        >
          {error}
        </p>
      ) : null}
      <div
        className={`workbench-grid${tracePanelOpen ? " trace-visible" : " trace-collapsed"}`}
        data-trace-visible={tracePanelOpen}
      >
        <SessionList />
        <ChatPane />
        {tracePanelOpen ? <RunDetails /> : null}
      </div>
    </div>
  );
}
