import type { FastifyInstance } from "fastify";
import type { AgentMessage } from "@agent2026/core";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  GetSessionResponse,
  ListSessionsResponse,
  MessageDto,
  SessionSummary,
} from "@agent2026/shared";
import type {
  SqliteSessionStore,
  StoredMessageRow,
} from "../store/sqlite-session-store.js";

export type SessionsRouteDeps = {
  sessionStore: SqliteSessionStore;
};

export function registerSessionsRoutes(
  app: FastifyInstance,
  deps: SessionsRouteDeps,
): void {
  const { sessionStore } = deps;

  app.post<{ Body: CreateSessionRequest | undefined }>(
    "/sessions",
    async (request): Promise<CreateSessionResponse> => {
      const title = request.body?.title;
      return sessionStore.create(title ? { title } : undefined);
    },
  );

  app.get("/sessions", async (): Promise<ListSessionsResponse> => {
    const sessions = await sessionStore.list();
    return sessions.map(toSessionSummary);
  });

  app.get<{ Params: { id: string } }>(
    "/sessions/:id",
    async (request, reply): Promise<GetSessionResponse | undefined> => {
      const session = await sessionStore.get(request.params.id);
      if (!session) {
        await reply.code(404).send({ error: "not_found" });
        return;
      }
      const rows = await sessionStore.getMessageRows(session.id);
      return {
        id: session.id,
        title: session.title,
        messages: rows.map(toMessageDto),
      };
    },
  );
}

function toSessionSummary(session: {
  id: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
}): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

function toMessageDto(row: StoredMessageRow): MessageDto {
  return {
    id: row.id,
    role: row.message.role,
    content: messageContent(row.message),
    createdAt: row.createdAt,
  };
}

function messageContent(message: AgentMessage): string {
  if (
    message.role === "assistant" &&
    message.toolCalls?.length &&
    !message.content
  ) {
    return JSON.stringify(message.toolCalls);
  }
  return message.content;
}
