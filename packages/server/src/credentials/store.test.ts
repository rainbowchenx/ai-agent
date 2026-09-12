import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCredentialStore } from "./store.js";

describe("createCredentialStore", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves env over credentials and marks env as read-only", () => {
    const dir = mkdtempSync(join(tmpdir(), "cred-"));
    dirs.push(dir);
    const path = join(dir, "credentials.yaml");
    const store = createCredentialStore(path);
    store.set("OPENAI_API_KEY", "from-file");

    const env = { OPENAI_API_KEY: "from-env" };
    expect(store.resolve("OPENAI_API_KEY", env)).toBe("from-env");
    expect(store.describe("OPENAI_API_KEY", env)).toEqual({
      ref: "OPENAI_API_KEY",
      configured: true,
      source: "env",
      writable: false,
    });
  });

  it("persists credentials when env is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "cred-"));
    dirs.push(dir);
    const path = join(dir, "credentials.yaml");
    const store = createCredentialStore(path);
    store.set("DEEPSEEK_API_KEY", "sk-test");

    expect(store.resolve("DEEPSEEK_API_KEY", {})).toBe("sk-test");
    expect(store.describe("DEEPSEEK_API_KEY", {})).toMatchObject({
      configured: true,
      source: "credentials",
      writable: true,
    });
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("sk-test");
  });

  it("treats empty string as absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "cred-"));
    dirs.push(dir);
    const path = join(dir, "credentials.yaml");
    const store = createCredentialStore(path);
    store.set("OPENAI_API_KEY", "x");
    store.set("OPENAI_API_KEY", "");
    expect(store.resolve("OPENAI_API_KEY", {})).toBeUndefined();
    expect(store.describe("OPENAI_API_KEY", {}).configured).toBe(false);
  });
});
