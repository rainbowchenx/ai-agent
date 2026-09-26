import type { AppConfig } from "./config.js";

export type HealthResponse = {
  ok: true;
  version: string;
};

export type CreateSessionRequest = {
  title?: string;
};

export type CreateSessionResponse = {
  id: string;
};

export type SessionSummary = {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
};

export type ListSessionsResponse = SessionSummary[];

export type MessageRole = "user" | "assistant" | "system" | "tool";

export type MessageDto = {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
};

export type GetSessionResponse = {
  id: string;
  title?: string;
  messages: MessageDto[];
};

export type PostMessageRequest = {
  content: string;
};

export type GetConfigResponse = AppConfig;

export type PutConfigRequest = AppConfig;

export type RunWsRequest = {
  type: "run";
  sessionId: string;
  content: string;
};

export type PermissionWsResponse = {
  type: "permission_response";
  requestId: string;
  allow: boolean;
  scope?: "once" | "session";
};

export type StopRunResponse = {
  ok: true;
};

export type ListSessionRunsResponse = {
  runs: Array<{
    runId: string;
    traceId: string;
    status: "running" | "completed" | "stopped" | "error";
    createdAt: string;
    endedAt?: string;
  }>;
};

export type GetRunTraceResponse = {
  runId: string;
  traceId: string;
  status: "running" | "completed" | "stopped" | "error";
  createdAt: string;
  endedAt?: string;
  spans: Array<{
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: "generation" | "tool" | "permission";
    status?: "ok" | "error";
    startedAt: string;
    endedAt?: string;
    summary?: string;
  }>;
};

export type WsClientMessage = RunWsRequest | PermissionWsResponse;

export type McpServerStatus =
  | "connecting"
  | "ready"
  | "error"
  | "closed"
  | "disabled";

export type McpToolStatusView = {
  name: string;
  description?: string;
};

export type McpServerStatusView = {
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  status: McpServerStatus;
  toolCount: number;
  tools: McpToolStatusView[];
  lastError?: string;
};

export type ListMcpStatusResponse = McpServerStatusView[];

export type RefreshMcpResponse = {
  ok: true;
  status: McpServerStatusView;
};
