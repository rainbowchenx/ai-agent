import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSessionStore } from "@/stores/session-store";

export function Composer() {
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const status = useSessionStore((s) => s.run.status);
  const runId = useSessionStore((s) => s.run.runId);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const stopCurrentRun = useSessionStore((s) => s.stopCurrentRun);
  const [value, setValue] = useState("");
  const running = status === "running";

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim() || !selectedSessionId || running) {
      return;
    }
    sendMessage(value);
    setValue("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form
      data-composer
      onSubmit={onSubmit}
      className="flex items-center gap-2 border-t p-3"
    >
      <Input
        data-composer-input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={!selectedSessionId || running}
        placeholder={selectedSessionId ? "发给 Agent…" : "先新建或选择会话"}
      />
      <Button
        type="submit"
        data-composer-send
        disabled={!selectedSessionId || running || !value.trim()}
      >
        发送
      </Button>
      <Button
        type="button"
        variant="destructive"
        data-stop-run
        data-run-id={runId ?? ""}
        disabled={!running || !runId}
        onClick={() => void stopCurrentRun()}
      >
        停止
      </Button>
    </form>
  );
}
