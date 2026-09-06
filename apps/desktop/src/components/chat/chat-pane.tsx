import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSessionStore } from "@/stores/session-store";
import { Composer } from "./composer";
import { MessageBubble } from "./message-bubble";
import { ToolCard } from "./tool-card";

export function ChatPane() {
  const items = useSessionStore((s) => s.run.items);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const status = useSessionStore((s) => s.run.status);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items, status]);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" data-chat-pane>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-sm font-medium">对话</h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          {selectedSessionId ?? "未选择会话"} · {status}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div data-chat-list className="space-y-2 p-3">
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {selectedSessionId
                ? "发送一条消息，气泡会投影 RunEvent。"
                : "从左侧新建或选择会话。"}
            </p>
          ) : (
            items.map((item) =>
              item.kind === "tool" ? (
                <ToolCard key={item.id} item={item} />
              ) : (
                <MessageBubble key={item.id} item={item} />
              ),
            )
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <Composer />
    </section>
  );
}
