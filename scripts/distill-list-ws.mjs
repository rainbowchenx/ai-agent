const sessionId = process.argv[2];
const ws = new WebSocket("ws://127.0.0.1:9800/ws");
const events = [];
ws.addEventListener("open", () => {
  ws.send(JSON.stringify({
    type: "run",
    sessionId,
    content: "请依次调用：1) openviking__tree uri=viking:// level_limit=3 2) openviking__glob pattern=**/*.md 3) 若有结果再 openviking__list 合适目录。只汇报工具原文，不要编造。",
  }));
});
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString());
  events.push(msg);
  if (msg.type === "permission_request") {
    ws.send(JSON.stringify({ type: "permission_response", requestId: msg.requestId, allow: true, scope: "once" }));
  }
  if (msg.type === "run_end" || msg.type === "error") {
    const tools = events.filter(e => String(e.type).includes("tool"));
    console.log(JSON.stringify(tools, null, 2));
    ws.close();
    process.exit(msg.type === "error" || msg.reason === "error" ? 1 : 0);
  }
});
setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 180000);
