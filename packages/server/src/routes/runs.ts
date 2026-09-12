import type { FastifyInstance } from "fastify";
import type { AgentMessage, ModelPort, RunnerEvent } from "@agent2026/core";
import type {
  AppConfig,
  RunEvent,
  StopRunResponse,
  WsClientMessage,
} from "@agent2026/shared";
import { assembleRuntime } from "../assemble/runtime.js";
import type {
  SqliteSessionStore,
} from "../store/sqlite-session-store.js";
import type { SqliteTracePort } from "../store/sqlite-trace-port.js";
import { toRunEvent } from "../ws/map-run-event.js";
import type { RunHub } from "../ws/run-hub.js";

export type RunRouteDeps = {
  getConfig: () => AppConfig;
  sessionStore: SqliteSessionStore;
  tracePort: SqliteTracePort;
  hub: RunHub;
  model?: ModelPort;
  workspaceRoot: string;
  resolveCredential?: (ref: string) => string | undefined;
};

type WsSocket = {
  readyState: number;
  OPEN: number;
  send: (data: string) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
};

export function registerRunRoutes(
  app: FastifyInstance,
  deps: RunRouteDeps,
): void {
  app.post<{ Params: { runId: string } }>(
    "/runs/:runId/stop",
    async (request, reply): Promise<StopRunResponse | undefined> => {
      const aborted = deps.hub.abort(request.params.runId);
      if (!aborted) {
        await reply.code(404).send({ error: "not_found" });
        return;
      }
      return { ok: true };
    },
  );

  app.get("/ws", { websocket: true }, (socket) => {
    const ws = socket as unknown as WsSocket;
    const socketRuns = new Set<string>();

    ws.on("close", () => {
      for (const runId of socketRuns) {
        deps.hub.abort(runId);
      }
    });

    ws.on("message", (raw) => {
      void handleClientMessage(ws, raw, deps, socketRuns);
    });
  });
}

async function handleClientMessage(
  socket: WsSocket,
  raw: unknown,
  deps: RunRouteDeps,
  socketRuns: Set<string>,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawToString(raw));
  } catch {
    const runId = crypto.randomUUID();
    send(socket, { type: "error", runId, message: "invalid json" });
    send(socket, { type: "run_end", runId, reason: "error" });
    return;
  }

  if (!isWsClientMessage(parsed)) {
    const runId = crypto.randomUUID();
    send(socket, { type: "error", runId, message: "invalid message" });
    send(socket, { type: "run_end", runId, reason: "error" });
    return;
  }

  if (parsed.type === "permission_response") {
    return;
  }

  await startRun(socket, parsed, deps, socketRuns);
}

async function startRun(
  socket: WsSocket,
  request: Extract<WsClientMessage, { type: "run" }>,
  deps: RunRouteDeps,
  socketRuns: Set<string>,
): Promise<void> {
  const runId = crypto.randomUUID();
  const session = await deps.sessionStore.get(request.sessionId);
  if (!session) {
    send(socket, {
      type: "error",
      runId,
      message: `Session not found: ${request.sessionId}`,
    });
    send(socket, { type: "run_end", runId, reason: "error" });
    return;
  }

  const { traceId } = await deps.tracePort.startTrace({
    runId,
    sessionId: request.sessionId,
  });

  try {
    const controller = deps.hub.create(runId);
    socketRuns.add(runId);

    const userMessage: Extract<AgentMessage, { role: "user" }> = {
      role: "user",
      content: request.content,
    };
    const prior = await deps.sessionStore.getMessages(request.sessionId);
    await deps.sessionStore.appendMessage(request.sessionId, userMessage);

    const runtime = assembleRuntime({
      config: deps.getConfig(),
      workspaceRoot: deps.workspaceRoot,
      model: deps.model,
      resolveCredential: deps.resolveCredential,
    });

    const history: AgentMessage[] = runtime.systemPrompt
      ? [{ role: "system", content: runtime.systemPrompt }, ...prior]
      : prior;

    let pendingEnd: Extract<RunnerEvent, { type: "run_end" }> | undefined;
    const result = await runtime.runner.run({
      messages: history,
      userMessage,
      model: runtime.model,
      tools: runtime.tools,
      permissions: runtime.permissions,
      onEvent: (event: RunnerEvent) => {
        if (event.type === "run_end") {
          pendingEnd = event;
          return;
        }
        send(socket, toRunEvent(event));
      },
      signal: controller.signal,
      sessionId: request.sessionId,
      runId,
      traceId,
    });

    const skip = (runtime.systemPrompt ? 1 : 0) + prior.length + 1;
    await deps.sessionStore.appendMessagesBatch(
      request.sessionId,
      result.messages.slice(skip),
    );

    if (pendingEnd) {
      send(socket, toRunEvent(pendingEnd));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send(socket, { type: "error", runId, message });
    send(socket, { type: "run_end", runId, reason: "error" });
  } finally {
    deps.hub.forget(runId);
    socketRuns.delete(runId);
  }
}

function send(socket: WsSocket, event: RunEvent): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

function rawToString(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8");
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw as Buffer[]).toString("utf8");
  }
  return String(raw);
}

function isWsClientMessage(value: unknown): value is WsClientMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Record<string, unknown>;
  if (message.type === "run") {
    return (
      typeof message.sessionId === "string" &&
      typeof message.content === "string"
    );
  }
  if (message.type === "permission_response") {
    return (
      typeof message.requestId === "string" &&
      typeof message.allow === "boolean"
    );
  }
  return false;
}
