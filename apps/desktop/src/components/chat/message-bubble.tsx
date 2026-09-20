import type { ChatItem } from "@/lib/apply-run-event";
import { cn } from "@/lib/utils";
import { PermissionCard } from "./permission-card";

export function MessageBubble({
  item,
  onRespondPermission,
}: {
  item: Extract<ChatItem, { kind: "user" | "assistant" | "error" | "permission" }>;
  onRespondPermission?: (
    requestId: string,
    allow: boolean,
    scope?: "once" | "session",
  ) => void;
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
      <PermissionCard
        item={item}
        onRespond={onRespondPermission ?? (() => undefined)}
      />
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
