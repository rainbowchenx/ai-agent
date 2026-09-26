import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelPort, ToolPort } from "@agent2026/core";
import type {
  CreateSessionResponse,
  GetRunTraceResponse,
  RunEvent,
  WsClientMessage,
} from "@agent2026/shared";
import { defaultAppConfig } from "@agent2026/shared";
import { stringify as stringifyYaml } from "yaml";
import { createApp } from "../app.js";
import type { McpSupervisor } from "../mcp/supervisor.js";

async function collectUntilEnd(
  ws: { on: (event: string, listener: (data: Buffer) => void) => void },
  timeoutMs = 4000,
): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`timed out waiting for run_end: ${JSON.stringify(events)}`),
        ),
      timeoutMs,
    );
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString()) as RunEvent;
      events.push(event);
      if (event.type === "run_end") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return events;
}

describe("MCP tools through permission and trace", () => {
  let dir = "";
  let app: Awaited<ReturnType<typeof createApp>> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("ask_all uses namespaced MCP tool name for permission and tool spans", async () => {
    dir = await mkdtemp(join(tmpdir(), "agent2026-mcp-runs-"));

    const config = defaultAppConfig();
    config.permissions = { mode: "ask_all", allowlist: [] };
    config.mcpServers = {
      mcpdemo: {
        transport: "stdio",
        command: "npx",
        args: [],
        enabled: true,
      },
    };
    config.agents.default.tools.mcpServers = ["mcpdemo"];
    await writeFile(join(dir, "config.yaml"), stringifyYaml(config), "utf8");

    const mcpPort: ToolPort = {
      list: () => [
        {
          name: "mcpdemo__echo",
          description: "echo",
          parameters: {
            type: "object",
            properties: { text: { type: "string" } },
          },
        },
      ],
      execute: async (_name, args) => String(args.text ?? ""),
    };

    const mcp: McpSupervisor = {
      reconcile: async () => undefined,
      getPort: (name) => (name === "mcpdemo" ? mcpPort : undefined),
      getStatus: () => [
        {
          name: "mcpdemo",
          enabled: true,
          transport: "stdio",
          status: "ready",
          toolCount: 1,
          tools: [{ name: "mcpdemo__echo", description: "echo" }],
        },
      ],
      refreshTools: async () => undefined,
      shutdown: async () => undefined,
    };

    let turn = 0;
    const model: ModelPort = {
      id: "mock-mcp-ask",
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool_call",
            id: "call_mcp_1",
            name: "mcpdemo__echo",
            arguments: { text: "ping" },
          };
          return;
        }
        yield { type: "text_delta", text: "done" };
      },
    };

    app = await createApp({
      configPath: join(dir, "config.yaml"),
      dbPath: join(dir, "data.sqlite"),
      workspaceRoot: dir,
      model,
      mcp,
      skipMcpReconcile: true,
    });
    await app.ready();

    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "mcp ask" },
    });
    const { id: sessionId } = created.json<CreateSessionResponse>();

    const ws = await app.injectWS("/ws");
    const events: RunEvent[] = [];
    const pending = new Promise<RunEvent[]>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout: ${JSON.stringify(events)}`)),
        4000,
      );
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as RunEvent;
        events.push(event);
        if (event.type === "permission_request") {
          expect(event.toolName).toBe("mcpdemo__echo");
          ws.send(
            JSON.stringify({
              type: "permission_response",
              requestId: event.requestId,
              allow: true,
              scope: "once",
            }),
          );
        }
        if (event.type === "run_end") {
          clearTimeout(timer);
          resolve(events);
        }
      });
    });

    const request: WsClientMessage = {
      type: "run",
      sessionId,
      content: "use mcp echo",
    };
    ws.send(JSON.stringify(request));
    const ended = await pending;
    ws.terminate();

    const perm = ended.find((e) => e.type === "permission_request");
    expect(perm).toMatchObject({
      type: "permission_request",
      toolName: "mcpdemo__echo",
    });

    const toolStart = ended.find((e) => e.type === "tool_start");
    expect(toolStart).toMatchObject({
      type: "tool_start",
      name: "mcpdemo__echo",
    });
    const toolEnd = ended.find((e) => e.type === "tool_end");
    expect(toolEnd).toMatchObject({
      type: "tool_end",
      name: "mcpdemo__echo",
    });
    expect(toolEnd && "isError" in toolEnd ? toolEnd.isError : false).toBeFalsy();
    expect(ended.at(-1)).toMatchObject({ type: "run_end", reason: "completed" });

    const runId =
      ended[0] && "runId" in ended[0] ? ended[0].runId : undefined;
    expect(runId).toEqual(expect.any(String));

    const traceRes = await app.inject({
      method: "GET",
      url: `/runs/${runId}/trace`,
    });
    expect(traceRes.statusCode).toBe(200);
    const trace = traceRes.json<GetRunTraceResponse>();
    const toolSpan = trace.spans.find(
      (span) => span.kind === "tool" && span.name === "mcpdemo__echo",
    );
    expect(toolSpan).toBeDefined();
  });
});
