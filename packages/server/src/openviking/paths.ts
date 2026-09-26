import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = join("packages", "openviking-runtime", "pyproject.toml");

function walkUpForMarker(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, MARKER))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** Walk up from cwd (or injected dir); fall back to this module's path. */
export function findRepoRoot(startDir?: string): string {
  if (startDir !== undefined) {
    const found = walkUpForMarker(startDir);
    if (found) return found;
    throw new Error(
      `Could not find repo root containing ${MARKER} (started at ${startDir})`,
    );
  }

  const fromCwd = walkUpForMarker(process.cwd());
  if (fromCwd) return fromCwd;

  const fromModule = walkUpForMarker(dirname(fileURLToPath(import.meta.url)));
  if (fromModule) return fromModule;

  throw new Error(
    `Could not find repo root containing ${MARKER} (cwd=${process.cwd()})`,
  );
}

export function defaultOpenVikingPaths(repoRoot = findRepoRoot()) {
  const rootDir = join(homedir(), ".agent2026", "openviking");
  return {
    rootDir,
    confPath: join(rootDir, "ov.conf"),
    dataDir: join(rootDir, "data"),
    runtimeProjectDir: join(repoRoot, "packages", "openviking-runtime"),
  };
}
