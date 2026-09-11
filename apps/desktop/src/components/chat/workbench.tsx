import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useSessionStore } from "@/stores/session-store";
import { ChatPane } from "./chat-pane";
import { RunDetails } from "./run-details";
import { SessionList } from "./session-list";

export function Workbench() {
  const baseUrl = useSessionStore((s) => s.baseUrl);
  const health = useSessionStore((s) => s.health);
  const error = useSessionStore((s) => s.error);

  return (
    <div className="flex h-screen flex-col" data-workbench>
      <header className="flex items-center justify-between border-b px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold">agent2026 工作台</h1>
          <p className="text-xs text-muted-foreground">
            占位 UI · 只投影 RunEvent
          </p>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" data-settings-sheet>
              设置
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>本机 Server</SheetTitle>
              <SheetDescription>
                Renderer 只走 HTTP/WS，不执行模型或工具。
              </SheetDescription>
            </SheetHeader>
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">base URL</dt>
                <dd data-testid="server-base-url" className="font-mono text-xs">
                  {baseUrl || "…"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">health</dt>
                <dd data-testid="server-health" className="font-mono text-xs">
                  {health}
                </dd>
              </div>
            </dl>
          </SheetContent>
        </Sheet>
      </header>
      {error ? (
        <p
          className="border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          data-app-error
        >
          {error}
        </p>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)_18rem]">
        <SessionList />
        <ChatPane />
        <RunDetails />
      </div>
    </div>
  );
}
