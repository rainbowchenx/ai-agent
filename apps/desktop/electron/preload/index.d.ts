export type AgentDesktopApi = {
  getServerBaseUrl: () => Promise<string>;
};

declare global {
  interface Window {
    agentDesktop: AgentDesktopApi;
  }
}

export {};
