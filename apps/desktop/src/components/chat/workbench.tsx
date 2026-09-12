import { ChevronDown, User } from "lucide-react";
import { useSessionStore } from "@/stores/session-store";
import { useUiStore } from "@/stores/ui-store";
import { ChatPane } from "./chat-pane";
import { RunDetails } from "./run-details";
import { SessionList } from "./session-list";

export function Workbench() {
  const error = useSessionStore((s) => s.error);
  const config = useSessionStore((s) => s.config);
  const currentModel = config?.agents.default.model ?? "deepseek/deepseek-chat";
  const setView = useUiStore((s) => s.setView);

  return (
    <div className="flex h-full min-h-0 flex-col" data-workbench>
      <header className="topbar">
        <span className="topbar-title">Agent 工作台</span>
        <button type="button" className="model-switcher-trigger" disabled>
          <span className="font-mono text-xs" data-current-model>
            {currentModel}
          </span>
          <ChevronDown width={14} height={14} aria-hidden />
        </button>
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
      <div className="workbench-grid">
        <SessionList />
        <ChatPane />
        <RunDetails />
      </div>
    </div>
  );
}
