import { FileText, Shield } from "lucide-react";
import type { ChatItem } from "@/lib/apply-run-event";

type PermissionItem = Extract<ChatItem, { kind: "permission" }>;
type PermissionStatus = PermissionItem["status"];

const STATUS_LABEL: Record<Exclude<PermissionStatus, "pending">, string> = {
  allowed: "已允许",
  session_allowed: "本会话已允许",
  denied: "已拒绝",
  expired: "已失效",
};

function permissionSubtitle(toolName: string): string {
  if (toolName === "read_file") {
    return "Agent 希望读取本地文件以继续完成任务";
  }
  return "Agent 希望调用该工具以继续完成任务";
}

function formatPermissionArgs(args: unknown): string {
  if (args != null && typeof args === "object" && !Array.isArray(args)) {
    return Object.entries(args as Record<string, unknown>)
      .map(([key, value]) => {
        const display =
          typeof value === "string" ? value : JSON.stringify(value);
        return `${key}: ${display}`;
      })
      .join("\n");
  }
  try {
    return JSON.stringify(args ?? null, null, 2);
  } catch {
    return String(args);
  }
}

export function PermissionCard({
  item,
  onRespond,
}: {
  item: PermissionItem;
  onRespond: (
    requestId: string,
    allow: boolean,
    scope?: "once" | "session",
  ) => void;
}) {
  const pending = item.status === "pending";
  const argsText = formatPermissionArgs(item.arguments);

  return (
    <div
      data-message
      data-message-kind="permission"
      data-message-id={item.id}
      data-request-id={item.requestId}
      data-permission-status={item.status}
      className="permission-card-row"
    >
      <div className="permission-card-avatar" aria-hidden>
        <Shield size={16} />
      </div>
      <div className="permission-card">
        <div className="permission-card-header">
          <div className="permission-card-tool-icon" aria-hidden>
            <FileText size={16} />
          </div>
          <div className="permission-card-titles">
            <div className="permission-card-title">
              工具权限请求 · {item.toolName}
            </div>
            <div className="permission-card-subtitle">
              {permissionSubtitle(item.toolName)}
            </div>
          </div>
        </div>
        <pre className="permission-card-args">{argsText}</pre>
        <div className="permission-card-actions">
          <button
            type="button"
            className="permission-card-btn permission-card-btn-allow"
            disabled={!pending}
            data-permission-action="allow"
            onClick={() => onRespond(item.requestId, true, "once")}
          >
            允许
          </button>
          <button
            type="button"
            className="permission-card-btn permission-card-btn-session"
            disabled={!pending}
            data-permission-action="session"
            onClick={() => onRespond(item.requestId, true, "session")}
          >
            本会话允许
          </button>
          <button
            type="button"
            className="permission-card-btn permission-card-btn-deny"
            disabled={!pending}
            data-permission-action="deny"
            onClick={() => onRespond(item.requestId, false)}
          >
            拒绝
          </button>
        </div>
        {!pending ? (
          <div className="permission-card-result" data-permission-result>
            {STATUS_LABEL[item.status]}
          </div>
        ) : null}
      </div>
    </div>
  );
}
