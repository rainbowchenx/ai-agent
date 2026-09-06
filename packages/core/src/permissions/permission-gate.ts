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
 */
export async function evaluatePermission(input: {
  policy: PermissionPolicy;
  toolName: string;
  arguments: unknown;
  onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionDecision>;
  onRequest?: (request: PermissionRequest) => void;
}): Promise<{ allow: boolean; requestId?: string }> {
  const { policy, toolName } = input;

  if (policy.mode === "allowlist") {
    return { allow: policy.allowlist.includes(toolName) };
  }

  if (policy.mode === "ask_all") {
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
    const decision = await input.onPermissionRequest(request);
    return { allow: decision.allow, requestId };
  }

  return { allow: true };
}
