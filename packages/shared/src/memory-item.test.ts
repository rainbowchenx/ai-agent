import { describe, expect, it } from "vitest";
import { memoryItemSchema } from "./memory-item.js";

describe("memoryItemSchema", () => {
  it("parses a valid memory item", () => {
    const item = memoryItemSchema.parse({
      kind: "fact",
      when: "When working on TypeScript projects",
      do: "Use pnpm as the default package manager",
      outcome: "User explicitly requested pnpm for all future tasks",
      confidence: 0.85,
      status: "frozen",
      sourceRunId: "run-123",
      sourceSessionId: "session-456",
      sourceTraceId: "trace-789",
    });

    expect(item.kind).toBe("fact");
    expect(item.confidence).toBe(0.85);
    expect(item.status).toBe("frozen");
    expect(item.sourceTraceId).toBe("trace-789");
  });

  it("rejects confidence out of range", () => {
    expect(() =>
      memoryItemSchema.parse({
        kind: "fact",
        when: "When working on TypeScript projects",
        do: "Use pnpm as the default package manager",
        outcome: "User explicitly requested pnpm for all future tasks",
        confidence: 1.5,
        status: "frozen",
        sourceRunId: "run-123",
        sourceSessionId: "session-456",
      }),
    ).toThrow();
  });
});
