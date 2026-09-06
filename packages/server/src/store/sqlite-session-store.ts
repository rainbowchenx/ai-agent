import type {
  AgentMessage,
  SessionRecord,
  SessionStore,
} from "@agent2026/core";
import type Database from "better-sqlite3";

type SessionRow = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type StoredMessageRow = {
  id: string;
  message: AgentMessage;
  createdAt: string;
};

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    title: row.title ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class SqliteSessionStore implements SessionStore {
  constructor(private readonly db: Database.Database) {}

  async create(input?: { title?: string }): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, input?.title ?? null, now, now);
    return { id };
  }

  async get(id: string): Promise<SessionRecord | null> {
    const row = this.db
      .prepare(
        `SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?`,
      )
      .get(id) as SessionRow | undefined;
    return row ? toSessionRecord(row) : null;
  }

  async list(): Promise<SessionRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT id, title, created_at, updated_at
         FROM sessions
         ORDER BY updated_at DESC`,
      )
      .all() as SessionRow[];
    return rows.map(toSessionRecord);
  }

  async appendMessage(
    sessionId: string,
    message: AgentMessage,
  ): Promise<void> {
    await this.appendMessagesBatch(sessionId, [message]);
  }

  async appendMessagesBatch(
    sessionId: string,
    messages: AgentMessage[],
  ): Promise<void> {
    if (messages.length === 0) {
      return;
    }
    const now = new Date().toISOString();
    const write = this.db.transaction(() => {
      const updated = this.db
        .prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`)
        .run(now, sessionId);
      if (updated.changes === 0) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      const insert = this.db.prepare(
        `INSERT INTO messages (session_id, payload, created_at)
         VALUES (?, ?, ?)`,
      );
      for (const message of messages) {
        insert.run(sessionId, JSON.stringify(message), now);
      }
    });
    write();
  }

  async getMessages(sessionId: string): Promise<AgentMessage[]> {
    const rows = await this.getMessageRows(sessionId);
    return rows.map((row) => row.message);
  }

  async getMessageRows(sessionId: string): Promise<StoredMessageRow[]> {
    const rows = this.db
      .prepare(
        `SELECT id, payload, created_at
         FROM messages
         WHERE session_id = ?
         ORDER BY id ASC`,
      )
      .all(sessionId) as Array<{
      id: number;
      payload: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: String(row.id),
      message: JSON.parse(row.payload) as AgentMessage,
      createdAt: row.created_at,
    }));
  }
}
