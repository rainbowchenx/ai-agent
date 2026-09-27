import type { DistillDraftItem, MemoryItem } from "@agent2026/shared";
import { DISTILL_CONFIDENCE_MIN, DISTILL_DO_MIN_LENGTH } from "./constants.js";

const SK_SECRET = /\bsk-[A-Za-z0-9]{8,}\b/i;
const API_KEY_SECRET = /api[_-]?key\s*=/i;

export type EvaluateDraftCtx = {
  sourceRunId: string;
  sourceSessionId: string;
  sourceTraceId?: string;
  acceptedDoFingerprints: Set<string>;
};

export type EvaluateDraftResult =
  | { ok: true; item: MemoryItem }
  | { ok: false; reason: string };

export function normalizeDoFingerprint(doText: string): string {
  return doText.trim().toLowerCase().replace(/\s+/g, " ");
}

export function looksLikeSecret(text: string): boolean {
  return SK_SECRET.test(text) || API_KEY_SECRET.test(text);
}

export function evaluateDraft(
  draft: DistillDraftItem,
  ctx: EvaluateDraftCtx,
): EvaluateDraftResult {
  const when = draft.when.trim();
  if (!when) {
    return { ok: false, reason: "when is blank" };
  }

  const doText = draft.do.trim();
  if (!doText) {
    return { ok: false, reason: "do is blank" };
  }
  if (doText.length < DISTILL_DO_MIN_LENGTH) {
    return { ok: false, reason: `do shorter than ${DISTILL_DO_MIN_LENGTH}` };
  }

  const outcome = draft.outcome.trim();
  if (!outcome) {
    return { ok: false, reason: "outcome is blank" };
  }

  if (draft.confidence < DISTILL_CONFIDENCE_MIN) {
    return {
      ok: false,
      reason: `confidence below ${DISTILL_CONFIDENCE_MIN}`,
    };
  }

  const fingerprint = normalizeDoFingerprint(doText);
  if (ctx.acceptedDoFingerprints.has(fingerprint)) {
    return { ok: false, reason: "duplicate do fingerprint" };
  }

  const secretFields = [when, doText, outcome];
  if (secretFields.some(looksLikeSecret)) {
    return { ok: false, reason: "contains secret-like text" };
  }

  const item: MemoryItem = {
    kind: draft.kind,
    when,
    do: doText,
    outcome,
    confidence: draft.confidence,
    status: "frozen",
    sourceRunId: ctx.sourceRunId,
    sourceSessionId: ctx.sourceSessionId,
  };
  if (ctx.sourceTraceId !== undefined) {
    item.sourceTraceId = ctx.sourceTraceId;
  }

  return { ok: true, item };
}
