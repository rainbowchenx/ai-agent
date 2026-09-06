import { describe, expect, it } from "vitest";
import { RunHub } from "./run-hub.js";

describe("RunHub", () => {
  it("creates an AbortController and aborts it by runId", () => {
    const hub = new RunHub();
    const runId = "run-1";
    const controller = hub.create(runId);

    expect(controller.signal.aborted).toBe(false);
    expect(hub.abort(runId)).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it("returns false when aborting an unknown or forgotten run", () => {
    const hub = new RunHub();
    expect(hub.abort("missing")).toBe(false);

    const runId = "run-2";
    hub.create(runId);
    hub.forget(runId);
    expect(hub.abort(runId)).toBe(false);
  });
});
