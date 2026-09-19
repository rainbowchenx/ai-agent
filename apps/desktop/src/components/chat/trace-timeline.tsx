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
    case "run_start":
      return node.at;
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
          return (
            <div
              key={node.id}
              className={nodeClassName(node)}
              data-trace-node={node.kind}
              data-trace-node-id={node.id}
            >
              <div className="trace-node-title">{nodeTitle(node)}</div>
              {summary ? (
                <div className="trace-node-summary">{summary}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
