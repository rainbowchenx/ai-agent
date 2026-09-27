import { describe, expect, it } from "vitest";
import type { DistillDraftItem } from "@agent2026/shared";
import { evaluateDraft, looksLikeSecret, normalizeDoFingerprint } from "./validate.js";

const baseDraft = (): DistillDraftItem => ({
  kind: "preference",
  when: "user asks for package manager",
  do: "default to pnpm for installs",
  outcome: "user said prefer pnpm",
  confidence: 0.8,
});

const baseCtx = () => ({
  sourceRunId: "run-1",
  sourceSessionId: "sess-1",
  sourceTraceId: "trace-1",
  acceptedDoFingerprints: new Set<string>(),
});

describe("normalizeDoFingerprint", () => {
  it("lowercases and compresses whitespace", () => {
    expect(normalizeDoFingerprint("  Prefer   PNPM  ")).toBe("prefer pnpm");
  });
});

describe("looksLikeSecret", () => {
  it("detects sk- token shapes", () => {
    expect(looksLikeSecret("token sk-abcdefghijk999")).toBe(true);
  });

  it("detects api_key= patterns", () => {
    expect(looksLikeSecret("api_key=secretvalue")).toBe(true);
    expect(looksLikeSecret("api-key = x")).toBe(true);
  });

  it("returns false for ordinary text", () => {
    expect(looksLikeSecret("prefer pnpm for installs")).toBe(false);
  });
});

describe("evaluateDraft", () => {
  it("rejects empty when", () => {
    const result = evaluateDraft({ ...baseDraft(), when: "   " }, baseCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/when/i);
  });

  it("rejects do shorter than 8 chars", () => {
    const result = evaluateDraft({ ...baseDraft(), do: "short" }, baseCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/do/i);
  });

  it("rejects confidence below 0.5", () => {
    const result = evaluateDraft({ ...baseDraft(), confidence: 0.49 }, baseCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/confidence/i);
  });

  it("rejects duplicate do fingerprints", () => {
    const draft = baseDraft();
    const ctx = baseCtx();
    ctx.acceptedDoFingerprints.add(normalizeDoFingerprint(draft.do));
    const result = evaluateDraft(draft, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/duplicate|fingerprint|dedupe/i);
  });

  it("rejects drafts containing sk- secrets", () => {
    const result = evaluateDraft(
      { ...baseDraft(), outcome: "key was sk-abcdefghijklmnop" },
      baseCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/secret/i);
  });

  it("promotes a valid draft to frozen MemoryItem", () => {
    const draft = baseDraft();
    const ctx = baseCtx();
    const result = evaluateDraft(draft, ctx);
    expect(result).toEqual({
      ok: true,
      item: {
        kind: draft.kind,
        when: draft.when,
        do: draft.do,
        outcome: draft.outcome,
        confidence: draft.confidence,
        status: "frozen",
        sourceRunId: "run-1",
        sourceSessionId: "sess-1",
        sourceTraceId: "trace-1",
      },
    });
  });
});
