import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelStreamEvent } from "@agent2026/core";
import { createAnthropicModel, toAnthropicMessages } from "./anthropic.js";

type Captured = {
  url: string;
  apiKey: string | undefined;
  version: string | undefined;
  body: Record<string, unknown>;
};

function sse(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

async function startMock(
  write: (res: ServerResponse) => void,
): Promise<{ baseUrl: string; captured: () => Captured | undefined; close: () => Promise<void> }> {
  let captured: Captured | undefined;
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      captured = {
        url: req.url ?? "",
        apiKey: req.headers["x-api-key"] as string | undefined,
        version: req.headers["anthropic-version"] as string | undefined,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      };
      res.writeHead(200, { "content-type": "text/event-stream" });
      write(res);
      res.end();
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    captured: () => captured,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function collect(model: ReturnType<typeof createAnthropicModel>): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of model.stream({
    messages: [
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ],
    tools: [
      {
        name: "read_file",
        description: "read",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ],
  })) {
    events.push(event);
  }
  return events;
}

describe("createAnthropicModel", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("streams text and sends Anthropic headers, system, and tools", async () => {
    const mock = await startMock((res) => {
      res.write(sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "pong" } }));
      res.write(sse({ type: "message_delta", usage: { output_tokens: 2 } }));
    });
    close = mock.close;

    const model = createAnthropicModel({
      id: "anthropic/claude",
      baseUrl: mock.baseUrl,
      apiKey: "sk-ant",
      model: "claude-sonnet",
    });
    const events = await collect(model);
    expect(events).toContainEqual({ type: "text_delta", text: "pong" });
    const captured = mock.captured();
    expect(captured?.url).toBe("/v1/messages");
    expect(captured?.apiKey).toBe("sk-ant");
    expect(captured?.version).toBe("2023-06-01");
    expect(captured?.body.model).toBe("claude-sonnet");
    expect(captured?.body.system).toBe("be brief");
    expect(captured?.body.tools).toEqual([
      expect.objectContaining({ name: "read_file", input_schema: expect.any(Object) }),
    ]);
  });

  it("emits a tool_call when a tool_use block closes", async () => {
    const mock = await startMock((res) => {
      res.write(
        sse({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_1", name: "read_file" },
        }),
      );
      res.write(
        sse({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"path":' },
        }),
      );
      res.write(
        sse({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '"a.txt"}' },
        }),
      );
      res.write(sse({ type: "content_block_stop", index: 0 }));
    });
    close = mock.close;
    const model = createAnthropicModel({
      id: "anthropic/claude",
      baseUrl: mock.baseUrl,
      apiKey: "sk-ant",
      model: "claude-sonnet",
    });
    const events = await collect(model);
    expect(events).toContainEqual({
      type: "tool_call",
      id: "toolu_1",
      name: "read_file",
      arguments: { path: "a.txt" },
    });
  });
});

describe("toAnthropicMessages", () => {
  it("lifts system text and groups tool results into one user turn", () => {
    const mapped = toAnthropicMessages([
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.txt" } }],
      },
      { role: "tool", toolCallId: "c1", content: "body" },
    ]);
    expect(mapped.system).toBe("sys");
    expect(mapped.messages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "tool_use", id: "c1", name: "read_file" }],
    });
    expect(mapped.messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "c1", content: "body" }],
    });
  });
});
