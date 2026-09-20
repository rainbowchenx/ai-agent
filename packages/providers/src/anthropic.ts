import type {
  AgentMessage,
  ModelPort,
  ModelStreamEvent,
  ToolDefinition,
} from "@agent2026/core";

export interface AnthropicModelOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
}

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 8192;

type AnthropicSse = {
  type?: string;
  index?: number;
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
  };
  message?: {
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  usage?: { input_tokens?: number; output_tokens?: number };
};

type OpenTool = {
  id: string;
  name: string;
  json: string;
};

export function createAnthropicModel(opts: AnthropicModelOptions): ModelPort {
  return {
    id: opts.id,
    async *stream(input) {
      const url = joinUrl(opts.baseUrl, "messages");
      const { system, messages } = toAnthropicMessages(input.messages);
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "x-api-key": opts.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
            stream: true,
            ...(system ? { system } : {}),
            messages,
            ...(input.tools.length > 0
              ? { tools: input.tools.map(toAnthropicTool) }
              : {}),
          }),
          signal: input.signal,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Anthropic fetch failed for ${url} (model=${opts.model}): ${cause}`,
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Anthropic request failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""} (${url}, model=${opts.model})`,
        );
      }
      if (!response.body) {
        throw new Error("Anthropic response has no body");
      }

      yield* decodeAnthropicStream(response.body);
    },
  };
}

async function* decodeAnthropicStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ModelStreamEvent> {
  const tools = new Map<number, OpenTool>();

  for await (const event of parseSse(body)) {
    if (event.type === "message_start" && event.message?.usage) {
      yield {
        type: "usage",
        inputTokens: event.message.usage.input_tokens,
        outputTokens: event.message.usage.output_tokens,
      };
    }
    if (event.type === "message_delta" && event.usage) {
      yield {
        type: "usage",
        outputTokens: event.usage.output_tokens,
      };
    }

    if (event.type === "content_block_start") {
      const block = event.content_block;
      const index = event.index ?? 0;
      if (block?.type === "tool_use") {
        tools.set(index, {
          id: block.id ?? "",
          name: block.name ?? "",
          json: "",
        });
      }
    }

    if (event.type === "content_block_delta") {
      const index = event.index ?? 0;
      if (event.delta?.type === "text_delta" && event.delta.text) {
        yield { type: "text_delta", text: event.delta.text };
      }
      if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
        const current = tools.get(index);
        if (current) {
          current.json += event.delta.partial_json;
        }
      }
    }

    if (event.type === "content_block_stop") {
      const index = event.index ?? 0;
      const tool = tools.get(index);
      if (!tool) {
        continue;
      }
      tools.delete(index);
      yield {
        type: "tool_call",
        id: tool.id,
        name: tool.name,
        arguments: parseToolArguments(tool.json, tool.name || tool.id),
      };
    }
  }
}

export function toAnthropicMessages(messages: AgentMessage[]): {
  system?: string;
  messages: Array<Record<string, unknown>>;
} {
  const systemParts: string[] = [];
  const out: Array<Record<string, unknown>> = [];

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (!message) {
      continue;
    }
    if (message.role === "system") {
      systemParts.push(message.content);
      continue;
    }
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const blocks: Array<Record<string, unknown>> = [];
      if (message.content) {
        blocks.push({ type: "text", text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
      out.push({
        role: "assistant",
        content: blocks.length > 0 ? blocks : message.content,
      });
      continue;
    }

    const results: Array<Record<string, unknown>> = [];
    while (i < messages.length && messages[i]?.role === "tool") {
      const tool = messages[i];
      if (tool?.role === "tool") {
        results.push({
          type: "tool_result",
          tool_use_id: tool.toolCallId,
          content: tool.content,
        });
      }
      i += 1;
    }
    i -= 1;
    out.push({ role: "user", content: results });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: out,
  };
}

function toAnthropicTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

function parseToolArguments(raw: string, label: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Invalid Anthropic tool input JSON for ${label}: ${trimmed}`);
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new Error(`Anthropic tool input for ${label} must be a JSON object`);
}

async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<AnthropicSse> {
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
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const data = part
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!data || data === "[DONE]") {
          continue;
        }
        yield JSON.parse(data) as AnthropicSse;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
