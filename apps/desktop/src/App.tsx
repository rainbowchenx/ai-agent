import { useEffect } from "react";
import { Workbench } from "@/components/chat/workbench";
import { useSessionStore } from "@/stores/session-store";

export function App() {
  const init = useSessionStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  return <Workbench />;
}
