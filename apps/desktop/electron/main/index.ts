import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { ServerManager, findRepoRoot } from "./server-manager.js";

let manager: ServerManager | null = null;
let stopping = false;

function resolvePreloadPath(): string {
  const mjs = join(__dirname, "../preload/index.mjs");
  const js = join(__dirname, "../preload/index.js");
  return existsSync(mjs) ? mjs : js;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    title: "agent2026",
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

async function stopServer(): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  if (manager) {
    await manager.stop();
    manager = null;
  }
}

function resolveRepoRoot(): string {
  const starts = [app.getAppPath(), process.cwd()];
  for (const start of starts) {
    try {
      return findRepoRoot(start);
    } catch {
      // try the next candidate
    }
  }
  throw new Error("Cannot locate monorepo root for spawning the agent server");
}

app.whenReady().then(async () => {
  const repoRoot = resolveRepoRoot();
  manager = new ServerManager({
    userDataDir: app.getPath("userData"),
    repoRoot,
    isDev: !app.isPackaged,
  });
  await manager.start();

  ipcMain.handle("server:getBaseUrl", () => {
    if (!manager) {
      throw new Error("Server manager is not running");
    }
    return manager.getBaseUrl();
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((err: unknown) => {
  console.error("[desktop] failed to start", err);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (stopping) {
    return;
  }
  event.preventDefault();
  void stopServer().finally(() => {
    app.quit();
  });
});
