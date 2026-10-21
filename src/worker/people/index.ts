import type { PersonSummary, Role } from "../../shared/api";
import { batchDeleteSchema, importCommitSchema, roleChangeSchema, roleSchema } from "../../shared/schemas";
import { requireUser } from "../auth";
import { decryptValue, normalizeName } from "../crypto";
import { AppError } from "../errors";
import type { Env } from "../env";
import { boundedRequest, fileResponse, json, parseJson } from "../http";
import { commitImport, createTemplate, previewImport } from "./import";

interface PersonRow {
  id: string;
  name: string;
  name_key: string;
  role: Role;
  student_id_ciphertext: string;
  student_id_iv: string;
}

async function personSummary(row: PersonRow, env: Env): Promise<PersonSummary> {
  return {
    id: row.id,
    name: row.name,
    studentId: await decryptValue(env.DATA_KEY, row.student_id_ciphertext, row.student_id_iv),
    role: row.role,
  };
}

async function findPerson(id: string, env: Env): Promise<PersonRow | null> {
  return env.DB.prepare(
    `SELECT id, name, name_key, role, student_id_ciphertext, student_id_iv
     FROM people WHERE id = ?`,
  )
    .bind(id)
    .first<PersonRow>();
}

export async function listPeople(request: Request, env: Env): Promise<Response> {
  await requireUser(request, env, "admin");
  const url = new URL(request.url);
  const roleValue = url.searchParams.get("role");
  const role = roleValue && roleValue !== "all" ? roleSchema.safeParse(roleValue) : null;
  if (role && !role.success) throw new AppError(400, "VALIDATION_ERROR", "角色筛选条件无效");

  const result = await env.DB.prepare(
    `SELECT id, name, name_key, role, student_id_ciphertext, student_id_iv
     FROM people
     WHERE (? IS NULL OR role = ?)
     ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, name_key, created_at`,
  )
    .bind(role?.data ?? null, role?.data ?? null)
    .all<PersonRow>();
  const people = await Promise.all((result.results ?? []).map((row) => personSummary(row, env)));
  const query = url.searchParams.get("q")?.trim() ?? "";
  const queryName = normalizeName(query);
  const filtered = query
    ? people.filter((person) => normalizeName(person.name).includes(queryName) || person.studentId.includes(query))
    : people;
  return json({ people: filtered });
}

export async function importPreview(request: Request, env: Env): Promise<Response> {
  await requireUser(request, env, "admin");
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new AppError(415, "IMPORT_INVALID", "请选择 .xlsx 或 .csv 文件");
  }
  let form: FormData;
  try {
    const bounded = await boundedRequest(request, 300 * 1024, 413, "IMPORT_INVALID", "文件不能超过 256 KiB");
    form = await bounded.formData();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "IMPORT_INVALID", "上传内容无法读取");
  }
  const file = form.get("file");
  const roleResult = roleSchema.safeParse(form.get("role"));
  if (!(file instanceof File)) throw new AppError(400, "IMPORT_INVALID", "请选择要导入的文件");
  if (!roleResult.success) throw new AppError(400, "VALIDATION_ERROR", "请选择导入角色");
  return json(await previewImport(file, roleResult.data, env));
}

export async function importCommit(request: Request, env: Env): Promise<Response> {
  await requireUser(request, env, "admin");
  const input = await parseJson(request, importCommitSchema);
  const result = await commitImport(input.records, input.role, env);
  return json({ outcomes: result.rows, counts: result.counts, changed: result.changed });
}

export async function changeRole(request: Request, env: Env, id: string): Promise<Response> {
  await requireUser(request, env, "admin");
  const input = await parseJson(request, roleChangeSchema);
  const current = await findPerson(id, env);
  if (!current) throw new AppError(404, "NOT_FOUND", "未找到该人员");
  if (current.role === input.role) return json(await personSummary(current, env));

  const now = new Date().toISOString();
  const update = env.DB.prepare(
    `UPDATE people
     SET role = ?, auth_version = auth_version + 1, updated_at = ?
     WHERE id = ?
       AND (role <> 'admin' OR ? = 'admin' OR (SELECT COUNT(*) FROM people WHERE role = 'admin') > 1)`,
  ).bind(input.role, now, id, input.role);
  const results = await env.DB.batch([
    update,
    env.DB
      .prepare(
        `DELETE FROM sessions
         WHERE person_id = ?
           AND auth_version <> (SELECT auth_version FROM people WHERE id = ?)`,
      )
      .bind(id, id),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw new AppError(409, "LAST_ADMIN", "必须至少保留一名管理者");
  }
  const updated = await findPerson(id, env);
  if (!updated) throw new AppError(404, "NOT_FOUND", "未找到该人员");
  return json(await personSummary(updated, env));
}

export async function deletePerson(request: Request, env: Env, id: string): Promise<Response> {
  await requireUser(request, env, "admin");
  const result = await env.DB.prepare(
    `DELETE FROM people
     WHERE id = ?
       AND (role <> 'admin' OR (SELECT COUNT(*) FROM people WHERE role = 'admin') > 1)`,
  )
    .bind(id)
    .run();
  if ((result.meta.changes ?? 0) > 0) return json({ deleted: 1 });

  const exists = await env.DB.prepare("SELECT role FROM people WHERE id = ?").bind(id).first<{ role: Role }>();
  if (!exists) throw new AppError(404, "NOT_FOUND", "未找到该人员");
  throw new AppError(409, "LAST_ADMIN", "必须至少保留一名管理者");
}

export async function batchDeletePeople(request: Request, env: Env): Promise<Response> {
  await requireUser(request, env, "admin");
  const input = await parseJson(request, batchDeleteSchema);
  const ids = [...new Set(input.ids)];
  const encoded = JSON.stringify(ids);
  const result = await env.DB.prepare(
    `DELETE FROM people
     WHERE id IN (SELECT value FROM json_each(?))
       AND (SELECT COUNT(*) FROM people WHERE id IN (SELECT value FROM json_each(?))) = ?
       AND (
         (SELECT COUNT(*) FROM people WHERE role = 'admin') -
         (SELECT COUNT(*) FROM people WHERE role = 'admin' AND id IN (SELECT value FROM json_each(?)))
       ) >= 1`,
  )
    .bind(encoded, encoded, ids.length, encoded)
    .run();
  const deleted = result.meta.changes ?? 0;
  if (deleted === ids.length) return json({ deleted });

  const existing = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM people WHERE id IN (SELECT value FROM json_each(?))",
  )
    .bind(encoded)
    .first<{ count: number }>();
  if ((existing?.count ?? 0) !== ids.length) throw new AppError(404, "NOT_FOUND", "所选人员已发生变化，请刷新后重试");
  throw new AppError(409, "LAST_ADMIN", "所选操作会移除最后一名管理者");
}

export async function downloadTemplate(request: Request, env: Env): Promise<Response> {
  await requireUser(request, env, "admin");
  return fileResponse(
    createTemplate() as BodyInit,
    "safe-access-import-template.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}
