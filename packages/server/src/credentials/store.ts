import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { CredentialInfo } from "@agent2026/shared";

type CredentialMap = Record<string, string>;

function readMap(path: string): CredentialMap {
  if (!existsSync(path)) {
    return {};
  }
  const parsed = parseYaml(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const out: CredentialMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string" && value.length > 0) {
      out[key] = value;
    }
  }
  return out;
}

function writeMap(path: string, map: CredentialMap): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyYaml(map), { encoding: "utf8", mode: 0o600 });
}

export type CredentialStore = {
  path: string;
  describe: (ref: string, env?: NodeJS.ProcessEnv) => CredentialInfo;
  resolve: (ref: string, env?: NodeJS.ProcessEnv) => string | undefined;
  set: (ref: string, value: string) => void;
  listRefs: (refs: string[], env?: NodeJS.ProcessEnv) => CredentialInfo[];
};

export function createCredentialStore(path: string): CredentialStore {
  let cache = readMap(path);

  const reload = () => {
    cache = readMap(path);
  };

  return {
    path,
    describe(ref, env = process.env): CredentialInfo {
      const envValue = env[ref];
      if (typeof envValue === "string" && envValue.length > 0) {
        return {
          ref,
          configured: true,
          source: "env",
          writable: false,
        };
      }
      reload();
      const fileValue = cache[ref];
      if (typeof fileValue === "string" && fileValue.length > 0) {
        return {
          ref,
          configured: true,
          source: "credentials",
          writable: true,
        };
      }
      return { ref, configured: false, writable: true };
    },
    resolve(ref, env = process.env): string | undefined {
      const envValue = env[ref];
      if (typeof envValue === "string" && envValue.length > 0) {
        return envValue;
      }
      reload();
      const fileValue = cache[ref];
      return typeof fileValue === "string" && fileValue.length > 0
        ? fileValue
        : undefined;
    },
    set(ref, value) {
      reload();
      if (value.length === 0) {
        delete cache[ref];
      } else {
        cache[ref] = value;
      }
      writeMap(path, cache);
    },
    listRefs(refs, env = process.env) {
      return refs.map((ref) => this.describe(ref, env));
    },
  };
}
