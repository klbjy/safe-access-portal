import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM login_limits"),
    env.DB.prepare("DELETE FROM vault"),
    env.DB.prepare("DELETE FROM people"),
  ]);
});
