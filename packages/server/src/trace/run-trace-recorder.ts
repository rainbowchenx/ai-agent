import type { RunnerEvent } from "@agent2026/core";
import type { TraceRunStatus } from "../store/sqlite-trace-port.js";

export type RunTraceRecorderPort = {
  startSpan(input: {
    traceId: string;
    name: string;
    kind: "generation" | "tool" | "permission";
    parentSpanId?: string;
  }): Promise<{ spanId: string }>;

  endSpan(input: {
    spanId: string;
    status?: "ok" | "error";
    metadata?: Record<string, unknown>;
  }): Promise<void>;

  updateTraceEnd(input: {
    runId: string;
    status: TraceRunStatus;
    endedAt: string;
  }): Promise<void>;
};

type RecorderState = {
  traceId?: string;
  runId?: string;
  openGenerationSpanId?: string;
  toolSpanIds: Map<string, string>;
};

function terminalSpanStatus(
  reason: Extract<RunnerEvent, { type: "run_end" }>["reason"],
): "ok" | "error" {
  return reason === "error" ? "error" : "ok";
}

export function createRunTraceRecorder(port: RunTraceRecorderPort): {
  onEvent(event: RunnerEvent): void;
  /** Wait for queued span writes (for tests / post-run consistency). */
  flush(): Promise<void>;
} {
  const state: RecorderState = {
    toolSpanIds: new Map(),
  };

  async function endOpenGeneration(status: "ok" | "error"): Promise<void> {
    if (!state.openGenerationSpanId) {
      return;
    }
    const spanId = state.openGenerationSpanId;
    state.openGenerationSpanId = undefined;
    await port.endSpan({ spanId, status });
  }

  async function endOpenToolSpans(status: "ok" | "error"): Promise<void> {
    for (const [toolCallId, spanId] of state.toolSpanIds.entries()) {
      await port.endSpan({ spanId, status });
      state.toolSpanIds.delete(toolCallId);
    }
  }

  async function handleEvent(event: RunnerEvent): Promise<void> {
    switch (event.type) {
      case "run_start":
        state.traceId = event.traceId;
        state.runId = event.runId;
        state.openGenerationSpanId = undefined;
        state.toolSpanIds.clear();
        return;

      case "message_delta": {
        if (!state.traceId || state.openGenerationSpanId) {
          return;
        }
        const { spanId } = await port.startSpan({
          traceId: state.traceId,
          name: "generation",
          kind: "generation",
        });
        state.openGenerationSpanId = spanId;
        return;
      }

      case "tool_start": {
        if (!state.traceId) {
          return;
        }
        await endOpenGeneration("ok");
        const { spanId } = await port.startSpan({
          traceId: state.traceId,
          name: event.name,
          kind: "tool",
        });
        state.toolSpanIds.set(event.toolCallId, spanId);
        return;
      }

      case "tool_end": {
        const spanId = state.toolSpanIds.get(event.toolCallId);
        if (!spanId) {
          return;
        }
        state.toolSpanIds.delete(event.toolCallId);
        await port.endSpan({
          spanId,
          status: event.isError ? "error" : "ok",
          metadata: { summary: event.result.slice(0, 200) },
        });
        return;
      }

      case "error":
        await endOpenGeneration("error");
        await endOpenToolSpans("error");
        return;

      case "run_end": {
        const spanStatus = terminalSpanStatus(event.reason);
        await endOpenGeneration(spanStatus);
        await endOpenToolSpans(spanStatus);
        if (state.runId) {
          await port.updateTraceEnd({
            runId: state.runId,
            status: event.reason,
            endedAt: new Date().toISOString(),
          });
        }
        return;
      }

      default:
        return;
    }
  }

  let chain = Promise.resolve();

  return {
    onEvent(event: RunnerEvent): void {
      chain = chain
        .then(() => handleEvent(event))
        .catch(() => {
          // Span write failures must not block the run.
        });
    },
    flush(): Promise<void> {
      return chain;
    },
  };
}
