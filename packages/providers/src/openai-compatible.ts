import type {
  AgentMessage,
  ModelPort,
  ModelStreamEvent,
  ToolDefinition,
} from "@agent2026/core";

export interface OpenAICompatibleModelOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

export function createOpenAICompatibleModel(
  opts: OpenAICompatibleModelOptions,
): ModelPort {
  return {
    id: opts.id,
    async *stream(input) {
      const url = joinUrl(opts.baseUrl, "chat/completions");
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model,
          stream: true,
          messages: input.messages.map(toOpenAIMessage),
          ...(input.tools.length > 0
            ? { tools: input.tools.map(toOpenAITool) }
            : {}),
        }),
        signal: input.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `OpenAI-compatible request failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
        );
      }
      if (!response.body) {
        throw new Error("OpenAI-compatible response has no body");
      }

      yield* decodeChatCompletionStream(response.body);
    },
  };
}

type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

async function* decodeChatCompletionStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ModelStreamEvent> {
  const pending = new Map<number, PendingToolCall>();

  for await (const chunk of parseSseJson(body)) {
    if (chunk.usage) {
      yield {
        type: "usage",
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens,
      };
    }

    const choice = chunk.choices?.[0];
    const content = choice?.delta?.content;
    if (typeof content === "string" && content.length > 0) {
      yield { type: "text_delta", text: content };
    }

    for (const part of choice?.delta?.tool_calls ?? []) {
      const index = typeof part.index === "number" ? part.index : 0;
      const current = pending.get(index) ?? { id: "", name: "", arguments: "" };
      if (typeof part.id === "string") {
        current.id = part.id;
      }
      if (part.function?.name) {
        current.name = part.function.name;
      }
      if (typeof part.function?.arguments === "string") {
        current.arguments += part.function.arguments;
      }
      pending.set(index, current);
    }

    if (
      choice?.finish_reason === "tool_calls" ||
      choice?.finish_reason === "stop"
    ) {
      yield* flushToolCalls(pending);
    }
  }

  yield* flushToolCalls(pending);
}

function* flushToolCalls(
  pending: Map<number, PendingToolCall>,
): Generator<ModelStreamEvent> {
  const entries = [...pending.entries()].sort(([left], [right]) => left - right);
  pending.clear();
  for (const [, call] of entries) {
    if (!call.id && !call.name) {
      continue;
    }
    yield {
      type: "tool_call",
      id: call.id,
      name: call.name,
      arguments: parseToolArguments(call.arguments, call.name || call.id),
    };
  }
}

function parseToolArguments(
  raw: string,
  label: string,
): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Invalid tool_call arguments JSON for ${label}: ${trimmed}`);
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new Error(`Tool_call arguments for ${label} must be a JSON object`);
}

async function* parseSseJson(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ChatCompletionChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const { complete, rest } = splitSseEvents(buffer);
      buffer = rest;
      for (const event of complete) {
        const parsed = parseSseData(event);
        if (parsed) {
          yield parsed;
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const parsed = parseSseData(buffer);
      if (parsed) {
        yield parsed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function splitSseEvents(buffer: string): { complete: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  return { complete: parts.filter((part) => part.length > 0), rest };
}

function parseSseData(event: string): ChatCompletionChunk | undefined {
  const dataLines: string[] = [];
  for (const line of event.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return undefined;
  }
  const data = dataLines.join("\n");
  if (data === "[DONE]") {
    return undefined;
  }
  return JSON.parse(data) as ChatCompletionChunk;
}

function toOpenAIMessage(message: AgentMessage): Record<string, unknown> {
  if (message.role === "system" || message.role === "user") {
    return { role: message.role, content: message.content };
  }
  if (message.role === "assistant") {
    const out: Record<string, unknown> = {
      role: "assistant",
      content: message.content,
    };
    if (message.toolCalls?.length) {
      out.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        },
      }));
    }
    return out;
  }
  return {
    role: "tool",
    tool_call_id: message.toolCallId,
    content: message.content,
  };
}

function toOpenAITool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
