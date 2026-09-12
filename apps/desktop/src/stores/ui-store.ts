import { create } from "zustand";

export type AppView = "workbench" | "settings";
export type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "agent2026.theme";

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return mode;
}

export function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("light", resolved === "light");
  document.documentElement.dataset.theme = resolved;
  if (resolved === "dark") {
    document.documentElement.classList.add("dark");
    document.documentElement.classList.remove("light");
  } else {
    document.documentElement.classList.add("light");
    document.documentElement.classList.remove("dark");
  }
}

type UiStore = {
  view: AppView;
  theme: ThemeMode;
  settingsSection: string;
  setView: (view: AppView) => void;
  setTheme: (theme: ThemeMode) => void;
  setSettingsSection: (id: string) => void;
  hydrateTheme: () => void;
};

export const useUiStore = create<UiStore>((set) => ({
  view: "workbench",
  theme: "dark",
  settingsSection: "provider",
  setView: (view) => set({ view }),
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  hydrateTheme: () => {
    const raw = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    const theme =
      raw === "light" || raw === "dark" || raw === "system" ? raw : "dark";
    applyTheme(theme);
    set({ theme });
  },
}));
