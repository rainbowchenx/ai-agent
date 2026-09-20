import { useEffect, useRef } from "react";
import { GitBranch } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSessionStore } from "@/stores/session-store";
import { Composer } from "./composer";
import { MessageBubble } from "./message-bubble";
import { ToolCard } from "./tool-card";

export function ChatPane() {
  const items = useSessionStore((s) => s.run.items);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const status = useSessionStore((s) => s.run.status);
  const tracePanelOpen = useSessionStore((s) => s.tracePanelOpen);
  const setTracePanelOpen = useSessionStore((s) => s.setTracePanelOpen);
  const respondPermission = useSessionStore((s) => s.respondPermission);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items, status]);

  return (
    <section className="panel" data-chat-pane>
      <div className="panel-header session-header">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="panel-title session-title">对话</h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            {selectedSessionId ?? "未选择会话"} · {status}
          </span>
        </div>
        <button
          type="button"
          className={`trace-toggle${tracePanelOpen ? " active" : ""}`}
          data-trace-toggle
          aria-pressed={tracePanelOpen}
          onClick={() => setTracePanelOpen(!tracePanelOpen)}
        >
          <GitBranch width={16} height={16} aria-hidden />
          调用轨迹
        </button>
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
                <MessageBubble
                  key={item.id}
                  item={item}
                  onRespondPermission={respondPermission}
                />
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
