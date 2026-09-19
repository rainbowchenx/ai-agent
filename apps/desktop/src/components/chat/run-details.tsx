import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { resolveTraceView } from "@/lib/trace-view";
import { useSessionStore } from "@/stores/session-store";
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
  const selectedTraceRunId = useSessionStore((s) => s.selectedTraceRunId);
  const historicalTrace = useSessionStore((s) => s.historicalTrace);
  const historicalTraceLoading = useSessionStore((s) => s.historicalTraceLoading);
  const historicalTraceError = useSessionStore((s) => s.historicalTraceError);
  const setTracePanelOpen = useSessionStore((s) => s.setTracePanelOpen);
  const selectTraceRun = useSessionStore((s) => s.selectTraceRun);
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
    !view.loading && !view.error && view.nodes.length === 0;
  const showLiveIndicator = view.isLive && run.status === "running";

  const onRetry = () => {
    if (selectedTraceRunId) {
      void selectTraceRun(selectedTraceRunId);
    }
  };

  return (
    <aside
      className="panel trace-sidebar"
      data-run-details
      data-trace-panel
      aria-label="调用轨迹"
    >
      <div className="trace-title-bar panel-header">
        <h2 className="panel-title trace-title">调用轨迹</h2>
        <button
          type="button"
          className="btn btn-secondary btn-sm trace-close"
          aria-label="关闭调用轨迹"
          data-trace-close
          onClick={() => setTracePanelOpen(false)}
        >
          关闭
        </button>
      </div>

      <div className="trace-meta" data-trace-meta>
        <dl className="space-y-1 font-mono text-[10px] text-muted-foreground">
          <div>
            <dt className="inline">runId </dt>
            <dd className="inline" data-run-id>
              {meta.runId ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="inline">traceId </dt>
            <dd className="inline" data-trace-id>
              {meta.traceId ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="inline">status </dt>
            <dd className="inline" data-run-status>
              {meta.status}
            </dd>
          </div>
        </dl>
      </div>

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
        <div className="border-b px-3 py-2">
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

      <ScrollArea className="flex-1">
        <div className="p-3">
          {view.loading ? (
            <p className="text-sm text-muted-foreground" data-trace-loading>
              加载历史轨迹…
            </p>
          ) : null}

          {view.error ? (
            <div className="space-y-2" data-trace-error>
              <p className="text-sm" style={{ color: "var(--destructive)" }}>
                {view.error}
              </p>
              <Button size="sm" variant="outline" onClick={onRetry}>
                重试
              </Button>
            </div>
          ) : null}

          {showEmpty ? (
            <div className="trace-empty-state" data-trace-empty>
              <p className="text-sm text-muted-foreground">
                发送消息后这里会显示调用轨迹
              </p>
            </div>
          ) : null}

          {!view.loading && !view.error && view.nodes.length > 0 ? (
            <TraceTimeline nodes={view.nodes} isLive={showLiveIndicator} />
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}
