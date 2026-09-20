import type { AgentMessage, ToolCall } from "../types/messages.js";
import type { ModelStreamEvent } from "../ports/model-port.js";
import { evaluatePermission } from "../permissions/permission-gate.js";
import type {
  RunnerEndReason,
  RunnerEvent,
  RunnerOptions,
  RunnerRunInput,
  RunnerRunResult,
} from "./types.js";

const TOOL_CANCELLED = "Tool call cancelled";
const TOOL_LIMIT_EXCEEDED = "Tool call limit exceeded";

/**
 * ReAct loop: model stream → optional tools → model again, until text or limits.
 *
 * Events stay in core and are structurally mappable to shared `RunEvent` later.
 */
export class Runner {
  private readonly maxTurns: number;
  private readonly maxToolCalls: number;

  constructor(options: RunnerOptions) {
    this.maxTurns = options.maxTurns;
    this.maxToolCalls = options.maxToolCalls ?? Number.POSITIVE_INFINITY;
  }

  /**
   * Drive one run to completion, abort, or error.
   *
   * @param input.messages - prior session messages (excluding the new user turn)
   * @param input.userMessage - triggering user message, appended first
   * @returns grown messages plus the terminal {@link RunnerEndReason}
   */
  async run(input: RunnerRunInput): Promise<RunnerRunResult> {
    const runId = input.runId ?? crypto.randomUUID();
    const sessionId = input.sessionId ?? crypto.randomUUID();
    const traceId = input.traceId ?? crypto.randomUUID();
    const emit = (event: RunnerEvent): void => {
      input.onEvent(event);
    };

    const messages: AgentMessage[] = [...input.messages, input.userMessage];
    emit({ type: "run_start", runId, sessionId, traceId });

    if (input.signal?.aborted) {
      return this.end(emit, messages, runId, "stopped");
    }

    let toolCallsThisRun = 0;

    try {
      for (let turn = 0; turn < this.maxTurns; turn += 1) {
        if (input.signal?.aborted) {
          this.cancelUnpairedFromLastAssistant(messages, runId, emit);
          return this.end(emit, messages, runId, "stopped");
        }

        const { text, toolCalls, aborted } = await this.collectModelTurn(
          input,
          messages,
          runId,
          emit,
        );

        if (aborted) {
          this.appendAssistant(messages, text, toolCalls);
          this.writeSyntheticToolResults(
            messages,
            toolCalls,
            runId,
            emit,
            TOOL_CANCELLED,
          );
          return this.end(emit, messages, runId, "stopped");
        }

        if (toolCalls.length === 0) {
          this.appendAssistant(messages, text, []);
          return this.end(emit, messages, runId, "completed");
        }

        this.appendAssistant(messages, text, toolCalls);

        for (const call of toolCalls) {
          if (input.signal?.aborted) {
            this.writeSyntheticToolResults(
              messages,
              toolCalls,
              runId,
              emit,
              TOOL_CANCELLED,
            );
            return this.end(emit, messages, runId, "stopped");
          }
          if (toolCallsThisRun >= this.maxToolCalls) {
            this.writeSyntheticToolResults(
              messages,
              toolCalls,
              runId,
              emit,
              TOOL_LIMIT_EXCEEDED,
            );
            break;
          }
          toolCallsThisRun += 1;
          const status = await this.executeToolCall(
            input,
            messages,
            runId,
            sessionId,
            call,
            emit,
          );
          if (status === "aborted") {
            this.writeSyntheticToolResults(
              messages,
              toolCalls,
              runId,
              emit,
              TOOL_CANCELLED,
            );
            return this.end(emit, messages, runId, "stopped");
          }
        }
      }

      return this.end(emit, messages, runId, "completed");
    } catch (err) {
      if (isAbortError(err) || input.signal?.aborted) {
        this.cancelUnpairedFromLastAssistant(messages, runId, emit);
        return this.end(emit, messages, runId, "stopped");
      }
      const message = errorMessage(err);
      emit({ type: "error", runId, message });
      return this.end(emit, messages, runId, "error");
    }
  }

  private end(
    emit: (event: RunnerEvent) => void,
    messages: AgentMessage[],
    runId: string,
    reason: RunnerEndReason,
  ): RunnerRunResult {
    emit({ type: "run_end", runId, reason });
    return { messages, runId, reason };
  }

  private appendAssistant(
    messages: AgentMessage[],
    text: string,
    toolCalls: ToolCall[],
  ): void {
    messages.push({
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
  }

  private async collectModelTurn(
    input: RunnerRunInput,
    messages: AgentMessage[],
    runId: string,
    emit: (event: RunnerEvent) => void,
  ): Promise<{ text: string; toolCalls: ToolCall[]; aborted: boolean }> {
    let text = "";
    const toolCalls: ToolCall[] = [];

    try {
      for await (const event of input.model.stream({
        messages,
        tools: input.tools.list(),
        signal: input.signal,
      })) {
        if (input.signal?.aborted) {
          return { text, toolCalls, aborted: true };
        }
        this.applyStreamEvent(event, runId, emit, (chunk) => {
          text += chunk;
        }, (call) => {
          toolCalls.push(call);
        });
      }
    } catch (err) {
      if (isAbortError(err)) {
        return { text, toolCalls, aborted: true };
      }
      throw err;
    }

    return { text, toolCalls, aborted: Boolean(input.signal?.aborted) };
  }

  private applyStreamEvent(
    event: ModelStreamEvent,
    runId: string,
    emit: (event: RunnerEvent) => void,
    onText: (chunk: string) => void,
    onTool: (call: ToolCall) => void,
  ): void {
    if (event.type === "text_delta") {
      onText(event.text);
      emit({ type: "message_delta", runId, delta: event.text });
      return;
    }
    if (event.type === "tool_call") {
      onTool({
        id: event.id,
        name: event.name,
        arguments: event.arguments,
      });
    }
  }

  private async executeToolCall(
    input: RunnerRunInput,
    messages: AgentMessage[],
    runId: string,
    sessionId: string,
    call: ToolCall,
    emit: (event: RunnerEvent) => void,
  ): Promise<"ok" | "aborted"> {
    const decision = await evaluatePermission({
      policy: input.permissions,
      toolName: call.name,
      arguments: call.arguments,
      onPermissionRequest: input.onPermissionRequest,
      isPreAllowed: input.isPreAllowed,
      signal: input.signal,
      onRequest: (request) => {
        emit({
          type: "permission_request",
          runId,
          requestId: request.requestId,
          toolName: request.toolName,
          arguments: request.arguments,
        });
      },
    });

    if (decision.aborted || input.signal?.aborted) {
      return "aborted";
    }

    if (!decision.allow) {
      const result = `Permission denied for tool: ${call.name}`;
      emit({
        type: "tool_end",
        runId,
        toolCallId: call.id,
        name: call.name,
        result,
        isError: true,
      });
      messages.push({ role: "tool", toolCallId: call.id, content: result });
      return "ok";
    }

    if (input.signal?.aborted) {
      return "aborted";
    }

    emit({
      type: "tool_start",
      runId,
      toolCallId: call.id,
      name: call.name,
      arguments: call.arguments,
    });

    let result: string;
    let isError = false;
    try {
      result = await input.tools.execute(call.name, call.arguments, {
        sessionId,
        runId,
        signal: input.signal,
      });
    } catch (err) {
      if (isAbortError(err) || input.signal?.aborted) {
        return "aborted";
      }
      isError = true;
      result = errorMessage(err);
    }

    emit({
      type: "tool_end",
      runId,
      toolCallId: call.id,
      name: call.name,
      result,
      ...(isError ? { isError: true } : {}),
    });
    messages.push({ role: "tool", toolCallId: call.id, content: result });
    return "ok";
  }

  private cancelUnpairedFromLastAssistant(
    messages: AgentMessage[],
    runId: string,
    emit: (event: RunnerEvent) => void,
  ): void {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg?.role === "assistant") {
        this.writeSyntheticToolResults(
          messages,
          msg.toolCalls ?? [],
          runId,
          emit,
          TOOL_CANCELLED,
        );
        return;
      }
    }
  }

  private writeSyntheticToolResults(
    messages: AgentMessage[],
    toolCalls: ToolCall[],
    runId: string,
    emit: (event: RunnerEvent) => void,
    result: string,
  ): void {
    const answered = new Set<string>();
    for (const msg of messages) {
      if (msg.role === "tool") {
        answered.add(msg.toolCallId);
      }
    }
    for (const call of toolCalls) {
      if (answered.has(call.id)) {
        continue;
      }
      emit({
        type: "tool_end",
        runId,
        toolCallId: call.id,
        name: call.name,
        result,
        isError: true,
      });
      messages.push({ role: "tool", toolCallId: call.id, content: result });
      answered.add(call.id);
    }
  }
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
