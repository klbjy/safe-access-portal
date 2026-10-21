import * as XLSX from "@e965/xlsx";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../../src/worker";

const origin = "https://safe.example";

function api(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init.method && init.method !== "GET") headers.set("Origin", origin);
  return new Request(`${origin}${path}`, { ...init, headers });
}

function cookie(response: Response): string {
  const value = response.headers.get("Set-Cookie");
  if (!value) throw new Error("missing session cookie");
  return value.split(";", 1)[0] ?? "";
}

async function login(name = "测试管理员", studentId = "TEST-0001"): Promise<string> {
  const response = await worker.fetch(
    api("/api/auth/login", { method: "POST", body: JSON.stringify({ name, studentId }) }),
    env,
  );
  expect(response.status).toBe(200);
  return cookie(response);
}

describe("worker API", () => {
  it("reports health without exposing configuration", async () => {
    const response = await worker.fetch(api("/api/health"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("bootstraps, rejects generic bad credentials, and issues a secure-shaped session", async () => {
    const failed = await worker.fetch(
      api("/api/auth/login", { method: "POST", body: JSON.stringify({ name: "未知", studentId: "none" }) }),
      env,
    );
    expect(failed.status).toBe(401);
    expect(await failed.json()).toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });

    const response = await worker.fetch(
      api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ name: " 测试管理员 ", studentId: " TEST-0001 " }),
      }), env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).toContain("SameSite=Strict");

    const stored = await env.DB.prepare(
      "SELECT student_id_hash, student_id_ciphertext FROM people WHERE name = ?",
    )
      .bind("测试管理员")
      .first<{ student_id_hash: string; student_id_ciphertext: string }>();
    expect(stored?.student_id_hash).not.toContain("TEST-0001");
    expect(stored?.student_id_ciphertext).not.toContain("TEST-0001");
  });

  it("reads and replaces the vault without keeping plaintext or history", async () => {
    const session = await login();
    const before = await worker.fetch(api("/api/vault", { headers: { Cookie: session } }), env);
    expect(await before.json()).toMatchObject({ password: "86420975" });

    const updated = await worker.fetch(
      api("/api/admin/vault", {
        method: "PUT",
        headers: { Cookie: session },
        body: JSON.stringify({ password: "975310", confirmation: "975310" }),
      }), env,
    );
    expect(await updated.json()).toMatchObject({ status: "updated" });
    const row = await env.DB.prepare("SELECT password_ciphertext FROM vault WHERE id = 1").first<{
      password_ciphertext: string;
    }>();
    expect(row?.password_ciphertext).not.toContain("975310");
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    expect(tables.results.map(({ name }) => name)).not.toContain("vault_history");
  });

  it("previews and commits CSV records while ignoring phone data", async () => {
    const session = await login();
    const form = new FormData();
    form.set("role", "volunteer");
    form.set("file", new File(["姓名,学号,联系电话\n志愿者甲,0007,13800000000"], "people.csv", { type: "text/csv" }));
    const preview = await worker.fetch(
      api("/api/admin/import/preview", { method: "POST", headers: { Cookie: session }, body: form }),
      env,
    );
    expect(preview.status, await preview.clone().text()).toBe(200);
    expect(await preview.json()).toMatchObject({
      ignoredColumns: ["联系电话"],
      counts: { add: 1, upgrade: 0, skip: 0, error: 0 },
    });

    const committed = await worker.fetch(
      api("/api/admin/import/commit", {
        method: "POST",
        headers: { Cookie: session },
        body: JSON.stringify({ role: "volunteer", records: [{ name: "志愿者甲", studentId: "0007" }] }),
      }), env,
    );
    expect(await committed.json()).toMatchObject({ changed: 1, counts: { add: 1 } });
    const people = await worker.fetch(api("/api/admin/people?q=0007", { headers: { Cookie: session } }), env);
    expect(await people.json()).toMatchObject({
      people: [{ name: "志愿者甲", studentId: "0007", role: "volunteer" }],
    });
    const schema = await env.DB.prepare("PRAGMA table_info(people)").all<{ name: string }>();
    expect(schema.results.map(({ name }) => name)).not.toContain("phone");
  });

  it("prevents deleting or demoting the final administrator", async () => {
    const session = await login();
    const people = await worker.fetch(api("/api/admin/people", { headers: { Cookie: session } }), env);
    const body = (await people.json()) as { people: Array<{ id: string }> };
    const id = body.people[0]?.id;
    if (!id) throw new Error("missing bootstrap administrator");

    const demote = await worker.fetch(
      api(`/api/admin/people/${id}/role`, {
        method: "PATCH",
        headers: { Cookie: session },
        body: JSON.stringify({ role: "volunteer" }),
      }), env,
    );
    expect(demote.status).toBe(409);
    expect(await demote.json()).toMatchObject({ error: { code: "LAST_ADMIN" } });

    const remove = await worker.fetch(
      api(`/api/admin/people/${id}`, { method: "DELETE", headers: { Cookie: session } }),
      env,
    );
    expect(remove.status).toBe(409);
    expect(await remove.json()).toMatchObject({ error: { code: "LAST_ADMIN" } });
  });

  it("rejects cross-origin mutations and rate-limits repeated failures without identity details", async () => {
    const crossOrigin = await worker.fetch(
      new Request(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://other.example" },
        body: JSON.stringify({ name: "未知", studentId: "none" }),
      }),
      env,
    );
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toMatchObject({ error: { code: "FORBIDDEN" } });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await worker.fetch(
        api("/api/auth/login", { method: "POST", body: JSON.stringify({ name: "未知", studentId: `none-${attempt}` }) }),
        env,
      );
      expect(failed.status).toBe(401);
      expect(await failed.json()).toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });
    }
    const limited = await worker.fetch(
      api("/api/auth/login", { method: "POST", body: JSON.stringify({ name: "测试管理员", studentId: "TEST-0001" }) }),
      env,
    );
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("parses the first matching XLSX sheet and preserves text student IDs", async () => {
    const session = await login();
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["说明"], ["无人员数据"]]), "说明");
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["姓名", "学号", "联系电话"], ["志愿者乙", "0008", "应忽略"]]),
      "人员",
    );
    const binary = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const form = new FormData();
    form.set("role", "volunteer");
    form.set("file", new File([binary], "people.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const response = await worker.fetch(
      api("/api/admin/import/preview", { method: "POST", headers: { Cookie: session }, body: form }),
      env,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      ignoredColumns: ["联系电话"],
      rows: [{ name: "志愿者乙", studentId: "0008", status: "add" }],
    });
  });

  it("enforces role authorization and invalidates a session after role change", async () => {
    const adminSession = await login();
    await worker.fetch(
      api("/api/admin/import/commit", {
        method: "POST",
        headers: { Cookie: adminSession },
        body: JSON.stringify({ role: "volunteer", records: [{ name: "志愿者丙", studentId: "V-0003" }] }),
      }),
      env,
    );
    const volunteerSession = await login("志愿者丙", "V-0003");
    const vault = await worker.fetch(api("/api/vault", { headers: { Cookie: volunteerSession } }), env);
    expect(vault.status).toBe(200);
    const forbidden = await worker.fetch(
      api("/api/admin/vault", {
        method: "PUT",
        headers: { Cookie: volunteerSession },
        body: JSON.stringify({ password: "123456", confirmation: "123456" }),
      }),
      env,
    );
    expect(forbidden.status).toBe(403);

    const listed = await worker.fetch(api("/api/admin/people?q=V-0003", { headers: { Cookie: adminSession } }), env);
    const target = ((await listed.json()) as { people: Array<{ id: string }> }).people[0];
    if (!target) throw new Error("missing imported volunteer");
    const promoted = await worker.fetch(
      api(`/api/admin/people/${target.id}/role`, {
        method: "PATCH",
        headers: { Cookie: adminSession },
        body: JSON.stringify({ role: "admin" }),
      }),
      env,
    );
    expect(promoted.status).toBe(200);
    const stale = await worker.fetch(api("/api/vault", { headers: { Cookie: volunteerSession } }), env);
    expect(stale.status).toBe(401);
    expect(await stale.json()).toMatchObject({ error: { code: "SESSION_EXPIRED" } });
  });

  it("keeps batch deletion atomic when any submitted person is missing", async () => {
    const session = await login();
    await worker.fetch(
      api("/api/admin/import/commit", {
        method: "POST",
        headers: { Cookie: session },
        body: JSON.stringify({
          role: "volunteer",
          records: [
            { name: "志愿者丁", studentId: "V-0004" },
            { name: "志愿者戊", studentId: "V-0005" },
          ],
        }),
      }),
      env,
    );
    const listed = await worker.fetch(api("/api/admin/people?role=volunteer", { headers: { Cookie: session } }), env);
    const volunteers = ((await listed.json()) as { people: Array<{ id: string }> }).people;
    const ids = volunteers.map(({ id }) => id);
    expect(ids).toHaveLength(2);

    const staleDelete = await worker.fetch(
      api("/api/admin/people/batch-delete", {
        method: "POST",
        headers: { Cookie: session },
        body: JSON.stringify({ ids: [...ids, crypto.randomUUID()] }),
      }),
      env,
    );
    expect(staleDelete.status).toBe(404);
    const remaining = await env.DB.prepare("SELECT COUNT(*) AS count FROM people WHERE role = 'volunteer'").first<{ count: number }>();
    expect(remaining?.count).toBe(2);

    const deleted = await worker.fetch(
      api("/api/admin/people/batch-delete", {
        method: "POST",
        headers: { Cookie: session },
        body: JSON.stringify({ ids }),
      }),
      env,
    );
    expect(await deleted.json()).toEqual({ deleted: 2 });
  });

  it("rejects oversized streamed JSON and upload bodies before application work", async () => {
    const oversizedJson = await worker.fetch(
      api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ name: "x".repeat(70 * 1024), studentId: "large" }),
      }),
      env,
    );
    expect(oversizedJson.status).toBe(413);
    expect(await oversizedJson.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const session = await login();
    const form = new FormData();
    form.set("role", "volunteer");
    form.set("file", new File([new Uint8Array(257 * 1024)], "too-large.csv", { type: "text/csv" }));
    const oversizedFile = await worker.fetch(
      api("/api/admin/import/preview", { method: "POST", headers: { Cookie: session }, body: form }),
      env,
    );
    expect(oversizedFile.status).toBe(413);
    expect(await oversizedFile.json()).toMatchObject({ error: { code: "IMPORT_INVALID" } });
  });

  it("rejects malformed person paths without invoking an administrative handler", async () => {
    const session = await login();
    const malformed = await worker.fetch(
      api("/api/admin/people/%E0%A4%A/role", {
        method: "PATCH",
        headers: { Cookie: session },
        body: JSON.stringify({ role: "admin" }),
      }),
      env,
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("does not recreate the bootstrap administrator after an authorized deletion", async () => {
    const firstAdminSession = await login();
    await worker.fetch(
      api("/api/admin/import/commit", {
        method: "POST",
        headers: { Cookie: firstAdminSession },
        body: JSON.stringify({ role: "admin", records: [{ name: "接任管理员", studentId: "ADMIN-0002" }] }),
      }),
      env,
    );
    const successorSession = await login("接任管理员", "ADMIN-0002");
    const listed = await worker.fetch(api("/api/admin/people", { headers: { Cookie: successorSession } }), env);
    const people = ((await listed.json()) as { people: Array<{ id: string; studentId: string }> }).people;
    const bootstrap = people.find(({ studentId }) => studentId === "TEST-0001");
    if (!bootstrap) throw new Error("missing bootstrap administrator");

    const deleted = await worker.fetch(
      api(`/api/admin/people/${bootstrap.id}`, { method: "DELETE", headers: { Cookie: successorSession } }),
      env,
    );
    expect(deleted.status).toBe(200);

    const afterBootstrapCheck = await worker.fetch(
      api("/api/admin/people", { headers: { Cookie: successorSession } }),
      env,
    );
    const remaining = ((await afterBootstrapCheck.json()) as { people: Array<{ studentId: string }> }).people;
    expect(remaining.map(({ studentId }) => studentId)).toEqual(["ADMIN-0002"]);

    const rejected = await worker.fetch(
      api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ name: "测试管理员", studentId: "TEST-0001" }),
      }),
      env,
    );
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });
  });
});
