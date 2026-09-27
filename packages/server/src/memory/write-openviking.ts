import type { ToolPort } from "@agent2026/core";
import type { MemoryItem } from "@agent2026/shared";
import { OPENVIKING_SERVER_NAME } from "../openviking/constants.js";

/** Whitelisted OpenViking MCP tools for consolidator writes (bypass PermissionBroker). */
const WRITE_TOOL = `${OPENVIKING_SERVER_NAME}__write`;
const REMEMBER_TOOL = `${OPENVIKING_SERVER_NAME}__remember`;

const ALLOWED_TOOLS = new Set([WRITE_TOOL, REMEMBER_TOOL]);

export type WriteFrozenMemoryInput = {
  port: ToolPort;
  item: MemoryItem;
  index: number;
  ctx: { sessionId: string; runId: string };
};

export type WriteFrozenMemoryResult = {
  ok: boolean;
  via: "write" | "remember";
  error?: string;
};

function yamlScalar(value: string | number): string {
  if (typeof value === "number") return String(value);
  if (/[:#{}[\],&*?|>!%@`]/.test(value) || value.includes("\n")) {
    return JSON.stringify(value);
  }
  return value;
}

export function memoryItemToMarkdown(item: MemoryItem): string {
  const front: Array<[string, string | number]> = [
    ["kind", item.kind],
    ["status", item.status],
    ["confidence", item.confidence],
    ["sourceRunId", item.sourceRunId],
    ["sourceSessionId", item.sourceSessionId],
  ];
  if (item.sourceTraceId) {
    front.push(["sourceTraceId", item.sourceTraceId]);
  }

  const yaml = front
    .map(([k, v]) => `${k}: ${yamlScalar(v)}`)
    .join("\n");

  return [
    "---",
    yaml,
    "---",
    "",
    "## when",
    item.when,
    "",
    "## do",
    item.do,
    "",
    "## outcome",
    item.outcome,
    "",
  ].join("\n");
}

export function memoryWriteUri(
  runId: string,
  index: number,
  now: Date = new Date(),
): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `viking://~/memories/agent2026/${yyyy}-${mm}-${dd}/${runId}-${index}.md`;
}

async function executeWhitelisted(
  port: ToolPort,
  name: string,
  args: Record<string, unknown>,
  ctx: { sessionId: string; runId: string },
): Promise<string> {
  if (!ALLOWED_TOOLS.has(name)) {
    throw new Error(`OpenViking write whitelist rejected tool: ${name}`);
  }
  return port.execute(name, args, ctx);
}

export async function writeFrozenMemory(
  input: WriteFrozenMemoryInput,
): Promise<WriteFrozenMemoryResult> {
  const markdown = memoryItemToMarkdown(input.item);
  const uri = memoryWriteUri(input.ctx.runId, input.index);
  const toolCtx = {
    sessionId: input.ctx.sessionId,
    runId: input.ctx.runId,
  };

  try {
    await executeWhitelisted(
      input.port,
      WRITE_TOOL,
      { uri, content: markdown, mode: "replace" },
      toolCtx,
    );
    return { ok: true, via: "write" };
  } catch (writeErr) {
    try {
      await executeWhitelisted(
        input.port,
        REMEMBER_TOOL,
        { messages: [{ role: "user", content: markdown }] },
        toolCtx,
      );
      return { ok: true, via: "remember" };
    } catch (rememberErr) {
      const err =
        rememberErr instanceof Error
          ? rememberErr.message
          : String(rememberErr);
      const writeMsg =
        writeErr instanceof Error ? writeErr.message : String(writeErr);
      return {
        ok: false,
        via: "remember",
        error: err || writeMsg,
      };
    }
  }
}
