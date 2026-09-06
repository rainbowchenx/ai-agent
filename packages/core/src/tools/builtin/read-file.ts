import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../../types/messages.js";
import type { ToolHandler } from "../registry.js";

export const READ_FILE_DEFINITION: ToolDefinition = {
  name: "read_file",
  description: "Read a UTF-8 text file relative to the workspace root.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path to the file within the workspace.",
      },
    },
    required: ["path"],
  },
};

/**
 * Resolve `relativePath` under `workspaceRoot` and reject escapes.
 * Symlink targets outside the root are blocked by the prefix check after resolve.
 */
export function resolveWorkspacePath(
  workspaceRoot: string,
  relativePath: string,
): string {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new Error("read_file: path must be a non-empty string");
  }

  if (path.isAbsolute(relativePath)) {
    throw new Error(
      "read_file: path traversal rejected — use a path relative to the workspace",
    );
  }

  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes(`${path.sep}..`)) {
    throw new Error(
      "read_file: path traversal rejected — path must stay inside workspace",
    );
  }

  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, normalized);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(
      "read_file: path traversal rejected — resolved path is outside workspace",
    );
  }

  return resolved;
}

/** @param workspaceRoot Files may only be read beneath this directory. */
export function createReadFileHandler(workspaceRoot: string): ToolHandler {
  return async (args) => {
    const filePath = resolveWorkspacePath(workspaceRoot, String(args.path ?? ""));
    const content = await readFile(filePath, "utf8");
    return content;
  };
}
