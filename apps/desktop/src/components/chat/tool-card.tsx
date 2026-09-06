import { useState } from "react";
import type { ChatItem } from "@/lib/apply-run-event";
import { cn } from "@/lib/utils";

export function ToolCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "tool" }>;
}) {
  const [open, setOpen] = useState(item.status === "running");

  return (
    <div
      data-tool-card
      data-tool-call-id={item.toolCallId}
      data-tool-name={item.name}
      data-tool-status={item.status}
      className={cn(
        "rounded-md border bg-card text-sm",
        item.isError && "border-destructive/50",
      )}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="font-mono text-xs">
          {item.name}
          <span className="ml-2 text-muted-foreground">{item.status}</span>
        </span>
        <span className="text-xs text-muted-foreground">{open ? "收起" : "展开"}</span>
      </button>
      {open ? (
        <div className="space-y-2 border-t px-3 py-2">
          <div>
            <div className="text-xs text-muted-foreground">arguments</div>
            <pre className="overflow-x-auto text-xs">
              {JSON.stringify(item.arguments ?? {}, null, 2)}
            </pre>
          </div>
          {item.result != null ? (
            <div>
              <div className="text-xs text-muted-foreground">
                {item.isError ? "error" : "result"}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
                {item.result}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
