import { useEffect, useState } from "react";

type Health = { ok: boolean; version?: string };

export function App() {
  const [baseUrl, setBaseUrl] = useState<string>("loading…");
  const [health, setHealth] = useState<string>("checking…");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const url = await window.agentDesktop.getServerBaseUrl();
        if (cancelled) return;
        setBaseUrl(url);
        const res = await fetch(`${url}/health`);
        const body = (await res.json()) as Health;
        if (cancelled) return;
        setHealth(body.ok ? `ok (${body.version ?? "unknown"})` : "unhealthy");
      } catch (err) {
        if (cancelled) return;
        setHealth(err instanceof Error ? err.message : String(err));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page">
      <h1>agent2026 desktop</h1>
      <p>Electron 壳已就绪。工作台 UI 在 Task 11。</p>
      <dl>
        <dt>Server base URL</dt>
        <dd data-testid="server-base-url">{baseUrl}</dd>
        <dt>Health</dt>
        <dd data-testid="server-health">{health}</dd>
      </dl>
    </main>
  );
}
