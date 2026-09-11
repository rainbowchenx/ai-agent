import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { defaultAppConfig } from "@agent2026/shared";
import type {
  CreateSessionResponse,
  GetConfigResponse,
  GetSessionResponse,
  HealthResponse,
  ListSessionsResponse,
} from "@agent2026/shared";
import { createApp } from "./app.js";
import { openSqlite } from "./db/sqlite.js";
import { SqliteSessionStore } from "./store/sqlite-session-store.js";

describe("Fastify app", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  async function freshApp() {
    dir = await mkdtemp(join(tmpdir(), "agent2026-app-"));
    const app = await createApp({
      configPath: join(dir, "config.yaml"),
      dbPath: join(dir, "data.sqlite"),
    });
    return app;
  }

  it("GET /health returns ok and version", async () => {
    const app = await freshApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<HealthResponse>();
    expect(body.ok).toBe(true);
    expect(body.version).toEqual(expect.any(String));
    expect(body.version.length).toBeGreaterThan(0);
  });

  it("CORS allows Electron vite origin", async () => {
    const app = await freshApp();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/sessions",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
      },
    });
    await app.close();

    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
  });

  it("writes defaultAppConfig when config.yaml is missing", async () => {
    const app = await freshApp();
    const res = await app.inject({ method: "GET", url: "/config" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<GetConfigResponse>();
    const expected = defaultAppConfig();
    expect(body).toEqual(expected);
    expect(JSON.stringify(body)).not.toMatch(/sk-|apiKey":\s*"[^"]{8,}/);

    const written = await readFile(join(dir, "config.yaml"), "utf8");
    expect(written).toContain("apiKeyEnv");
    expect(written).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(written).not.toContain("apiKey:");
  });

  it("loads an existing config.yaml instead of overwriting it", async () => {
    dir = await mkdtemp(join(tmpdir(), "agent2026-app-"));
    const existing = defaultAppConfig();
    existing.agents.default.systemPrompt = "loaded from disk";
    await writeFile(join(dir, "config.yaml"), stringifyYaml(existing), "utf8");

    const app = await createApp({
      configPath: join(dir, "config.yaml"),
      dbPath: join(dir, "data.sqlite"),
    });
    const res = await app.inject({ method: "GET", url: "/config" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json<GetConfigResponse>().agents.default.systemPrompt).toBe(
      "loaded from disk",
    );
  });

  it("PUT /config validates, persists, and never stores plaintext keys", async () => {
    const app = await freshApp();
    const next = defaultAppConfig();
    next.agents.default.systemPrompt = "updated via put";

    const invalid = await app.inject({
      method: "PUT",
      url: "/config",
      payload: { providers: { default: "openai", entries: {} } },
    });
    expect(invalid.statusCode).toBe(400);

    const ok = await app.inject({
      method: "PUT",
      url: "/config",
      payload: next,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<GetConfigResponse>().agents.default.systemPrompt).toBe(
      "updated via put",
    );

    const got = await app.inject({ method: "GET", url: "/config" });
    await app.close();
    expect(got.json<GetConfigResponse>()).toEqual(next);

    const written = await readFile(join(dir, "config.yaml"), "utf8");
    expect(written).toContain("updated via put");
    expect(written).toContain("apiKeyEnv: OPENAI_API_KEY");
    expect(written).not.toContain("apiKey:");
  });

  it("POST /sessions creates a session and lists it", async () => {
    const app = await freshApp();
    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "first chat" },
    });
    expect(created.statusCode).toBe(200);
    const { id } = created.json<CreateSessionResponse>();
    expect(id).toEqual(expect.any(String));
    expect(id.length).toBeGreaterThan(0);

    const listed = await app.inject({ method: "GET", url: "/sessions" });
    await app.close();

    expect(listed.statusCode).toBe(200);
    const sessions = listed.json<ListSessionsResponse>();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id,
      title: "first chat",
    });
    expect(sessions[0]?.createdAt).toEqual(expect.any(String));
    expect(sessions[0]?.updatedAt).toEqual(expect.any(String));
  });

  it("GET /sessions/:id returns messages and 404 for missing", async () => {
    const app = await freshApp();
    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "with messages" },
    });
    const { id } = created.json<CreateSessionResponse>();

    const db = openSqlite(join(dir, "data.sqlite"));
    const store = new SqliteSessionStore(db);
    await store.appendMessage(id, { role: "user", content: "hello" });
    db.close();

    const found = await app.inject({ method: "GET", url: `/sessions/${id}` });
    const missing = await app.inject({
      method: "GET",
      url: "/sessions/does-not-exist",
    });
    await app.close();

    expect(found.statusCode).toBe(200);
    const body = found.json<GetSessionResponse>();
    expect(body.id).toBe(id);
    expect(body.title).toBe("with messages");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({
      role: "user",
      content: "hello",
    });
    expect(body.messages[0]?.id).toEqual(expect.any(String));
    expect(body.messages[0]?.createdAt).toEqual(expect.any(String));
    expect(missing.statusCode).toBe(404);
  });
});
