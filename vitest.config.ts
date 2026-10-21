import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/client/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/client/config/**/*.ts"],
    },
  },
});
