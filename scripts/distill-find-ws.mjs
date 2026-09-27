const sessionId = process.argv[2];
if (!sessionId) {
  console.error("usage: node distill-find-ws.mjs <sessionId>");
  process.exit(1);
}

const ws = new WebSocket("ws://127.0.0.1:9800/ws");
const events = [];

ws.addEventListener("open", () => {
  ws.send(
    JSON.stringify({
      type: "run",
      sessionId,
      content:
        "请调用工具 openviking__find 或 openviking__search，查询关键词「pnpm」。把工具返回的原文（含任何匹配记忆）完整告诉我，不要编造。",
    }),
  );
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
        (e.name ? `:${e.name}` : "") +
        (e.toolName ? `:${e.toolName}` : ""),
    );
    console.log("EVENT_TYPES", types.join(" | "));
    const tools = events.filter(
      (e) =>
        String(e.type).includes("tool") ||
        String(e.name || "").includes("openviking") ||
        String(e.toolName || "").includes("openviking"),
    );
    console.log("TOOL_EVENTS", JSON.stringify(tools, null, 2));
    const deltas = events
      .filter((e) => e.type === "message_delta")
      .map((e) => e.delta || e.content || "")
      .join("");
    console.log("ASSISTANT_TEXT", deltas);
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
  console.log(JSON.stringify(events.slice(-40), null, 2));
  process.exit(2);
}, 180000);
