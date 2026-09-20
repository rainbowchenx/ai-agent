import { describe, expect, it } from "vitest";
import {
  createPermissionResponse,
  createRunMessage,
  httpToWsUrl,
  parseRunEvent,
} from "./ws-client.js";

describe("httpToWsUrl", () => {
  it("maps local http base to /ws", () => {
    expect(httpToWsUrl("http://127.0.0.1:9800")).toBe(
      "ws://127.0.0.1:9800/ws",
    );
    expect(httpToWsUrl("http://127.0.0.1:9800/")).toBe(
      "ws://127.0.0.1:9800/ws",
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

describe("createPermissionResponse", () => {
  it("omits scope for once allow and for deny", () => {
    expect(createPermissionResponse("req-1", true)).toEqual({
      type: "permission_response",
      requestId: "req-1",
      allow: true,
    });
    expect(createPermissionResponse("req-1", true, "once")).toEqual({
      type: "permission_response",
      requestId: "req-1",
      allow: true,
    });
    expect(createPermissionResponse("req-1", false, "session")).toEqual({
      type: "permission_response",
      requestId: "req-1",
      allow: false,
    });
  });

  it("includes scope only for session allow", () => {
    expect(createPermissionResponse("req-2", true, "session")).toEqual({
      type: "permission_response",
      requestId: "req-2",
      allow: true,
      scope: "session",
    });
  });
});
