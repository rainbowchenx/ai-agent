import { Button } from "@/components/ui/button";
import { resolveTraceView } from "@/lib/trace-view";
import { useSessionStore } from "@/stores/session-store";
import { Activity, GitBranch, X } from "lucide-react";
import { TraceTimeline } from "./trace-timeline";

function formatRunLabel(createdAt: string, status: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return status;
  }
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm} · ${status}`;
}

export function RunDetails() {
  const run = useSessionStore((s) => s.run);
  const sessionRuns = useSessionStore((s) => s.sessionRuns);
  const sessionRunsError = useSessionStore((s) => s.sessionRunsError);
  const selectedTraceRunId = useSessionStore((s) => s.selectedTraceRunId);
  const historicalTrace = useSessionStore((s) => s.historicalTrace);
  const historicalTraceLoading = useSessionStore((s) => s.historicalTraceLoading);
  const historicalTraceError = useSessionStore((s) => s.historicalTraceError);
  const setTracePanelOpen = useSessionStore((s) => s.setTracePanelOpen);
  const selectTraceRun = useSessionStore((s) => s.selectTraceRun);
  const refreshSessionRuns = useSessionStore((s) => s.refreshSessionRuns);
  const injectDemoTool = useSessionStore((s) => s.injectDemoTool);

  const view = resolveTraceView({
    run,
    selectedTraceRunId,
    historicalTrace,
    historicalTraceLoading,
    historicalTraceError,
  });

  const selectValue = selectedTraceRunId ?? run.runId ?? "";

  const runOptions = (() => {
    const byId = new Map(sessionRuns.map((item) => [item.runId, item]));
    if (run.runId && !byId.has(run.runId)) {
      byId.set(run.runId, {
        runId: run.runId,
        traceId: run.traceId ?? "",
        status: run.status === "idle" ? "completed" : run.status,
        createdAt: new Date().toISOString(),
      });
    }
    return [...byId.values()];
  })();

  const meta = view.isLive
    ? {
        runId: run.runId,
        traceId: run.traceId,
        status: run.status,
      }
    : historicalTrace
      ? {
          runId: historicalTrace.runId,
          traceId: historicalTrace.traceId,
          status: historicalTrace.status,
        }
      : {
          runId: selectedTraceRunId,
          traceId: null as string | null,
          status: "—",
        };

  const showEmpty =
    !view.loading &&
    !view.error &&
    view.nodes.length === 0 &&
    !selectedTraceRunId;
  const showNoSpans =
    !view.loading &&
    !view.error &&
    view.nodes.length === 0 &&
    Boolean(selectedTraceRunId);
  const showLiveIndicator = view.isLive && run.status === "running";
  const hasData = !view.loading && !view.error && view.nodes.length > 0;

  const onRetry = () => {
    if (selectedTraceRunId) {
      void selectTraceRun(selectedTraceRunId);
    }
  };

  return (
    <aside
      className={`panel trace-sidebar${hasData ? " has-data" : ""}`}
      data-run-details
      data-trace-panel
      aria-label="调用轨迹"
    >
      <div className="trace-title-bar">
        <h2 className="trace-title">
          <Activity width={18} height={18} aria-hidden />
          <span>调用轨迹</span>
        </h2>
        <button
          type="button"
          className="trace-close"
          aria-label="关闭调用轨迹"
          data-trace-close
          onClick={() => setTracePanelOpen(false)}
        >
          <X width={16} height={16} aria-hidden />
        </button>
      </div>

      <div className="trace-meta" data-trace-meta>
        <span data-run-id>runId: {meta.runId ?? "—"}</span>
        <span data-trace-id>traceId: {meta.traceId ?? "—"}</span>
        <span data-run-status>status: {meta.status}</span>
      </div>

      {sessionRunsError ? (
        <div className="trace-error" data-trace-runs-error>
          <p>{sessionRunsError}</p>
          <button type="button" onClick={() => void refreshSessionRuns()}>
            重试
          </button>
        </div>
      ) : null}

      <div className="trace-run-switcher" data-trace-run-switcher>
        <label className="sr-only" htmlFor="trace-run-select">
          选择 run
        </label>
        <select
          id="trace-run-select"
          className="trace-run-select"
          data-trace-run-select
          value={selectValue}
          disabled={runOptions.length === 0}
          onChange={(e) => {
            const next = e.target.value;
            void selectTraceRun(next || null);
          }}
        >
          {runOptions.length === 0 ? (
            <option value="">暂无 run</option>
          ) : (
            runOptions.map((item) => (
              <option key={item.runId} value={item.runId}>
                {formatRunLabel(item.createdAt, item.status)}
                {run.runId === item.runId ? " · live" : ""}
              </option>
            ))
          )}
        </select>
      </div>

      {import.meta.env.DEV ? (
        <div className="trace-demo">
          <Button
            size="sm"
            variant="outline"
            data-demo-tool
            onClick={injectDemoTool}
          >
            演示工具卡
          </Button>
        </div>
      ) : null}

      {view.loading ? (
        <div className="trace-loading" data-trace-loading>
          加载历史轨迹…
        </div>
      ) : null}

      {view.error ? (
        <div className="trace-error" data-trace-error>
          <p>{view.error}</p>
          <button type="button" onClick={onRetry}>
            重试
          </button>
        </div>
      ) : null}

      {showEmpty ? (
        <div className="trace-empty-state" data-trace-empty>
          <GitBranch width={32} height={32} aria-hidden />
          <p>发送消息后这里会显示调用轨迹</p>
        </div>
      ) : null}

      {showNoSpans ? (
        <div className="trace-empty-state" data-trace-empty>
          <p>该次运行暂无详细轨迹</p>
        </div>
      ) : null}

      {hasData ? (
        <TraceTimeline nodes={view.nodes} isLive={showLiveIndicator} />
      ) : null}
    </aside>
  );
}
