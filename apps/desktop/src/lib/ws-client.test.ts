import { describe, expect, it } from "vitest";
import {
  createRunMessage,
  httpToWsUrl,
  parseRunEvent,
} from "./ws-client.js";

describe("httpToWsUrl", () => {
  it("maps local http base to /ws", () => {
    expect(httpToWsUrl("http://127.0.0.1:8787")).toBe(
      "ws://127.0.0.1:8787/ws",
    );
    expect(httpToWsUrl("http://127.0.0.1:8787/")).toBe(
      "ws://127.0.0.1:8787/ws",
    );
  });
});

describe("parseRunEvent", () => {
  it("accepts shared RunEvent shapes and rejects junk", () => {
    expect(
      parseRunEvent(
        JSON.stringify({
          type: "run_start",
          runId: "r",
          sessionId: "s",
          traceId: "t",
        }),
      ),
    ).toEqual({
      type: "run_start",
      runId: "r",
      sessionId: "s",
      traceId: "t",
    });
    expect(parseRunEvent("{")).toBeNull();
    expect(parseRunEvent(JSON.stringify({ type: "nope" }))).toBeNull();
  });
});

describe("createRunMessage", () => {
  it("builds the WS run request", () => {
    expect(createRunMessage("s1", "hello")).toEqual({
      type: "run",
      sessionId: "s1",
      content: "hello",
    });
  });
});
