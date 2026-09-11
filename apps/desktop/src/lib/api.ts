import type {
  AppConfig,
  CreateSessionResponse,
  GetSessionResponse,
  HealthResponse,
  ListSessionsResponse,
  StopRunResponse,
} from "@agent2026/shared";

export async function getServerBaseUrl(): Promise<string> {
  return window.agentDesktop.getServerBaseUrl();
}

export async function fetchHealth(baseUrl: string): Promise<HealthResponse> {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) {
    throw new Error(`health ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}

export async function fetchConfig(baseUrl: string): Promise<AppConfig> {
  const res = await fetch(`${baseUrl}/config`);
  if (!res.ok) {
    throw new Error(`get config ${res.status}`);
  }
  return (await res.json()) as AppConfig;
}

export async function putConfig(
  baseUrl: string,
  config: AppConfig,
): Promise<AppConfig> {
  const res = await fetch(`${baseUrl}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`put config ${res.status}${text ? ` — ${text}` : ""}`);
  }
  return (await res.json()) as AppConfig;
}

export async function listSessions(
  baseUrl: string,
): Promise<ListSessionsResponse> {
  const res = await fetch(`${baseUrl}/sessions`);
  if (!res.ok) {
    throw new Error(`list sessions ${res.status}`);
  }
  return (await res.json()) as ListSessionsResponse;
}

export async function createSession(
  baseUrl: string,
  title?: string,
): Promise<CreateSessionResponse> {
  const res = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!res.ok) {
    throw new Error(`create session ${res.status}`);
  }
  return (await res.json()) as CreateSessionResponse;
}

export async function getSession(
  baseUrl: string,
  id: string,
): Promise<GetSessionResponse> {
  const res = await fetch(`${baseUrl}/sessions/${id}`);
  if (!res.ok) {
    throw new Error(`get session ${res.status}`);
  }
  return (await res.json()) as GetSessionResponse;
}

export async function stopRun(
  baseUrl: string,
  runId: string,
): Promise<StopRunResponse> {
  const res = await fetch(`${baseUrl}/runs/${runId}/stop`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`stop run ${res.status}`);
  }
  return (await res.json()) as StopRunResponse;
}
