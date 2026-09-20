import { describe, expect, it } from "vitest";
import { PermissionBroker } from "./permission-broker.js";

const baseInput = {
  requestId: "req-1",
  sessionId: "session-1",
  toolName: "echo",
  runId: "run-1",
};

describe("PermissionBroker", () => {
  it("resolves wait with allow true when respond allows once", async () => {
    const broker = new PermissionBroker();
    const waitPromise = broker.wait(baseInput);

    expect(broker.respond({ requestId: "req-1", allow: true })).toBe(true);
    await expect(waitPromise).resolves.toEqual({ allow: true });
  });

  it("resolves wait with allow false when respond denies", async () => {
    const broker = new PermissionBroker();
    const waitPromise = broker.wait(baseInput);

    expect(broker.respond({ requestId: "req-1", allow: false })).toBe(true);
    await expect(waitPromise).resolves.toEqual({ allow: false });
  });

  it("records session allowance when respond allows with session scope", async () => {
    const broker = new PermissionBroker();
    const waitPromise = broker.wait(baseInput);

    broker.respond({ requestId: "req-1", allow: true, scope: "session" });
    await expect(waitPromise).resolves.toEqual({ allow: true });
    expect(broker.isSessionAllowed("session-1", "echo")).toBe(true);
  });

  it("does not record session allowance when respond denies even with session scope", async () => {
    const broker = new PermissionBroker();
    const waitPromise = broker.wait(baseInput);

    broker.respond({ requestId: "req-1", allow: false, scope: "session" });
    await expect(waitPromise).resolves.toEqual({ allow: false });
    expect(broker.isSessionAllowed("session-1", "echo")).toBe(false);
  });

  it("returns false when responding to an unknown request id", () => {
    const broker = new PermissionBroker();

    expect(broker.respond({ requestId: "missing", allow: true })).toBe(false);
  });

  it("allowSession makes isSessionAllowed return true", () => {
    const broker = new PermissionBroker();

    expect(broker.isSessionAllowed("session-1", "echo")).toBe(false);
    broker.allowSession("session-1", "echo");
    expect(broker.isSessionAllowed("session-1", "echo")).toBe(true);
    expect(broker.isSessionAllowed("session-1", "read_file")).toBe(false);
    expect(broker.isSessionAllowed("session-2", "echo")).toBe(false);
  });

  it("cancelRun rejects pending waits for that run with AbortError", async () => {
    const broker = new PermissionBroker();
    const waitPromise = broker.wait(baseInput);

    broker.cancelRun("run-1");

    await expect(waitPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(broker.respond({ requestId: "req-1", allow: true })).toBe(false);
  });

  it("cancelRun does not reject waits for other runs", async () => {
    const broker = new PermissionBroker();
    const waitPromise = broker.wait({
      ...baseInput,
      requestId: "req-2",
      runId: "run-2",
    });

    broker.cancelRun("run-1");

    expect(broker.respond({ requestId: "req-2", allow: true })).toBe(true);
    await expect(waitPromise).resolves.toEqual({ allow: true });
  });

  it("rejects wait immediately when signal is already aborted", async () => {
    const broker = new PermissionBroker();
    const controller = new AbortController();
    controller.abort();

    const waitPromise = broker.wait(baseInput, controller.signal);

    await expect(waitPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(broker.respond({ requestId: "req-1", allow: true })).toBe(false);
  });

  it("rejects wait when signal aborts after registration", async () => {
    const broker = new PermissionBroker();
    const controller = new AbortController();
    const waitPromise = broker.wait(baseInput, controller.signal);

    controller.abort();

    await expect(waitPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(broker.respond({ requestId: "req-1", allow: true })).toBe(false);
  });
});
