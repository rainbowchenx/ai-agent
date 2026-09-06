import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSessionStore } from "@/stores/session-store";

export function SessionList() {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const selectSession = useSessionStore((s) => s.selectSession);
  const createAndSelect = useSessionStore((s) => s.createAndSelect);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-r bg-card"
      data-session-list
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-medium">会话</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-session-create>
              新建
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建会话</DialogTitle>
              <DialogDescription>标题可选，会话存在 SQLite。</DialogDescription>
            </DialogHeader>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="会话标题"
              data-session-title-input
            />
            <DialogFooter>
              <Button
                onClick={() => {
                  void createAndSelect(title.trim() || undefined).then(() => {
                    setTitle("");
                    setOpen(false);
                  });
                }}
              >
                创建
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <ScrollArea className="flex-1">
        <ul className="p-2">
          {sessions.length === 0 ? (
            <li className="px-2 py-6 text-center text-xs text-muted-foreground">
              暂无会话
            </li>
          ) : (
            sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  data-session-item
                  data-session-id={session.id}
                  onClick={() => void selectSession(session.id)}
                  className={`mb-1 w-full rounded-md px-2 py-2 text-left text-sm ${
                    selectedSessionId === session.id
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  }`}
                >
                  <div className="truncate">
                    {session.title || session.id.slice(0, 8)}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {session.id}
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      </ScrollArea>
    </aside>
  );
}
