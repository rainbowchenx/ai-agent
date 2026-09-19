/**
 * P1 trace panel live smoke (real OpenAI-compatible key).
 *
 * Boots createApp with an isolated config/db, runs one tool call via WS,
 * then asserts GET /runs/:runId/trace returns spans (incl. tool).
 *
 *   pnpm smoke:trace
 *   # or:
 *   cd packages/server && pnpm exec tsx --env-file=../../.env ../../scripts/smoke-trace.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { GetRunTraceResponse, RunEvent } from "../packages/shared/src/index.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Repo-root `.env` when pnpm `--env-file` path fails on Windows. */
function loadRepoDotEnv(): void {
  const envPath = join(import.meta.dirname, "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

async function collectUntilEnd(
  ws: { on: (e: string, fn: (data: Buffer) => void) => void },
  timeoutMs: number,
): Promise<{ events: RunEvent[]; error?: string }> {
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
  loadRepoDotEnv();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("fail: OPENAI_API_KEY not set (add to repo .env)");
    process.exit(1);
  }

  const baseUrl = (
    process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com/v1"
  ).replace(/\/+$/, "");
  const normalizedBase =
    baseUrl.endsWith("/v1") || /\/v\d+$/.test(baseUrl)
      ? baseUrl
      : `${baseUrl}/v1`;
  const modelName = process.env.OPENAI_MODEL ?? "deepseek-chat";
  const repoRoot = join(import.meta.dirname, "..");

  const dir = await mkdtemp(join(tmpdir(), "agent2026-smoke-trace-"));
  const workspace = join(dir, "workspace");
  await mkdir(workspace);
  await writeFile(join(workspace, "hello.txt"), "smoke-trace-ok\n", "utf8");

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
    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "trace-smoke" },
    });
    assert(created.statusCode === 200, `create session ${created.statusCode}`);
    const sessionId = created.json<{ id: string }>().id;

    const ws = await app.injectWS("/ws");
    const pending = collectUntilEnd(ws, 90_000);
    ws.send(
      JSON.stringify({
        type: "run",
        sessionId,
        content:
          "Use the read_file tool to read hello.txt in the workspace. Quote its exact contents.",
      }),
    );
    const run = await pending;
    ws.terminate();
    assert(!run.error, `tool run: ${run.error}`);
    const runStart = run.events.find((e) => e.type === "run_start");
    const toolStart = run.events.find((e) => e.type === "tool_start");
    const runEnd = run.events.find((e) => e.type === "run_end");
    assert(runStart?.type === "run_start", "missing run_start");
    assert(toolStart?.type === "tool_start", "missing tool_start");
    assert(runEnd?.type === "run_end", "missing run_end");
    const runId = runStart.runId;
    results.push("PASS tool run via WS");

    const runs = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/runs?limit=20`,
    });
    assert(runs.statusCode === 200, `list runs ${runs.statusCode}`);
    const runList = runs.json<{ runs: Array<{ runId: string }> }>().runs;
    assert(runList.some((r) => r.runId === runId), "run missing from session list");
    results.push(`PASS GET /sessions/:id/runs (${runList.length} runs)`);

    const trace = await app.inject({
      method: "GET",
      url: `/runs/${runId}/trace`,
    });
    assert(trace.statusCode === 200, `trace ${trace.statusCode}`);
    const body = trace.json<GetRunTraceResponse>();
    assert(body.runId === runId, "trace.runId mismatch");
    assert(body.spans.length >= 1, "trace has no spans");
    assert(
      body.spans.some((s) => s.kind === "tool"),
      `trace missing tool span; kinds=${body.spans.map((s) => s.kind).join(",")}`,
    );
    results.push(
      `PASS GET /runs/:id/trace (${body.spans.length} spans, status=${body.status})`,
    );

    console.log("\n=== P1 trace smoke results ===");
    for (const line of results) console.log(line);
    console.log(`workspace/config: ${dir}`);
    console.log("ALL CHECKS DONE");
  } catch (err) {
    console.error("\n=== P1 trace smoke FAILED ===");
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
