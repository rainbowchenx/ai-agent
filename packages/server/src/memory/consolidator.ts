import type { ModelPort, ToolPort } from "@agent2026/core";
import type { AppConfig, DistillStatusView } from "@agent2026/shared";
import {
  DISTILL_DEDUPE_CACHE,
  DISTILL_QUEUE_MAX,
  DISTILL_TIMEOUT_MS,
} from "./constants.js";
import { buildDistillPrompt, parseDistillModelText } from "./distill-prompt.js";
import {
  evaluateDraft,
  normalizeDoFingerprint,
} from "./validate.js";
import { writeFrozenMemory } from "./write-openviking.js";

export type DistillJob = {
  runId: string;
  sessionId: string;
  traceId: string;
  messages: Array<{ role: string; content: string }>;
  toolSummaries?: Array<{ name: string; ok: boolean; snippet?: string }>;
};

export type MemoryConsolidatorDeps = {
  getConfig: () => AppConfig;
  getOpenVikingStatus: () => { status: string; enabled: boolean };
  getOpenVikingPort: () => ToolPort | undefined;
  getModel: () => ModelPort;
};

export type MemoryConsolidator = {
  enqueue(job: DistillJob): void;
  getLastResult(): DistillStatusView;
  shutdown(): Promise<void>;
};

const SHUTDOWN_WAIT_MS = 5_000;

function isGateOpen(
  config: AppConfig,
  ov: { status: string; enabled: boolean },
): boolean {
  return (
    ov.enabled &&
    ov.status === "ready" &&
    config.openviking?.autoDistill !== false
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createMemoryConsolidator(
  deps: MemoryConsolidatorDeps,
): MemoryConsolidator {
  const queue: DistillJob[] = [];
  const doFingerprints: string[] = [];
  let running = false;
  let shuttingDown = false;
  let currentJob: Promise<void> | null = null;

  let last: DistillStatusView = {
    enabled: false,
    lastStatus: "idle",
  };

  function computeEnabled(): boolean {
    return isGateOpen(deps.getConfig(), deps.getOpenVikingStatus());
  }

  function setLast(partial: Omit<Partial<DistillStatusView>, "enabled">): void {
    last = {
      ...last,
      ...partial,
      enabled: computeEnabled(),
    };
  }

  function pendingCount(): number {
    return queue.length + (running ? 1 : 0);
  }

  function rememberFingerprint(doText: string): void {
    doFingerprints.push(normalizeDoFingerprint(doText));
    if (doFingerprints.length > DISTILL_DEDUPE_CACHE) {
      doFingerprints.splice(0, doFingerprints.length - DISTILL_DEDUPE_CACHE);
    }
  }

  async function collectModelText(job: DistillJob): Promise<string> {
    const model = deps.getModel();
    const signal = AbortSignal.timeout(DISTILL_TIMEOUT_MS);
    const messages = buildDistillPrompt(job);
    let text = "";
    for await (const event of model.stream({ messages, tools: [], signal })) {
      if (event.type === "text_delta") {
        text += event.text;
      }
    }
    return text;
  }

  async function processJob(job: DistillJob): Promise<void> {
    setLast({
      lastStatus: "running",
      lastRunId: job.runId,
      lastAt: nowIso(),
      lastMessage: undefined,
      lastWritten: undefined,
    });

    if (!isGateOpen(deps.getConfig(), deps.getOpenVikingStatus())) {
      setLast({
        lastStatus: "skipped",
        lastRunId: job.runId,
        lastAt: nowIso(),
        lastMessage: undefined,
        lastWritten: undefined,
      });
      return;
    }

    let rawText: string;
    try {
      rawText = await collectModelText(job);
    } catch (err) {
      setLast({
        lastStatus: "error",
        lastRunId: job.runId,
        lastAt: nowIso(),
        lastMessage: err instanceof Error ? err.message : String(err),
        lastWritten: 0,
      });
      return;
    }

    let drafts;
    try {
      drafts = parseDistillModelText(rawText);
    } catch (err) {
      setLast({
        lastStatus: "error",
        lastRunId: job.runId,
        lastAt: nowIso(),
        lastMessage: err instanceof Error ? err.message : String(err),
        lastWritten: 0,
      });
      return;
    }

    const accepted = new Set(doFingerprints);
    let written = 0;
    let writeError: string | undefined;

    for (let i = 0; i < drafts.length; i++) {
      const draft = drafts[i]!;
      const evaluated = evaluateDraft(draft, {
        sourceRunId: job.runId,
        sourceSessionId: job.sessionId,
        sourceTraceId: job.traceId,
        acceptedDoFingerprints: accepted,
      });
      if (!evaluated.ok) continue;

      accepted.add(normalizeDoFingerprint(evaluated.item.do));

      const port = deps.getOpenVikingPort();
      if (!port) {
        writeError = "OpenViking port unavailable";
        break;
      }

      const result = await writeFrozenMemory({
        port,
        item: evaluated.item,
        index: i,
        ctx: { sessionId: job.sessionId, runId: job.runId },
      });

      if (result.ok) {
        written += 1;
        rememberFingerprint(evaluated.item.do);
      } else {
        writeError = result.error ?? "write failed";
        break;
      }
    }

    if (writeError) {
      setLast({
        lastStatus: "error",
        lastRunId: job.runId,
        lastAt: nowIso(),
        lastMessage: writeError,
        lastWritten: written,
      });
      return;
    }

    setLast({
      lastStatus: "ok",
      lastRunId: job.runId,
      lastAt: nowIso(),
      lastMessage: undefined,
      lastWritten: written,
    });
  }

  async function pump(): Promise<void> {
    if (running || shuttingDown) return;
    const next = queue.shift();
    if (!next) return;

    running = true;
    const work = (async () => {
      try {
        await processJob(next);
      } catch (err) {
        setLast({
          lastStatus: "error",
          lastRunId: next.runId,
          lastAt: nowIso(),
          lastMessage: err instanceof Error ? err.message : String(err),
        });
      } finally {
        running = false;
        currentJob = null;
        if (!shuttingDown) {
          void pump();
        }
      }
    })();
    currentJob = work;
    await work;
  }

  return {
    enqueue(job: DistillJob): void {
      if (shuttingDown) return;

      if (pendingCount() >= DISTILL_QUEUE_MAX) {
        setLast({
          lastStatus: "skipped",
          lastMessage: "skipped_busy",
          lastRunId: job.runId,
          lastAt: nowIso(),
          lastWritten: undefined,
        });
        return;
      }

      queue.push(job);
      void pump();
    },

    getLastResult(): DistillStatusView {
      return {
        ...last,
        enabled: computeEnabled(),
      };
    },

    async shutdown(): Promise<void> {
      shuttingDown = true;
      queue.length = 0;
      if (currentJob) {
        await Promise.race([
          currentJob,
          new Promise<void>((resolve) => {
            setTimeout(resolve, SHUTDOWN_WAIT_MS);
          }),
        ]);
      }
    },
  };
}
