import type { AgentMessage } from "@agent2026/core";
import {
  distillModelOutputSchema,
  type DistillDraftItem,
} from "@agent2026/shared";
import {
  DISTILL_MAX_ITEMS,
  DISTILL_MSG_TRUNCATE,
  DISTILL_TOTAL_CHARS,
} from "./constants.js";

export type DistillPromptMessage = {
  role: string;
  content: string;
};

export type DistillPromptJob = {
  runId: string;
  sessionId: string;
  traceId: string;
  messages: DistillPromptMessage[];
  toolSummaries?: Array<{ name: string; ok: boolean; snippet?: string }>;
};

const DISTILL_SYSTEM_PROMPT = [
  "你是记忆提炼助手。从对话轨迹中只提取跨会话仍有用的偏好、项目约定、已验证的失败教训、稳定事实。",
  "不要提取：闲聊、一次性临时值、密钥、完整代码大段。",
  "每条必须可被未来任务检索复用；outcome 须指向本 run 证据。",
  `只输出 JSON，格式为 {"items":[{"kind":"fact|procedure|preference|boundary","when":"...","do":"...","outcome":"...","confidence":0.0-1.0}]}。`,
  `items 可为空；最多 ${DISTILL_MAX_ITEMS} 条。禁止 Markdown 围栏外的散文。`,
].join("\n");

export function trimDistillMessages(
  messages: DistillPromptMessage[],
): DistillPromptMessage[] {
  const withoutSystem = messages.filter((m) => m.role !== "system");
  const perMessage = withoutSystem.map((m) => ({
    role: m.role,
    content:
      m.content.length > DISTILL_MSG_TRUNCATE
        ? m.content.slice(0, DISTILL_MSG_TRUNCATE)
        : m.content,
  }));

  const result: DistillPromptMessage[] = [];
  let total = 0;
  for (const msg of perMessage) {
    if (total >= DISTILL_TOTAL_CHARS) break;
    const remaining = DISTILL_TOTAL_CHARS - total;
    const content =
      msg.content.length > remaining
        ? msg.content.slice(0, remaining)
        : msg.content;
    if (content.length === 0) break;
    result.push({ role: msg.role, content });
    total += content.length;
  }
  return result;
}

export function buildDistillPrompt(job: DistillPromptJob): AgentMessage[] {
  const trimmed = trimDistillMessages(job.messages);
  const payload: Record<string, unknown> = {
    runId: job.runId,
    sessionId: job.sessionId,
    traceId: job.traceId,
    messages: trimmed,
  };
  if (job.toolSummaries && job.toolSummaries.length > 0) {
    payload.toolSummaries = job.toolSummaries;
  }

  return [
    { role: "system", content: DISTILL_SYSTEM_PROMPT },
    {
      role: "user",
      content: `请根据以下轨迹提炼记忆条目。\n\n${JSON.stringify(payload)}`,
    },
  ];
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed;
}

export function parseDistillModelText(text: string): DistillDraftItem[] {
  const raw = stripJsonFence(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `invalid distill JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = distillModelOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`invalid distill shape: ${result.error.message}`);
  }
  return result.data.items.slice(0, DISTILL_MAX_ITEMS);
}
