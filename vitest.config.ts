import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          APP_ENV: "local",
          DATA_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
          BOOTSTRAP_ADMIN_NAME: "测试管理员",
          BOOTSTRAP_ADMIN_STUDENT_ID: "TEST-0001",
          BOOTSTRAP_VAULT_PASSWORD: "86420975",
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./tests/worker/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/worker/**/*.ts", "src/shared/**/*.ts"],
    },
  },
});
