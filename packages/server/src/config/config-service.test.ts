import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppConfig, parseAppConfigYaml } from "@agent2026/shared";
import { createConfigService } from "./config-service.js";

describe("createConfigService", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("set persists to yaml and get returns the new value", () => {
    const dir = mkdtempSync(join(tmpdir(), "config-svc-"));
    dirs.push(dir);
    const path = join(dir, "config.yaml");
    const service = createConfigService(path);

    const next = defaultAppConfig();
    next.agents.default.systemPrompt = "Updated prompt";
    next.agents.default.maxTurns = 12;

    const returned = service.set(next);

    expect(returned.agents.default.systemPrompt).toBe("Updated prompt");
    expect(service.get().agents.default.maxTurns).toBe(12);
    expect(parseAppConfigYaml(readFileSync(path, "utf8")).agents.default.systemPrompt).toBe(
      "Updated prompt",
    );
  });

  it("invalid set throws and get still returns previous", () => {
    const dir = mkdtempSync(join(tmpdir(), "config-svc-"));
    dirs.push(dir);
    const path = join(dir, "config.yaml");
    const service = createConfigService(path);
    const before = service.get();

    expect(() =>
      service.set({
        ...before,
        providers: {
          ...before.providers,
          default: "missing-provider",
        },
      }),
    ).toThrow();

    expect(service.get()).toEqual(before);
    expect(parseAppConfigYaml(readFileSync(path, "utf8"))).toEqual(before);
  });

  it("onChange fires once on successful set", () => {
    const dir = mkdtempSync(join(tmpdir(), "config-svc-"));
    dirs.push(dir);
    const path = join(dir, "config.yaml");
    const service = createConfigService(path);
    const listener = vi.fn();
    const unsubscribe = service.onChange(listener);

    const next = defaultAppConfig();
    next.agents.default.systemPrompt = "Notify me";
    service.set(next);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: expect.objectContaining({
          default: expect.objectContaining({ systemPrompt: "Notify me" }),
        }),
      }),
    );

    unsubscribe();
    next.agents.default.systemPrompt = "After unsubscribe";
    service.set(next);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
