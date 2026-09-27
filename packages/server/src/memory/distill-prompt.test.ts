import { describe, expect, it } from "vitest";
import {
  buildDistillPrompt,
  parseDistillModelText,
  trimDistillMessages,
} from "./distill-prompt.js";
import { DISTILL_MAX_ITEMS, DISTILL_MSG_TRUNCATE, DISTILL_TOTAL_CHARS } from "./constants.js";

describe("parseDistillModelText", () => {
  it("strips markdown json fences and returns items", () => {
    const text = `\`\`\`json
{"items":[{"kind":"fact","when":"a","do":"abcdefgh","outcome":"o","confidence":0.7}]}
\`\`\``;
    const items = parseDistillModelText(text);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("fact");
  });

  it(`slices items to at most ${DISTILL_MAX_ITEMS}`, () => {
    const drafts = Array.from({ length: 7 }, (_, i) => ({
      kind: "fact" as const,
      when: `when-${i}`,
      do: `do-action-${i}`,
      outcome: `out-${i}`,
      confidence: 0.6,
    }));
    const items = parseDistillModelText(JSON.stringify({ items: drafts }));
    expect(items).toHaveLength(DISTILL_MAX_ITEMS);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseDistillModelText("not-json")).toThrow();
  });
});

describe("trimDistillMessages", () => {
  it("drops system messages", () => {
    const trimmed = trimDistillMessages([
      { role: "system", content: "you are an agent" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    expect(trimmed).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
  });

  it("truncates single messages and total chars", () => {
    const long = "x".repeat(DISTILL_MSG_TRUNCATE + 500);
    const many = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: long,
    }));
    const trimmed = trimDistillMessages(many);
    expect(trimmed.every((m) => m.content.length <= DISTILL_MSG_TRUNCATE)).toBe(true);
    const total = trimmed.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(DISTILL_TOTAL_CHARS);
    expect(trimmed.some((m) => m.role === "system")).toBe(false);
  });
});

describe("buildDistillPrompt", () => {
  it("returns system + user with JSON transcript", () => {
    const messages = buildDistillPrompt({
      runId: "run-1",
      sessionId: "sess-1",
      traceId: "trace-1",
      messages: [
        { role: "system", content: "ignore me" },
        { role: "user", content: "prefer pnpm" },
      ],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
    if (messages[0]?.role === "system") {
      expect(messages[0].content).toMatch(/跨会话|偏好|JSON/i);
    }
    if (messages[1]?.role === "user") {
      expect(messages[1].content).toContain("prefer pnpm");
      expect(messages[1].content).not.toContain("ignore me");
    }
  });
});
