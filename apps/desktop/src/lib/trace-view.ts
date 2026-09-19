import type { GetRunTraceResponse } from "@agent2026/shared";
import type { RunProjection } from "./apply-run-event.js";
import { spansToNodes, type TraceNode } from "./trace-nodes.js";

export type TraceViewState = {
  run: RunProjection;
  selectedTraceRunId: string | null;
  historicalTrace: GetRunTraceResponse | null;
  historicalTraceLoading: boolean;
  historicalTraceError: string | null;
};

export type TraceView = {
  nodes: TraceNode[];
  loading: boolean;
  error: string | null;
  isLive: boolean;
};

export function isLiveTraceSelection(
  selectedTraceRunId: string | null,
  liveRunId: string | null,
): boolean {
  return (
    selectedTraceRunId === null ||
    (liveRunId !== null && selectedTraceRunId === liveRunId)
  );
}

export function resolveTraceView(state: TraceViewState): TraceView {
  const isLive = isLiveTraceSelection(
    state.selectedTraceRunId,
    state.run.runId,
  );

  if (isLive) {
    return {
      nodes: state.run.traceNodes,
      loading: false,
      error: null,
      isLive: true,
    };
  }

  if (state.historicalTraceLoading) {
    return {
      nodes: [],
      loading: true,
      error: null,
      isLive: false,
    };
  }

  if (state.historicalTraceError) {
    return {
      nodes: [],
      loading: false,
      error: state.historicalTraceError,
      isLive: false,
    };
  }

  if (state.historicalTrace) {
    return {
      nodes: spansToNodes(state.historicalTrace.spans, {
        status: state.historicalTrace.status,
      }),
      loading: false,
      error: null,
      isLive: false,
    };
  }

  return {
    nodes: [],
    loading: false,
    error: null,
    isLive: false,
  };
}
