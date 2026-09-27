const sessionId = process.argv[2];
const content =
  process.argv[3] ??
  "请记住我的偏好：以后默认用 pnpm 作为包管理器，不要用 npm。只确认收到，不要调用工具。";

if (!sessionId) {
  console.error("usage: node distill-smoke-ws.mjs <sessionId> [content]");
  process.exit(1);
}

const ws = new WebSocket("ws://127.0.0.1:9800/ws");
const events = [];

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "run", sessionId, content }));
});

ws.addEventListener("message", (ev) => {
  const raw =
    typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString();
  const msg = JSON.parse(raw);
  events.push(msg);

  if (msg.type === "permission_request") {
    ws.send(
      JSON.stringify({
        type: "permission_response",
        requestId: msg.requestId,
        allow: true,
        scope: "once",
      }),
    );
  }

  if (msg.type === "run_end" || msg.type === "error") {
    const types = events.map(
      (e) =>
        e.type +
        (e.reason ? `:${e.reason}` : "") +
        (e.toolName ? `:${e.toolName}` : ""),
    );
    console.log("EVENT_TYPES", types.join(" | "));
    console.log("FINAL", JSON.stringify(msg, null, 2));
    ws.close();
    process.exit(msg.type === "error" || msg.reason === "error" ? 1 : 0);
  }
});

ws.addEventListener("error", (e) => {
  console.error("WSERR", e);
  process.exit(1);
});

setTimeout(() => {
  console.error("TIMEOUT");
  console.log(JSON.stringify(events.slice(-30), null, 2));
  process.exit(2);
}, 180000);
