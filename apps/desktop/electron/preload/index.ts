import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("agentDesktop", {
  getServerBaseUrl: (): Promise<string> => ipcRenderer.invoke("server:getBaseUrl"),
});
