import type { ToolDefinition } from "../../types/messages.js";
import type { ToolHandler } from "../registry.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CHARS = 50_000;

export interface HttpFetchHandlerOptions {
  fetch?: typeof fetch;
  fetchTimeoutMs?: number;
  maxResponseChars?: number;
}

export const HTTP_FETCH_DEFINITION: ToolDefinition = {
  name: "http_fetch",
  description:
    "Fetch a URL over HTTP or HTTPS and return status, headers, and a truncated body.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "HTTP or HTTPS URL to fetch." },
      method: {
        type: "string",
        description: "HTTP method (default GET).",
      },
      headers: {
        type: "object",
        description: "Optional request headers.",
        additionalProperties: { type: "string" },
      },
      body: {
        type: "string",
        description: "Optional request body for POST/PUT/PATCH.",
      },
      timeoutMs: {
        type: "number",
        description: "Request timeout in milliseconds.",
      },
      maxChars: {
        type: "number",
        description: "Maximum response body characters to return.",
      },
    },
    required: ["url"],
  },
};

/** Only http/https are allowed — blocks file:// and other schemes that bypass network policy. */
export function assertHttpUrl(url: string): URL {
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error("http_fetch: url must be a non-empty string");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("http_fetch: invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("http_fetch: only http and https URLs are allowed");
  }

  return parsed;
}

function formatResponse(
  url: string,
  status: number,
  statusText: string,
  headers: Headers,
  body: string,
  truncated: boolean,
): string {
  const headerLines = [...headers.entries()]
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  const parts = [
    `URL: ${url}`,
    `Status: ${status} ${statusText}`,
    "Headers:",
    headerLines || "(none)",
    "Body:",
    body,
  ];

  if (truncated) {
    parts.push("\n[body truncated]");
  }

  return parts.join("\n");
}

/** @param options Optional fetch override (tests) and default timeout/body limits. */
export function createHttpFetchHandler(
  options: HttpFetchHandlerOptions = {},
): ToolHandler {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const defaultTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultMaxChars = options.maxResponseChars ?? DEFAULT_MAX_CHARS;

  return async (args, ctx) => {
    const parsed = assertHttpUrl(String(args.url ?? ""));
    const method = String(args.method ?? "GET").toUpperCase();
    const timeoutMs =
      typeof args.timeoutMs === "number" ? args.timeoutMs : defaultTimeoutMs;
    const maxChars =
      typeof args.maxChars === "number" ? args.maxChars : defaultMaxChars;

    const headers =
      args.headers && typeof args.headers === "object"
        ? (args.headers as Record<string, string>)
        : undefined;

    const body =
      typeof args.body === "string" ? args.body : undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const onAbort = () => controller.abort();
    ctx.signal?.addEventListener("abort", onAbort);

    try {
      const response = await fetchFn(parsed.toString(), {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const text = await response.text();
      const truncated = text.length > maxChars;
      const clipped = truncated ? text.slice(0, maxChars) : text;

      return formatResponse(
        parsed.toString(),
        response.status,
        response.statusText,
        response.headers,
        clipped,
        truncated,
      );
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        if (ctx.signal?.aborted) {
          throw error;
        }
        throw new Error(`http_fetch: request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      ctx.signal?.removeEventListener("abort", onAbort);
    }
  };
}
