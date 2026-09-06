import type { ToolDefinition } from "../types/messages.js";
import type { ToolExecutionContext, ToolPort } from "../ports/tool-port.js";

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
) => Promise<string>;

/** In-memory {@link ToolPort}: register handlers, list defs, execute by name. */
export class ToolRegistry implements ToolPort {
  private readonly tools = new Map<
    string,
    { def: ToolDefinition; handler: ToolHandler }
  >();

  register(def: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(def.name, { def, handler });
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].map((entry) => entry.def);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<string> {
    const entry = this.tools.get(name);
    if (!entry) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return entry.handler(args, ctx);
  }
}
