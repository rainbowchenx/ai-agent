import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelPort } from "@agent2026/core";
import { defaultAppConfig } from "@agent2026/shared";
import { assembleRuntime } from "./runtime.js";

describe("assembleRuntime", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("resolves apiKeyEnv from env and wires openai-compatible model plus builtins", async () => {
    dir = await mkdtemp(join(tmpdir(), "agent2026-runtime-"));
    const runtime = assembleRuntime({
      config: defaultAppConfig(),
      workspaceRoot: dir,
      env: { OPENAI_API_KEY: "sk-test-not-used-in-ci" },
    });

    expect(runtime.model.id).toBe("openai/gpt-4.1");
    expect(runtime.systemPrompt).toBe("You are a helpful assistant.");
    expect(runtime.tools.list().map((tool) => tool.name)).toEqual([
      "http_fetch",
      "read_file",
    ]);
    expect(runtime.permissions).toEqual({ mode: "default", allowlist: [] });
  });

  it("uses an injected ModelPort without reading api keys", async () => {
    dir = await mkdtemp(join(tmpdir(), "agent2026-runtime-"));
    const model: ModelPort = {
      id: "injected",
      async *stream() {
        yield { type: "text_delta", text: "ok" };
      },
    };

    const runtime = assembleRuntime({
      config: defaultAppConfig(),
      workspaceRoot: dir,
      model,
      env: {},
    });

    expect(runtime.model).toBe(model);
  });

  it("throws when the provider api key env is missing", async () => {
    dir = await mkdtemp(join(tmpdir(), "agent2026-runtime-"));
    expect(() =>
      assembleRuntime({
        config: defaultAppConfig(),
        workspaceRoot: dir,
        env: {},
      }),
    ).toThrow(/OPENAI_API_KEY/);
  });
});
