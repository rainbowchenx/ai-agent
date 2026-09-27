export const DISTILL_MAX_ITEMS = 5;
export const DISTILL_CONFIDENCE_MIN = 0.5;
export const DISTILL_DO_MIN_LENGTH = 8;
export const DISTILL_MSG_TRUNCATE = 2000;
export const DISTILL_TOTAL_CHARS = 12000;
export const DISTILL_QUEUE_MAX = 3;
export const DISTILL_TIMEOUT_MS = 60_000;
export const DISTILL_DEDUPE_CACHE = 50;

export const RECALL_TOP_K = 5;
export const RECALL_BLOCK_MAX_CHARS = 3000;
export const RECALL_QUERY_MAX_CHARS = 500;
export const RECALL_TIMEOUT_MS = 8_000;
export const RECALL_ITEM_MAX_CHARS = 800;

/** Cue phrases that force session recall refresh (case-insensitive). */
export const RECALL_REFRESH_CUES = [
  "记住",
  "偏好",
  "以后默认",
  "别用",
  "改用",
  "我的习惯",
  "长期记忆",
  "remember",
  "prefer",
  "preference",
  "from now on",
  "don't use",
  "always use",
] as const;
