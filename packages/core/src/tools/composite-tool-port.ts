import type { ToolExecutionContext, ToolPort } from "../ports/tool-port.js";
import type { ToolDefinition } from "../types/messages.js";

/**
 * Merge multiple ToolPorts into one. Detects duplicate tool names at
 * construction (or when `list()` is first forced via constructor check).
 */
export function createCompositeToolPort(ports: ToolPort[]): ToolPort {
  const nameToPort = new Map<string, ToolPort>();
  const definitions: ToolDefinition[] = [];

  for (const port of ports) {
    for (const def of port.list()) {
      if (nameToPort.has(def.name)) {
        throw new Error(
          `Duplicate tool name in composite ToolPort: "${def.name}"`,
        );
      }
      nameToPort.set(def.name, port);
      definitions.push(def);
    }
  }

  return {
    list() {
      return definitions.map((def) => ({ ...def }));
    },
    async execute(
      name: string,
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): Promise<string> {
      const port = nameToPort.get(name);
      if (!port) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return port.execute(name, args, ctx);
    },
  };
}
