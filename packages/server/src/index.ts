import { createApp } from "./app.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 8787;

const app = await createApp();
await app.listen({ host: HOST, port: PORT });
console.log(`agent2026 server listening on http://${HOST}:${PORT}`);
