import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  defaultAppConfig,
  parseAppConfigYaml,
  type AppConfig,
} from "@agent2026/shared";

export function defaultConfigPath(): string {
  return join(homedir(), ".agent2026", "config.yaml");
}

export function defaultCredentialsPath(): string {
  return join(homedir(), ".agent2026", "credentials.yaml");
}

export function writeAppConfig(configPath: string, config: AppConfig): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, stringifyYaml(config), "utf8");
}

export function loadOrCreateAppConfig(
  configPath: string = defaultConfigPath(),
): AppConfig {
  if (!existsSync(configPath)) {
    const created = defaultAppConfig();
    writeAppConfig(configPath, created);
    return created;
  }
  return parseAppConfigYaml(readFileSync(configPath, "utf8"));
}
