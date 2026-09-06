import type { ChatItem } from "@/lib/apply-run-event";
import { cn } from "@/lib/utils";

export function MessageBubble({
  item,
}: {
  item: Extract<ChatItem, { kind: "user" | "assistant" | "error" | "permission" }>;
}) {
  if (item.kind === "error") {
    return (
      <div
        data-message
        data-message-kind="error"
        data-message-id={item.id}
        className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
      >
        {item.message}
      </div>
    );
  }

  if (item.kind === "permission") {
    return (
      <div
        data-message
        data-message-kind="permission"
        data-message-id={item.id}
        data-request-id={item.requestId}
        className="rounded-md border px-3 py-2 text-sm"
      >
        <div className="text-xs text-muted-foreground">权限请求</div>
        <div className="font-medium">{item.toolName}</div>
        <pre className="mt-1 overflow-x-auto text-xs text-muted-foreground">
          {JSON.stringify(item.arguments, null, 2)}
        </pre>
      </div>
    );
  }

  const isUser = item.kind === "user";
  return (
    <div
      data-message
      data-message-kind={item.kind}
      data-message-id={item.id}
      className={cn("flex", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap break-words",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground",
        )}
      >
        {item.kind === "assistant" && item.streaming && !item.content
          ? "…"
          : item.content}
        {item.kind === "assistant" && item.streaming && item.content ? (
          <span className="ml-0.5 inline-block animate-pulse">▍</span>
        ) : null}
      </div>
    </div>
  );
}
