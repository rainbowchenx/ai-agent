import { describe, expect, it } from "vitest";
import {
  formatRecallBlock,
  parseRecallToolResult,
  shouldRefreshRecall,
  truncateQuery,
} from "./format-recall.js";

describe("shouldRefreshRecall", () => {
  it("matches Chinese and English cues", () => {
    expect(shouldRefreshRecall("请记住我喜欢 yarn")).toBe(true);
    expect(shouldRefreshRecall("Remember this preference")).toBe(true);
    expect(shouldRefreshRecall("今天天气如何")).toBe(false);
  });
});

describe("parseRecallToolResult", () => {
  it("parses memory markdown do/when blocks", () => {
    const raw = `---
kind: preference
status: frozen
---

## when
Node 包管理

## do
默认使用 pnpm

## outcome
ok
`;
    const items = parseRecallToolResult(raw, 5);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("preference");
    expect(items[0]?.summary).toMatch(/pnpm/);
    expect(items[0]?.when).toMatch(/包管理/);
  });

  it("returns empty on API error text", () => {
    expect(
      parseRecallToolResult("Error executing tool find: OpenAI API error"),
    ).toEqual([]);
  });

  it("parses bullet lines", () => {
    const items = parseRecallToolResult("- 默认用 pnpm\n- 别用 npm", 5);
    expect(items.length).toBeGreaterThanOrEqual(2);
  });
});

describe("formatRecallBlock", () => {
  it("returns empty for no items", () => {
    expect(formatRecallBlock([])).toBe("");
  });

  it("includes header and numbered items within budget", () => {
    const block = formatRecallBlock(
      [
        { kind: "preference", summary: "用 pnpm", when: "装依赖时" },
        { summary: "第二点" },
      ],
      3000,
    );
    expect(block).toMatch(/相关长期记忆/);
    expect(block).toMatch(/1\. \[preference\] 用 pnpm/);
    expect(block).toMatch(/when: 装依赖时/);
    expect(block).toMatch(/2\. 第二点/);
  });

  it("truncates when over maxChars", () => {
    const long = "x".repeat(200);
    const block = formatRecallBlock(
      [
        { summary: long },
        { summary: long },
        { summary: long },
      ],
      280,
    );
    expect(block.length).toBeLessThanOrEqual(300);
    expect(block).toMatch(/truncated|…/);
  });
});

describe("truncateQuery", () => {
  it("caps length", () => {
    expect(truncateQuery("a".repeat(10), 5).length).toBeLessThanOrEqual(6);
  });
});
