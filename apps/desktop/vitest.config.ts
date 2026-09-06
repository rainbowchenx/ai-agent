import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["electron/**/*.test.ts"],
    exclude: ["electron/**/*.integration.test.ts"],
  },
});
