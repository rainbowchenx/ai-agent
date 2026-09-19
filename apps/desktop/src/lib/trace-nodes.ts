import type { GetRunTraceResponse, RunEvent } from "@agent2026/shared";

export type TraceNode =
  | { id: string; kind: "run_start"; at?: string }
  | { id: string; kind: "run_end"; reason: "completed" | "stopped" | "error" }
  | {
      id: string;
      kind: "generation";
      status: "running" | "ok" | "error";
      name?: string;
    }
  | {
      id: string;
      kind: "tool";
      name: string;
      toolCallId: string;
      status: "running" | "ok" | "error";
      summary?: string;
    }
  | { id: string; kind: "error"; message: string };

type SpanStatus = "ok" | "error";

function terminalSpanStatus(
  reason: Extract<RunEvent, { type: "run_end" }>["reason"],
): SpanStatus {
  return reason === "error" ? "error" : "ok";
}

function truncateSummary(result: string): string {
  return result.slice(0, 200);
}

function findOpenGeneration(
  nodes: TraceNode[],
): Extract<TraceNode, { kind: "generation" }> | undefined {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (node?.kind === "generation" && node.status === "running") {
      return node;
    }
  }
  return undefined;
}

function findOpenTools(nodes: TraceNode[]): Extract<TraceNode, { kind: "tool" }>[] {
  return nodes.filter(
    (node): node is Extract<TraceNode, { kind: "tool" }> =>
      node.kind === "tool" && node.status === "running",
  );
}

function updateNode(
  nodes: TraceNode[],
  id: string,
  patch: Partial<TraceNode>,
): TraceNode[] {
  return nodes.map((node) => (node.id === id ? { ...node, ...patch } : node));
}

function finalizeOpenGeneration(
  nodes: TraceNode[],
  status: SpanStatus,
): TraceNode[] {
  const open = findOpenGeneration(nodes);
  if (!open) {
    return nodes;
  }
  return updateNode(nodes, open.id, { status });
}

function finalizeOpenTools(nodes: TraceNode[], status: SpanStatus): TraceNode[] {
  let next = nodes;
  for (const tool of findOpenTools(nodes)) {
    next = updateNode(next, tool.id, { status });
  }
  return next;
}

function generationCount(nodes: TraceNode[]): number {
  return nodes.filter((node) => node.kind === "generation").length;
}

function openGeneration(
  nodes: TraceNode[],
  runId: string,
): TraceNode[] {
  if (findOpenGeneration(nodes)) {
    return nodes;
  }
  const index = generationCount(nodes) + 1;
  return [
    ...nodes,
    {
      id: `${runId}:gen-${index}`,
      kind: "generation",
      status: "running",
      name: "generation",
    },
  ];
}

export function applyTraceEvent(
  nodes: TraceNode[],
  event: RunEvent,
): TraceNode[] {
  switch (event.type) {
    case "run_start":
      return [
        ...nodes,
        { id: `${event.runId}:start`, kind: "run_start" },
      ];

    case "message_delta":
      return openGeneration(nodes, event.runId);

    case "tool_start": {
      let next = finalizeOpenGeneration(nodes, "ok");
      next = [
        ...next,
        {
          id: event.toolCallId,
          kind: "tool",
          name: event.name,
          toolCallId: event.toolCallId,
          status: "running",
        },
      ];
      return next;
    }

    case "tool_end": {
      const status: SpanStatus = event.isError ? "error" : "ok";
      return updateNode(nodes, event.toolCallId, {
        status,
        summary: truncateSummary(event.result),
      });
    }

    case "error": {
      let next = finalizeOpenGeneration(nodes, "error");
      next = finalizeOpenTools(next, "error");
      return [
        ...next,
        { id: `${event.runId}:error`, kind: "error", message: event.message },
      ];
    }

    case "run_end": {
      const status = terminalSpanStatus(event.reason);
      let next = finalizeOpenGeneration(nodes, status);
      next = finalizeOpenTools(next, status);
      return [
        ...next,
        { id: `${event.runId}:end`, kind: "run_end", reason: event.reason },
      ];
    }

    default:
      return nodes;
  }
}

function spanToNode(
  span: GetRunTraceResponse["spans"][number],
  status: "running" | "ok" | "error",
): TraceNode {
  if (span.kind === "generation") {
    return {
      id: span.spanId,
      kind: "generation",
      status,
      name: span.name,
    };
  }

  if (span.kind === "tool") {
    return {
      id: span.spanId,
      kind: "tool",
      name: span.name,
      toolCallId: span.spanId,
      status,
      summary: span.summary,
    };
  }

  return {
    id: span.spanId,
    kind: "generation",
    status,
    name: span.name,
  };
}

function spanStatus(
  span: GetRunTraceResponse["spans"][number],
  isLast: boolean,
  traceStatus: GetRunTraceResponse["status"],
): "running" | "ok" | "error" {
  if (span.endedAt) {
    return span.status === "error" ? "error" : "ok";
  }
  if (isLast && traceStatus === "running") {
    return "running";
  }
  return span.status === "error" ? "error" : "ok";
}

export function spansToNodes(
  spans: GetRunTraceResponse["spans"],
  meta: { status: GetRunTraceResponse["status"] },
): TraceNode[] {
  if (spans.length === 0) {
    return [];
  }

  const nodes: TraceNode[] = [{ id: "history:start", kind: "run_start" }];

  spans.forEach((span, index) => {
    const isLast = index === spans.length - 1;
    nodes.push(spanToNode(span, spanStatus(span, isLast, meta.status)));
  });

  if (meta.status !== "running") {
    nodes.push({
      id: "history:end",
      kind: "run_end",
      reason: meta.status,
    });
  }

  return nodes;
}
