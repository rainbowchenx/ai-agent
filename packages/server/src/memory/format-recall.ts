import {
  RECALL_BLOCK_MAX_CHARS,
  RECALL_ITEM_MAX_CHARS,
  RECALL_REFRESH_CUES,
  RECALL_TOP_K,
} from "./constants.js";

export type RecallItem = {
  kind?: string;
  summary: string;
  when?: string;
};

const HEADER =
  "## 相关长期记忆（自动召回）\n" +
  "以下为与当前对话可能相关的冻结记忆，请在适用时遵守；若与用户最新指示冲突，以最新指示为准。\n";

export function shouldRefreshRecall(userText: string): boolean {
  const lower = userText.toLowerCase();
  return RECALL_REFRESH_CUES.some((cue) => lower.includes(cue.toLowerCase()));
}

export function truncateQuery(text: string, max = 500): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function truncateItem(text: string, max = RECALL_ITEM_MAX_CHARS): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** Parse OV find/search tool text into short recall items. */
export function parseRecallToolResult(
  raw: string,
  topK: number = RECALL_TOP_K,
): RecallItem[] {
  const text = raw?.trim() ?? "";
  if (!text) return [];
  if (/^error\b/i.test(text) || /api error/i.test(text)) return [];

  const items: RecallItem[] = [];

  // Memory markdown with ## do sections
  const doBlocks = [
    ...text.matchAll(
      /(?:^|\n)---[\s\S]*?kind:\s*(\w+)[\s\S]*?---\s*\n([\s\S]*?)(?=\n---|\n*$)/g,
    ),
  ];
  for (const m of doBlocks) {
    const kind = m[1];
    const body = m[2] ?? "";
    const doMatch = body.match(/##\s*do\s*\n([\s\S]*?)(?=\n##|\n*$)/i);
    const whenMatch = body.match(/##\s*when\s*\n([\s\S]*?)(?=\n##|\n*$)/i);
    const summary = (doMatch?.[1] ?? body).trim();
    if (summary) {
      items.push({
        kind,
        summary: truncateItem(summary),
        when: whenMatch?.[1]?.trim()
          ? truncateItem(whenMatch[1].trim(), 200)
          : undefined,
      });
    }
    if (items.length >= topK) return items;
  }
  if (items.length > 0) return items.slice(0, topK);

  // Numbered or bulleted lines
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const cleaned = line
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/^\[.*?\]\s*/, "");
    if (cleaned.length < 4) continue;
    if (/^(found|tree|list|no match|no matching)/i.test(cleaned)) continue;
    items.push({ summary: truncateItem(cleaned) });
    if (items.length >= topK) break;
  }
  if (items.length > 0) return items;

  // Fallback: whole blob as one item
  return [{ summary: truncateItem(text) }];
}

export function formatRecallBlock(
  items: RecallItem[],
  maxChars: number = RECALL_BLOCK_MAX_CHARS,
): string {
  if (items.length === 0) return "";

  const parts: string[] = [HEADER];
  let used = HEADER.length;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const kind = item.kind ? `[${item.kind}] ` : "";
    let entry = `${i + 1}. ${kind}${item.summary}`;
    if (item.when) {
      entry += `\n   when: ${item.when}`;
    }
    entry += "\n";

    if (used + entry.length > maxChars) {
      const remain = maxChars - used - 20;
      if (remain > 40) {
        parts.push(`${entry.slice(0, remain)}…(truncated)\n`);
      } else {
        parts.push("…(truncated)\n");
      }
      break;
    }
    parts.push(entry);
    used += entry.length;
  }

  return parts.join("").trimEnd();
}
