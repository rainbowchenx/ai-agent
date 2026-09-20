import type {
  PermissionWsResponse,
  RunEvent,
  RunWsRequest,
  WsClientMessage,
} from "@agent2026/shared";

const RUN_EVENT_TYPES = new Set<RunEvent["type"]>([
  "run_start",
  "message_delta",
  "tool_start",
  "tool_end",
  "permission_request",
  "error",
  "run_end",
]);

export function httpToWsUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL("ws", normalized);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function createRunMessage(
  sessionId: string,
  content: string,
): RunWsRequest {
  return { type: "run", sessionId, content };
}

export function createPermissionResponse(
  requestId: string,
  allow: boolean,
  scope?: "once" | "session",
): PermissionWsResponse {
  return {
    type: "permission_response",
    requestId,
    allow,
    ...(allow && scope === "session" ? { scope: "session" } : {}),
  };
}

export function parseRunEvent(raw: string): RunEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const type = (parsed as { type?: unknown }).type;
    if (typeof type !== "string" || !RUN_EVENT_TYPES.has(type as RunEvent["type"])) {
      return null;
    }
    return parsed as RunEvent;
  } catch {
    return null;
  }
}

export class RunSocket {
  private ws: WebSocket | null = null;
  private queue: string[] = [];
  private closed = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly getBaseUrl: () => string,
    private readonly onEvent: (event: RunEvent) => void,
  ) {}

  connect(): void {
    this.closed = false;
    this.open();
  }

  sendRun(sessionId: string, content: string): void {
    this.sendJson(createRunMessage(sessionId, content));
  }

  sendPermissionResponse(
    requestId: string,
    allow: boolean,
    scope?: "once" | "session",
  ): void {
    this.sendJson(createPermissionResponse(requestId, allow, scope));
  }

  sendJson(message: WsClientMessage): void {
    const payload = JSON.stringify(message);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
      return;
    }
    this.queue.push(payload);
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.open();
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.queue = [];
  }

  private open(): void {
    if (this.closed) {
      return;
    }
    const url = httpToWsUrl(this.getBaseUrl());
    const socket = new WebSocket(url);
    this.ws = socket;
    socket.onopen = () => {
      if (this.ws !== socket) {
        return;
      }
      for (const payload of this.queue) {
        socket.send(payload);
      }
      this.queue = [];
    };
    socket.onmessage = (event) => {
      const parsed = parseRunEvent(String(event.data));
      if (parsed) {
        this.onEvent(parsed);
      }
    };
    socket.onclose = () => {
      if (this.ws !== socket || this.closed) {
        return;
      }
      this.reconnectTimer = setTimeout(() => this.open(), 500);
    };
  }
}
