import type { ToolPort } from "../../ports/tool-port.js";
import { ToolRegistry } from "../registry.js";
import {
  createHttpFetchHandler,
  type HttpFetchHandlerOptions,
} from "./http-fetch.js";
import { createReadFileHandler, READ_FILE_DEFINITION } from "./read-file.js";
import { HTTP_FETCH_DEFINITION } from "./http-fetch.js";

export type BuiltinToolName = "http_fetch" | "read_file";

export interface BuiltinToolPortOptions extends HttpFetchHandlerOptions {
  /** All read_file paths are resolved and confined under this directory. */
  workspaceRoot: string;
}

/**
 * Build a {@link ToolPort} with selected builtin tools.
 * Unlisted names are omitted so config can whitelist capabilities per agent.
 */
export function createBuiltinToolPort(
  names: BuiltinToolName[],
  options: BuiltinToolPortOptions,
): ToolPort {
  const registry = new ToolRegistry();

  for (const name of names) {
    if (name === "read_file") {
      registry.register(
        READ_FILE_DEFINITION,
        createReadFileHandler(options.workspaceRoot),
      );
    } else if (name === "http_fetch") {
      registry.register(
        HTTP_FETCH_DEFINITION,
        createHttpFetchHandler(options),
      );
    }
  }

  return registry;
}

export {
  assertHttpUrl,
  createHttpFetchHandler,
  HTTP_FETCH_DEFINITION,
  type HttpFetchHandlerOptions,
} from "./http-fetch.js";
export {
  createReadFileHandler,
  READ_FILE_DEFINITION,
  resolveWorkspacePath,
} from "./read-file.js";
