import { describe, expect, it } from "vitest";
import type { GetRunTraceResponse } from "@agent2026/shared";
import { emptyProjection } from "./apply-run-event.js";
import {
  isLiveTraceSelection,
  resolveTraceView,
  type TraceViewState,
} from "./trace-view.js";

function baseState(overrides: Partial<TraceViewState> = {}): TraceViewState {
  return {
    run: emptyProjection(),
    selectedTraceRunId: null,
    historicalTrace: null,
    historicalTraceLoading: false,
    historicalTraceError: null,
    ...overrides,
  };
}

describe("isLiveTraceSelection", () => {
  it("treats null selection as live", () => {
    expect(isLiveTraceSelection(null, "run-1")).toBe(true);
    expect(isLiveTraceSelection(null, null)).toBe(true);
  });

  it("matches the current live run id", () => {
    expect(isLiveTraceSelection("run-1", "run-1")).toBe(true);
    expect(isLiveTraceSelection("run-2", "run-1")).toBe(false);
  });
});

describe("resolveTraceView", () => {
  it("uses live traceNodes when selection follows live run", () => {
    const liveNodes = [{ id: "run-1:start", kind: "run_start" as const }];
    const view = resolveTraceView(
      baseState({
        run: {
          ...emptyProjection(),
          runId: "run-1",
          traceNodes: liveNodes,
        },
        selectedTraceRunId: null,
      }),
    );

    expect(view).toEqual({
      nodes: liveNodes,
      loading: false,
      error: null,
      isLive: true,
    });
  });

  it("uses live traceNodes when selected run matches live run", () => {
    const liveNodes = [{ id: "run-1:start", kind: "run_start" as const }];
    const view = resolveTraceView(
      baseState({
        run: {
          ...emptyProjection(),
          runId: "run-1",
          traceNodes: liveNodes,
        },
        selectedTraceRunId: "run-1",
      }),
    );

    expect(view.isLive).toBe(true);
    expect(view.nodes).toEqual(liveNodes);
  });

  it("shows loading while historical trace is fetching", () => {
    const view = resolveTraceView(
      baseState({
        run: { ...emptyProjection(), runId: "run-live" },
        selectedTraceRunId: "run-old",
        historicalTraceLoading: true,
      }),
    );

    expect(view).toEqual({
      nodes: [],
      loading: true,
      error: null,
      isLive: false,
    });
  });

  it("shows error when historical fetch fails", () => {
    const view = resolveTraceView(
      baseState({
        run: { ...emptyProjection(), runId: "run-live" },
        selectedTraceRunId: "run-old",
        historicalTraceError: "get run trace 404",
      }),
    );

    expect(view).toEqual({
      nodes: [],
      loading: false,
      error: "get run trace 404",
      isLive: false,
    });
  });

  it("projects historical spans when a past run is selected", () => {
    const historicalTrace: GetRunTraceResponse = {
      runId: "run-old",
      traceId: "trace-old",
      status: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      spans: [
        {
          spanId: "span-1",
          name: "generation",
          kind: "generation",
          status: "ok",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    };

    const view = resolveTraceView(
      baseState({
        run: { ...emptyProjection(), runId: "run-live" },
        selectedTraceRunId: "run-old",
        historicalTrace,
      }),
    );

    expect(view.isLive).toBe(false);
    expect(view.nodes[0]).toEqual({ id: "history:start", kind: "run_start" });
    expect(view.nodes.at(-1)).toEqual({
      id: "history:end",
      kind: "run_end",
      reason: "completed",
    });
  });
});
