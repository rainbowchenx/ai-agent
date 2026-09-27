import type { ToolPort } from "@agent2026/core";
import type { AppConfig } from "@agent2026/shared";
import { OPENVIKING_SERVER_NAME } from "../openviking/constants.js";
import {
  RECALL_QUERY_MAX_CHARS,
  RECALL_TIMEOUT_MS,
  RECALL_TOP_K,
} from "./constants.js";
import {
  formatRecallBlock,
  parseRecallToolResult,
  shouldRefreshRecall,
  truncateQuery,
} from "./format-recall.js";

const FIND_TOOL = `${OPENVIKING_SERVER_NAME}__find`;
const SEARCH_TOOL = `${OPENVIKING_SERVER_NAME}__search`;
const ALLOWED = new Set([FIND_TOOL, SEARCH_TOOL]);

export type RecallCacheEntry = {
  block: string;
  query: string;
  fetchedAt: string;
  hitCount: number;
  source: "find" | "search" | "empty" | "error";
};

export type MemoryRecallerDeps = {
  getConfig: () => AppConfig;
  getOpenVikingStatus: () => { status: string; enabled: boolean };
  getOpenVikingPort: () => ToolPort | undefined;
};

export type ResolveForRunInput = {
  sessionId: string;
  userText: string;
  forceRefresh?: boolean;
  /** Synthetic run id for tool ctx when not in a real run. */
  runId?: string;
};

export type MemoryRecaller = {
  resolveForRun(input: ResolveForRunInput): Promise<string>;
  getCache(sessionId: string): RecallCacheEntry | undefined;
  clearSession(sessionId: string): void;
  refresh(input: {
    sessionId: string;
    query: string;
  }): Promise<RecallCacheEntry>;
};

function isGateOpen(
  config: AppConfig,
  ov: { status: string; enabled: boolean },
): boolean {
  return (
    ov.enabled &&
    ov.status === "ready" &&
    config.openviking?.autoRecall !== false
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("recall timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function executeWhitelisted(
  port: ToolPort,
  name: string,
  args: Record<string, unknown>,
  ctx: { sessionId: string; runId: string },
): Promise<string> {
  if (!ALLOWED.has(name)) {
    throw new Error(`OpenViking recall whitelist rejected tool: ${name}`);
  }
  return port.execute(name, args, ctx);
}

export function createMemoryRecaller(
  deps: MemoryRecallerDeps,
): MemoryRecaller {
  const cache = new Map<string, RecallCacheEntry>();

  async function fetchEntry(
    sessionId: string,
    queryRaw: string,
    runId: string,
  ): Promise<RecallCacheEntry> {
    const query = truncateQuery(queryRaw, RECALL_QUERY_MAX_CHARS);
    const port = deps.getOpenVikingPort();
    if (!port) {
      return {
        block: "",
        query,
        fetchedAt: new Date().toISOString(),
        hitCount: 0,
        source: "error",
      };
    }

    const ctx = { sessionId, runId };

    try {
      const findRaw = await withTimeout(
        executeWhitelisted(
          port,
          FIND_TOOL,
          { query, limit: RECALL_TOP_K },
          ctx,
        ),
        RECALL_TIMEOUT_MS,
      );
      const fromFind = parseRecallToolResult(findRaw, RECALL_TOP_K);
      if (fromFind.length > 0) {
        return {
          block: formatRecallBlock(fromFind),
          query,
          fetchedAt: new Date().toISOString(),
          hitCount: fromFind.length,
          source: "find",
        };
      }

      const searchRaw = await withTimeout(
        executeWhitelisted(
          port,
          SEARCH_TOOL,
          { query, mode: "list", limit: RECALL_TOP_K },
          ctx,
        ),
        RECALL_TIMEOUT_MS,
      );
      const fromSearch = parseRecallToolResult(searchRaw, RECALL_TOP_K);
      if (fromSearch.length > 0) {
        return {
          block: formatRecallBlock(fromSearch),
          query,
          fetchedAt: new Date().toISOString(),
          hitCount: fromSearch.length,
          source: "search",
        };
      }

      return {
        block: "",
        query,
        fetchedAt: new Date().toISOString(),
        hitCount: 0,
        source: "empty",
      };
    } catch {
      return {
        block: "",
        query,
        fetchedAt: new Date().toISOString(),
        hitCount: 0,
        source: "error",
      };
    }
  }

  return {
    async resolveForRun(input) {
      if (!isGateOpen(deps.getConfig(), deps.getOpenVikingStatus())) {
        return "";
      }

      const existing = cache.get(input.sessionId);
      const force =
        input.forceRefresh === true || shouldRefreshRecall(input.userText);

      if (existing && !force) {
        return existing.block;
      }

      const entry = await fetchEntry(
        input.sessionId,
        input.userText,
        input.runId ?? `recall-${input.sessionId}`,
      );
      cache.set(input.sessionId, entry);
      return entry.block;
    },

    getCache(sessionId) {
      return cache.get(sessionId);
    },

    clearSession(sessionId) {
      cache.delete(sessionId);
    },

    async refresh(input) {
      if (!isGateOpen(deps.getConfig(), deps.getOpenVikingStatus())) {
        const empty: RecallCacheEntry = {
          block: "",
          query: truncateQuery(input.query, RECALL_QUERY_MAX_CHARS),
          fetchedAt: new Date().toISOString(),
          hitCount: 0,
          source: "error",
        };
        return empty;
      }
      const entry = await fetchEntry(
        input.sessionId,
        input.query,
        `refresh-${input.sessionId}`,
      );
      cache.set(input.sessionId, entry);
      return entry;
    },
  };
}
