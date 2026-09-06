import { describe, expect, it } from "vitest";
import type { ModelPort, ModelStreamEvent } from "./model-port.js";

describe("ModelPort shape", () => {
  it("fake ModelPort is consumable with for await", async () => {
    const model: ModelPort = {
      id: "fake",
      async *stream() {
        yield { type: "text_delta", text: "hello" } satisfies ModelStreamEvent;
        yield {
          type: "tool_call",
          id: "call_1",
          name: "echo",
          arguments: { msg: "hi" },
        } satisfies ModelStreamEvent;
        yield {
          type: "usage",
          inputTokens: 10,
          outputTokens: 5,
        } satisfies ModelStreamEvent;
      },
    };

    const events: ModelStreamEvent[] = [];
    for await (const event of model.stream({ messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]?.type).toBe("text_delta");
    expect(events[1]?.type).toBe("tool_call");
    expect(events[2]?.type).toBe("usage");
  });
});
