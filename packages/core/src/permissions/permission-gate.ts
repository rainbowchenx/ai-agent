export type PermissionMode = "default" | "ask_all" | "allowlist";

export interface PermissionPolicy {
  mode: PermissionMode;
  allowlist: string[];
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  arguments: unknown;
}

export interface PermissionDecision {
  allow: boolean;
}

/**
 * Forced gate before any tool execute. Hooks must not bypass a deny.
 *
 * `default` auto-allows in P0 (read-ish builtins). Write/network/MCP
 * distinction is TODO(P1).
 *
 * In `ask_all`, the wait races `onPermissionRequest` against `signal`
 * so a user stop does not hang on the permission UI.
 */
export async function evaluatePermission(input: {
  policy: PermissionPolicy;
  toolName: string;
  arguments: unknown;
  onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionDecision>;
  onRequest?: (request: PermissionRequest) => void;
  isPreAllowed?: (toolName: string) => boolean;
  signal?: AbortSignal;
}): Promise<{ allow: boolean; requestId?: string; aborted?: boolean }> {
  const { policy, toolName } = input;

  if (policy.mode === "allowlist") {
    return { allow: policy.allowlist.includes(toolName) };
  }

  if (policy.mode === "ask_all") {
    if (input.isPreAllowed?.(toolName)) {
      return { allow: true };
    }
    const requestId = crypto.randomUUID();
    const request: PermissionRequest = {
      requestId,
      toolName,
      arguments: input.arguments,
    };
    input.onRequest?.(request);
    if (!input.onPermissionRequest) {
      return { allow: false, requestId };
    }
    const decision = await racePermissionResponse(
      input.onPermissionRequest(request),
      input.signal,
    );
    if (decision === "aborted") {
      return { allow: false, requestId, aborted: true };
    }
    return { allow: decision.allow, requestId };
  }

  return { allow: true };
}

async function racePermissionResponse(
  response: Promise<PermissionDecision>,
  signal?: AbortSignal,
): Promise<PermissionDecision | "aborted"> {
  if (!signal) {
    return response;
  }
  if (signal.aborted) {
    void response.catch(() => undefined);
    return "aborted";
  }

  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      void response.catch(() => undefined);
      resolve("aborted");
    };
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    response.then(
      (decision) => {
        cleanup();
        if (signal.aborted) {
          resolve("aborted");
          return;
        }
        resolve(decision);
      },
      (err) => {
        cleanup();
        if (signal.aborted) {
          resolve("aborted");
          return;
        }
        reject(err);
      },
    );
  });
}
