export type SpanKind = "generation" | "tool" | "permission";

export interface TracePort {
  startTrace(input: {
    runId: string;
    sessionId: string;
  }): Promise<{ traceId: string }>;

  startSpan(input: {
    traceId: string;
    name: string;
    kind: SpanKind;
    parentSpanId?: string;
  }): Promise<{ spanId: string }>;

  endSpan(input: {
    spanId: string;
    status?: "ok" | "error";
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
