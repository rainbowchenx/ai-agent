import type { TraceNode } from "@/lib/trace-nodes";

function nodeClassName(node: TraceNode): string {
  const base = "trace-node";
  switch (node.kind) {
    case "run_start":
    case "run_end":
      return `${base} run-node`;
    case "generation":
      return `${base} model-node`;
    case "tool":
      return `${base} tool-node`;
    case "error":
      return `${base} error-node`;
    default:
      return base;
  }
}

function nodeTitle(node: TraceNode): string {
  switch (node.kind) {
    case "run_start":
      return "Run started";
    case "run_end":
      return `Run ${node.reason}`;
    case "generation":
      return node.name ? `模型 · ${node.name}` : "模型 · 生成";
    case "tool":
      return node.name;
    case "error":
      return "错误";
    default:
      return "node";
  }
}

function nodeTime(node: TraceNode): string | undefined {
  if (node.kind !== "run_start" || !node.at) {
    return undefined;
  }
  const date = new Date(node.at);
  if (Number.isNaN(date.getTime())) {
    return node.at;
  }
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function nodeSummary(node: TraceNode): string | undefined {
  switch (node.kind) {
    case "generation":
      return node.status === "running" ? "生成中…" : node.status;
    case "tool":
      if (node.summary) {
        return node.summary;
      }
      return node.status === "running" ? "执行中…" : node.status;
    case "error":
      return node.message;
    default:
      return undefined;
  }
}

type TraceTimelineProps = {
  nodes: TraceNode[];
  isLive?: boolean;
};

export function TraceTimeline({ nodes, isLive = false }: TraceTimelineProps) {
  return (
    <div className="trace-timeline" data-trace-timeline>
      {isLive ? (
        <div className="trace-live-indicator" data-trace-live>
          <span className="live-dot" aria-hidden />
          <span>进行中</span>
        </div>
      ) : null}
      <div className="trace-timeline-list">
        {nodes.map((node) => {
          const summary = nodeSummary(node);
          const time = nodeTime(node);
          return (
            <div
              key={node.id}
              className={nodeClassName(node)}
              data-trace-node={node.kind}
              data-trace-node-id={node.id}
            >
              <div className="trace-node-title">{nodeTitle(node)}</div>
              {time ? <div className="trace-node-time">{time}</div> : null}
              {summary ? (
                node.kind === "tool" ? (
                  <button type="button" className="trace-node-summary">
                    {summary}
                  </button>
                ) : (
                  <div className="trace-node-summary">{summary}</div>
                )
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
