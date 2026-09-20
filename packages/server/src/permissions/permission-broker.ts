import type { PermissionDecision } from "@agent2026/core";

export type PermissionScope = "once" | "session";

type PendingEntry = {
  sessionId: string;
  toolName: string;
  runId: string;
  resolve: (decision: PermissionDecision) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

function createAbortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

export class PermissionBroker {
  private pending = new Map<string, PendingEntry>();
  private sessionAllow = new Map<string, Set<string>>();

  isSessionAllowed(sessionId: string, toolName: string): boolean {
    return this.sessionAllow.get(sessionId)?.has(toolName) ?? false;
  }

  allowSession(sessionId: string, toolName: string): void {
    let allowed = this.sessionAllow.get(sessionId);
    if (!allowed) {
      allowed = new Set();
      this.sessionAllow.set(sessionId, allowed);
    }
    allowed.add(toolName);
  }

  wait(
    input: {
      requestId: string;
      sessionId: string;
      toolName: string;
      runId: string;
    },
    signal?: AbortSignal,
  ): Promise<PermissionDecision> {
    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (
        settle: (value: PermissionDecision) => void,
        value: PermissionDecision,
      ): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.pending.delete(input.requestId);
        cleanup();
        settle(value);
      };

      const fail = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.pending.delete(input.requestId);
        cleanup();
        reject(error);
      };

      const onAbort = (): void => {
        fail(createAbortError());
      };

      const cleanup = (): void => {
        signal?.removeEventListener("abort", onAbort);
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(input.requestId, {
        sessionId: input.sessionId,
        toolName: input.toolName,
        runId: input.runId,
        resolve: (decision) => finish(resolve, decision),
        reject: fail,
        cleanup,
      });
    });
  }

  respond(input: {
    requestId: string;
    allow: boolean;
    scope?: PermissionScope;
  }): boolean {
    const entry = this.pending.get(input.requestId);
    if (!entry) {
      return false;
    }

    if (input.allow && input.scope === "session") {
      this.allowSession(entry.sessionId, entry.toolName);
    }

    entry.resolve({ allow: input.allow });
    return true;
  }

  cancelRun(runId: string): void {
    for (const [requestId, entry] of this.pending) {
      if (entry.runId !== runId) {
        continue;
      }
      this.pending.delete(requestId);
      entry.cleanup();
      entry.reject(createAbortError());
    }
  }
}
