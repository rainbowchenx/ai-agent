import type { ReactNode } from "react";
import {
  Brain,
  HelpCircle,
  History,
  LayoutGrid,
  Puzzle,
  Settings,
  Sparkles,
} from "lucide-react";
import { useUiStore, type AppView } from "@/stores/ui-store";

const NAV_ITEMS: Array<{
  label: string;
  icon: typeof LayoutGrid;
  view?: AppView;
}> = [
  { label: "工作台", icon: LayoutGrid, view: "workbench" },
  { label: "工具市场", icon: Puzzle },
  { label: "任务历史", icon: History },
  { label: "记忆系统", icon: Brain },
  { label: "设置", icon: Settings, view: "settings" },
  { label: "帮助/文档", icon: HelpCircle },
];

export function AppShell({ children }: { children: ReactNode }) {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);

  return (
    <div className="app-shell" data-app-shell>
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <Sparkles className="brand-icon" aria-hidden />
          <span>Agent</span>
        </div>
        <ul className="nav-list" role="menubar">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.view === view;
            return (
              <li key={item.label}>
                <button
                  type="button"
                  role="menuitem"
                  className={`nav-item${active ? " active" : ""}`}
                  disabled={!item.view}
                  data-nav={item.label}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    if (item.view) {
                      setView(item.view);
                    }
                  }}
                >
                  <Icon aria-hidden />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="app-main">{children}</div>
    </div>
  );
}
