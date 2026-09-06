import type { AgentMessage } from "../types/messages.js";

export interface SessionRecord {
  id: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionStore {
  create(input?: { title?: string }): Promise<{ id: string }>;
  get(id: string): Promise<SessionRecord | null>;
  list(): Promise<SessionRecord[]>;
  appendMessage(sessionId: string, message: AgentMessage): Promise<void>;
  getMessages(sessionId: string): Promise<AgentMessage[]>;
}
