import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { SettingsPage } from "@/components/settings/settings-page";
import { Workbench } from "@/components/chat/workbench";
import { useSessionStore } from "@/stores/session-store";
import { useUiStore } from "@/stores/ui-store";

export function App() {
  const init = useSessionStore((s) => s.init);
  const view = useUiStore((s) => s.view);
  const hydrateTheme = useUiStore((s) => s.hydrateTheme);

  useEffect(() => {
    hydrateTheme();
    void init();
  }, [hydrateTheme, init]);

  return (
    <AppShell>
      {view === "settings" ? <SettingsPage /> : <Workbench />}
    </AppShell>
  );
}
