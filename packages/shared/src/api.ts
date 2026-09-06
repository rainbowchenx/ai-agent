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
};

export type StopRunResponse = {
  ok: true;
};

export type WsClientMessage = RunWsRequest | PermissionWsResponse;
