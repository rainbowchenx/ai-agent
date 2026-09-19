/**
 * P0 live closeout smoke (real OpenAI-compatible key).
 *
 * Boots createApp with an isolated config/db under tmp, then verifies:
 * stream chat → tool card path → stop mid-run → session reload.
 *
 *   cd packages/server && pnpm exec tsx --env-file=D:/codeOnly/agent2026/.env D:/codeOnly/agent2026/scripts/smoke-p0.ts
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RunEvent } from "../packages/shared/src/index.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type CollectResult = { events: RunEvent[]; error?: string };

async function collectUntilEnd(
  ws: { on: (e: string, fn: (data: Buffer) => void) => void },
  timeoutMs: number,
): Promise<CollectResult> {
  const events: RunEvent[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `timeout waiting for run_end; last=${JSON.stringify(events.at(-1))}`,
            ),
          ),
        timeoutMs,
      );
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as RunEvent;
        events.push(event);
        if (event.type === "run_end" || event.type === "error") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  } catch (err) {
    return {
      events,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { events };
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("fail: OPENAI_API_KEY not set (use --env-file=.env)");
    process.exit(1);
  }

  const baseUrl = (
    process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com/v1"
  ).replace(/\/+$/, "");
  // DeepSeek (and most OpenAI-compatible gateways) expect .../v1/chat/completions
  const normalizedBase =
    baseUrl.endsWith("/v1") || /\/v\d+$/.test(baseUrl)
      ? baseUrl
      : `${baseUrl}/v1`;

  const modelName = process.env.OPENAI_MODEL ?? "deepseek-chat";
  const repoRoot = join(import.meta.dirname, "..");

  const dir = await mkdtemp(join(tmpdir(), "agent2026-smoke-p0-"));
  const workspace = join(dir, "workspace");
  await mkdir(workspace);
  await writeFile(join(workspace, "hello.txt"), "smoke-p0-ok\n", "utf8");

  const configYaml = `
providers:
  default: openai
  entries:
    openai:
      type: openai_compatible
      baseUrl: ${JSON.stringify(normalizedBase)}
      apiKeyEnv: OPENAI_API_KEY
      models:
        - ${modelName}
agents:
  default:
    model: openai/${modelName}
    systemPrompt: You are a helpful assistant for smoke tests. Be brief.
    tools:
      builtin:
        - read_file
        - http_fetch
      mcpServers: []
      sidecars: []
    maxTurns: 4
permissions:
  mode: default
  allowlist: []
a2a:
  enabled: false
`.trimStart();

  await writeFile(join(dir, "config.yaml"), configYaml, "utf8");

  const { createApp } = await import(
    pathToFileURL(join(repoRoot, "packages/server/src/app.ts")).href
  );

  const app = await createApp({
    configPath: join(dir, "config.yaml"),
    credentialsPath: join(dir, "credentials.json"),
    dbPath: join(dir, "data.sqlite"),
    workspaceRoot: workspace,
  });
  await app.ready();

  const results: string[] = [];

  try {
    const health = await app.inject({ method: "GET", url: "/health" });
    assert(health.statusCode === 200, `health status ${health.statusCode}`);
    assert(health.json<{ ok: boolean }>().ok === true, "health.ok");
    results.push("PASS health");

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "p0-smoke-chat" },
    });
    assert(created.statusCode === 200, `create session ${created.statusCode}`);
    const sessionId = created.json<{ id: string }>().id;

    const wsChat = await app.injectWS("/ws");
    const chatPending = collectUntilEnd(wsChat, 60_000);
    wsChat.send(
      JSON.stringify({
        type: "run",
        sessionId,
        content: "Reply with exactly: P0_SMOKE_OK",
      }),
    );
    const chat = await chatPending;
    wsChat.terminate();
    assert(!chat.error, `chat: ${chat.error}`);
    const chatEnd = chat.events.find((e) => e.type === "run_end");
    assert(chatEnd?.type === "run_end", "chat missing run_end");
    assert(
      chatEnd.reason === "completed",
      `chat run_end.reason=${chatEnd.reason}`,
    );
    const deltas = chat.events
      .filter((e) => e.type === "message_delta")
      .map((e) => (e.type === "message_delta" ? e.delta : ""))
      .join("");
    assert(deltas.length > 0, "chat has no message_delta text");
    results.push(`PASS stream chat (${deltas.length} chars)`);

    const toolSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "p0-smoke-tool" },
    });
    const toolSessionId = toolSession.json<{ id: string }>().id;
    const wsTool = await app.injectWS("/ws");
    const toolPending = collectUntilEnd(wsTool, 90_000);
    wsTool.send(
      JSON.stringify({
        type: "run",
        sessionId: toolSessionId,
        content:
          "Use the read_file tool to read hello.txt in the workspace. Then quote its exact contents in your reply.",
      }),
    );
    const toolRun = await toolPending;
    wsTool.terminate();
    assert(!toolRun.error, `tool: ${toolRun.error}`);
    const toolStart = toolRun.events.find((e) => e.type === "tool_start");
    const toolEnd = toolRun.events.find((e) => e.type === "tool_end");
    assert(toolStart, "missing tool_start (model did not call a tool)");
    assert(toolEnd, "missing tool_end");
    assert(
      toolStart.type === "tool_start" && toolStart.name === "read_file",
      `unexpected tool ${toolStart.type === "tool_start" ? toolStart.name : "?"}`,
    );
    results.push("PASS builtin read_file tool_start/tool_end");

    const toolPersisted = await app.inject({
      method: "GET",
      url: `/sessions/${toolSessionId}`,
    });
    const toolMessages = toolPersisted.json<{
      messages: Array<{ role: string; content: string }>;
    }>().messages;
    const roles = toolMessages.map((m) => m.role);
    assert(roles.includes("tool"), `session missing tool role; roles=${roles}`);
    assert(
      roles.includes("assistant"),
      `session missing assistant after tools; roles=${roles}`,
    );
    results.push(`PASS tool messages persisted (roles=${roles.join(",")})`);

    const stopSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "p0-smoke-stop" },
    });
    const stopSessionId = stopSession.json<{ id: string }>().id;
    const wsStop = await app.injectWS("/ws");
    let stopRunId: string | undefined;
    const stopEvents: RunEvent[] = [];
    const stopDone = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("stop run timed out")),
        60_000,
      );
      wsStop.on("message", (data) => {
        const event = JSON.parse(data.toString()) as RunEvent;
        stopEvents.push(event);
        if (event.type === "run_start") {
          stopRunId = event.runId;
          void app
            .inject({ method: "POST", url: `/runs/${event.runId}/stop` })
            .then((res) => {
              if (res.statusCode >= 400) {
                clearTimeout(timer);
                reject(new Error(`stop HTTP ${res.statusCode}`));
              }
            });
        }
        if (event.type === "run_end" || event.type === "error") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    wsStop.send(
      JSON.stringify({
        type: "run",
        sessionId: stopSessionId,
        content:
          "Write a very long essay about the history of computing, at least 2000 words, with many sections.",
      }),
    );
    await stopDone;
    wsStop.terminate();
    const stopEnd = stopEvents.find((e) => e.type === "run_end");
    assert(stopRunId, "stop: no runId");
    assert(stopEnd?.type === "run_end", "stop: no run_end");
    assert(
      stopEnd.reason === "stopped" || stopEnd.reason === "completed",
      `stop: unexpected reason=${stopEnd.reason}`,
    );
    if (stopEnd.reason === "stopped") {
      results.push("PASS stop mid-run (reason=stopped)");
    } else {
      results.push(
        "WARN stop: run completed before abort landed (still exercised stop API)",
      );
    }

    const listed = await app.inject({ method: "GET", url: "/sessions" });
    assert(listed.statusCode === 200, "list sessions");
    const summaries = listed.json<Array<{ id: string }>>();
    const ids = summaries.map((s) => s.id);
    assert(ids.includes(sessionId), "chat session missing from list");
    const reloaded = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    const msgs = reloaded.json<{ messages: unknown[] }>().messages;
    assert(
      msgs.length >= 2,
      `reload expected >=2 messages, got ${msgs.length}`,
    );
    results.push(`PASS session persist/reload (${msgs.length} messages)`);

    console.log("\n=== P0 smoke results ===");
    for (const line of results) console.log(line);
    console.log(`workspace/config: ${dir}`);
    console.log(`provider baseUrl: ${normalizedBase}`);
    console.log(`model: openai/${modelName}`);
    console.log("ALL CHECKS DONE");
  } catch (err) {
    console.error("\n=== P0 smoke FAILED ===");
    for (const line of results) console.log(line);
    console.error(err instanceof Error ? err.message : err);
    console.error(`debug dir: ${dir}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
