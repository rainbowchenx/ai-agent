import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenAICompatibleModel } from "./openai-compatible.js";
import type { ModelStreamEvent } from "@agent2026/core";

type CapturedRequest = {
  url: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
};

type MockServer = {
  baseUrl: string;
  captured: CapturedRequest | undefined;
  close: () => Promise<void>;
};

function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function textDeltaChunk(content: string): Record<string, unknown> {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

function toolCallDeltaChunk(
  index: number,
  fragment: { id?: string; name?: string; arguments?: string },
): Record<string, unknown> {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index,
              ...(fragment.id ? { id: fragment.id } : {}),
              type: "function",
              function: {
                ...(fragment.name ? { name: fragment.name } : {}),
                ...(fragment.arguments !== undefined
                  ? { arguments: fragment.arguments }
                  : {}),
              },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  };
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

async function startMockChatServer(
  writeSse: (res: ServerResponse) => void | Promise<void>,
): Promise<MockServer> {
  let captured: CapturedRequest | undefined;
  const server = createServer((req, res) => {
    void (async () => {
      captured = {
        url: req.url ?? "",
        authorization: req.headers.authorization,
        body: await readJsonBody(req),
      };
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      await writeSse(res);
      res.end();
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    get captured() {
      return captured;
    },
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function collectEvents(
  stream: AsyncIterable<ModelStreamEvent>,
): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("createOpenAICompatibleModel", () => {
  let server: MockServer | undefined;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it("maps chat.completions SSE content deltas to text_delta events", async () => {
    server = await startMockChatServer((res) => {
      res.write(sseEvent({ choices: [{ delta: { role: "assistant" } }] }));
      res.write(sseEvent(textDeltaChunk("Hello")));
      res.write(sseEvent(textDeltaChunk(" world")));
      res.write(
        sseEvent({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: 3 },
        }),
      );
      res.write("data: [DONE]\n\n");
    });

    const model = createOpenAICompatibleModel({
      id: "openai-compatible",
      baseUrl: server.baseUrl,
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });

    const events = await collectEvents(
      model.stream({
        messages: [{ role: "user", content: "Say hi" }],
        tools: [],
      }),
    );

    expect(model.id).toBe("openai-compatible");
    expect(server.captured?.url).toBe("/v1/chat/completions");
    expect(server.captured?.authorization).toBe("Bearer sk-test");
    expect(server.captured?.body).toMatchObject({
      model: "gpt-4o-mini",
      stream: true,
      messages: [{ role: "user", content: "Say hi" }],
    });
    expect(events.filter((e) => e.type === "text_delta")).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
    ]);
    expect(events.some((e) => e.type === "usage")).toBe(true);
  });

  it("aggregates streamed tool_calls fragments into one tool_call event", async () => {
    server = await startMockChatServer((res) => {
      res.write(
        sseEvent(
          toolCallDeltaChunk(0, {
            id: "call_abc",
            name: "read_file",
            arguments: "",
          }),
        ),
      );
      res.write(sseEvent(toolCallDeltaChunk(0, { arguments: '{"pa' })));
      res.write(sseEvent(toolCallDeltaChunk(0, { arguments: 'th":"' })));
      res.write(sseEvent(toolCallDeltaChunk(0, { arguments: 'hello.txt"}' })));
      res.write(
        sseEvent({
          choices: [{ delta: {}, finish_reason: "tool_calls" }],
        }),
      );
      res.write("data: [DONE]\n\n");
    });

    const model = createOpenAICompatibleModel({
      id: "openai-compatible",
      baseUrl: server.baseUrl,
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });

    const events = await collectEvents(
      model.stream({
        messages: [{ role: "user", content: "Read hello.txt" }],
        tools: [
          {
            name: "read_file",
            description: "Read a workspace file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
            },
          },
        ],
      }),
    );

    expect(server.captured?.body).toMatchObject({
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a workspace file",
          },
        },
      ],
    });
    expect(events.filter((e) => e.type === "tool_call")).toEqual([
      {
        type: "tool_call",
        id: "call_abc",
        name: "read_file",
        arguments: { path: "hello.txt" },
      },
    ]);
  });
});
