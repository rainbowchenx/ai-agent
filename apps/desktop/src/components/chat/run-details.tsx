import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSessionStore } from "@/stores/session-store";

export function RunDetails() {
  const run = useSessionStore((s) => s.run);
  const injectDemoTool = useSessionStore((s) => s.injectDemoTool);

  return (
    <aside className="panel" data-run-details>
      <div className="panel-header" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <h2 className="panel-title">运行详情 / Trace</h2>
        <dl className="mt-2 space-y-1 font-mono text-[10px] text-muted-foreground">
          <div>
            <dt className="inline">runId </dt>
            <dd className="inline" data-run-id>
              {run.runId ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="inline">traceId </dt>
            <dd className="inline" data-trace-id>
              {run.traceId ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="inline">status </dt>
            <dd className="inline" data-run-status>
              {run.status}
            </dd>
          </div>
        </dl>
      </div>
      <div className="border-b px-3 py-2">
        <Button
          size="sm"
          variant="outline"
          data-demo-tool
          onClick={injectDemoTool}
        >
          演示工具卡
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <pre
          data-trace-panel
          className="whitespace-pre-wrap break-all p-3 font-mono text-[10px] leading-relaxed text-muted-foreground"
        >
          {run.traceNodes.length === 0
            ? "尚无 RunEvent。发送消息或点「演示工具卡」。"
            : run.traceNodes.map((node) => JSON.stringify(node)).join("\n")}
        </pre>
      </ScrollArea>
    </aside>
  );
}
