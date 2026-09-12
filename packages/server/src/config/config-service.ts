import type { AppConfig } from "@agent2026/shared";
import { parseAppConfig } from "@agent2026/shared";
import { loadOrCreateAppConfig, writeAppConfig } from "./load-config.js";

export type ConfigService = {
  path: string;
  get(): AppConfig;
  set(next: AppConfig): AppConfig;
  onChange(listener: (config: AppConfig) => void): () => void;
};

export function createConfigService(path: string): ConfigService {
  let config = loadOrCreateAppConfig(path);
  const listeners = new Set<(config: AppConfig) => void>();

  return {
    path,
    get() {
      return config;
    },
    set(next) {
      const parsed = parseAppConfig(next);
      writeAppConfig(path, parsed);
      config = parsed;
      for (const listener of listeners) {
        listener(parsed);
      }
      return parsed;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
