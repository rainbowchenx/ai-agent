import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;

export type ServerState = {
  host: string;
  port: number;
  baseUrl: string;
  pid?: number;
  reused: boolean;
};

export type SpawnPlan =
  | { kind: "reuse"; host: string; port: number }
  | {
      kind: "spawn";
      command: string;
      args: string[];
      cwd: string;
      host: string;
      port: number;
    };

export type FetchImpl = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<Response>;

export type ServerManagerOptions = {
  userDataDir: string;
  repoRoot: string;
  isDev: boolean;
  host?: string;
  port?: number;
  fetchImpl?: FetchImpl;
  spawnImpl?: typeof spawn;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
};

export function healthUrl(host: string, port: number): string {
  return `http://${host}:${port}/health`;
}

export function serverStatePath(userDataDir: string): string {
  return join(userDataDir, "server.json");
}

export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(`Cannot find repo root (pnpm-workspace.yaml) from ${startDir}`);
}

export function resolveServerDistEntry(repoRoot: string): string | undefined {
  const candidate = join(repoRoot, "packages", "server", "dist", "index.js");
  return existsSync(candidate) ? candidate : undefined;
}

export function writeServerState(userDataDir: string, state: ServerState): void {
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(serverStatePath(userDataDir), `${JSON.stringify(state, null, 2)}\n`);
}

export function resolveSpawnPlan(opts: {
  isDev: boolean;
  repoRoot: string;
  existingHealthy: boolean;
  host?: string;
  port?: number;
  serverDistEntry?: string;
}): SpawnPlan {
  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port ?? DEFAULT_PORT;
  if (opts.isDev && opts.existingHealthy) {
    return { kind: "reuse", host, port };
  }

  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const tsxPlan: Extract<SpawnPlan, { kind: "spawn" }> = {
    kind: "spawn",
    command: pnpmCommand,
    args: ["--filter", "@agent2026/server", "exec", "tsx", "src/index.ts"],
    cwd: opts.repoRoot,
    host,
    port,
  };

  if (opts.isDev || !opts.serverDistEntry) {
    return tsxPlan;
  }

  return {
    kind: "spawn",
    command: process.execPath,
    args: [opts.serverDistEntry],
    cwd: dirname(opts.serverDistEntry),
    host,
    port,
  };
}

export async function probeHealth(
  url: string,
  fetchImpl: FetchImpl,
  timeoutMs = 800,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      return false;
    }
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function killProcessTree(
  pid: number,
  spawnImpl: typeof spawn = spawn,
): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const child = spawnImpl("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
    resolve();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ServerManager {
  private child: ChildProcess | null = null;
  private state: ServerState | null = null;

  constructor(private readonly opts: ServerManagerOptions) {}

  getBaseUrl(): string {
    if (!this.state) {
      throw new Error("Server has not been started");
    }
    return this.state.baseUrl;
  }

  async start(): Promise<ServerState> {
    const host = this.opts.host ?? DEFAULT_HOST;
    const port = this.opts.port ?? DEFAULT_PORT;
    const url = healthUrl(host, port);
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const existingHealthy = await probeHealth(url, fetchImpl);
    const plan = resolveSpawnPlan({
      isDev: this.opts.isDev,
      repoRoot: this.opts.repoRoot,
      existingHealthy,
      host,
      port,
      serverDistEntry: resolveServerDistEntry(this.opts.repoRoot),
    });

    if (plan.kind === "reuse") {
      this.state = {
        host,
        port,
        baseUrl: `http://${host}:${port}`,
        reused: true,
      };
      writeServerState(this.opts.userDataDir, this.state);
      return this.state;
    }

    const spawnImpl = this.opts.spawnImpl ?? spawn;
    const spawnOpts: SpawnOptions = {
      cwd: plan.cwd,
      env: { ...process.env, HOST: host, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // .cmd shims (pnpm.cmd) require a shell on Windows.
      shell: process.platform === "win32",
    };
    this.child = spawnImpl(plan.command, plan.args, spawnOpts);
    this.child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(`[server] ${chunk.toString()}`);
    });
    this.child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[server] ${chunk.toString()}`);
    });

    const timeoutMs = this.opts.waitTimeoutMs ?? 20_000;
    const pollMs = this.opts.pollIntervalMs ?? 200;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await probeHealth(url, fetchImpl)) {
        this.state = {
          host,
          port,
          baseUrl: `http://${host}:${port}`,
          pid: this.child.pid,
          reused: false,
        };
        writeServerState(this.opts.userDataDir, this.state);
        return this.state;
      }
      await sleep(pollMs);
    }

    await this.stop();
    throw new Error(`Agent server did not become healthy at ${url}`);
  }

  async stop(): Promise<void> {
    const pid = this.child?.pid;
    this.child = null;
    if (pid == null) {
      return;
    }
    const spawnImpl = this.opts.spawnImpl ?? spawn;
    await killProcessTree(pid, spawnImpl);
  }
}
