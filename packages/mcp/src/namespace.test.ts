import { describe, expect, it } from "vitest";
import { prefixToolName, stripToolPrefix } from "./namespace.js";

describe("MCP tool namespace", () => {
  it("prefixes and strips server names", () => {
    expect(prefixToolName("filesystem", "read_file")).toBe(
      "filesystem__read_file",
    );
    expect(stripToolPrefix("filesystem", "filesystem__read_file")).toBe(
      "read_file",
    );
  });

  it("keeps original names that already contain __", () => {
    expect(prefixToolName("svc", "a__b")).toBe("svc__a__b");
    expect(stripToolPrefix("svc", "svc__a__b")).toBe("a__b");
  });

  it("returns null when prefix does not match", () => {
    expect(stripToolPrefix("filesystem", "other__read_file")).toBeNull();
    expect(stripToolPrefix("filesystem", "filesystem")).toBeNull();
    expect(stripToolPrefix("filesystem", "filesystem__")).toBeNull();
  });
});
