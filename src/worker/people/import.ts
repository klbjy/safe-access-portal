import * as XLSX from "@e965/xlsx";
import type { ImportCounts, ImportPreviewResponse, ImportPreviewRow, Role } from "../../shared/api";
import type { ImportRecord } from "../../shared/schemas";
import { encryptValue, keyedHash, normalizeName } from "../crypto";
import { AppError } from "../errors";
import type { Env } from "../env";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_ROWS = 500;

interface ParsedRecord extends ImportRecord {
  row: number;
}

interface ExistingPerson {
  id: string;
  student_id_hash: string;
  name: string;
  name_key: string;
  role: Role;
}

export interface ClassifiedImport {
  rows: ImportPreviewRow[];
  counts: ImportCounts;
  additions: Array<ParsedRecord & { studentIdHash: string }>;
  upgrades: ExistingPerson[];
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function countRows(rows: ImportPreviewRow[]): ImportCounts {
  const counts: ImportCounts = { add: 0, upgrade: 0, skip: 0, error: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

function findSheet(workbook: XLSX.WorkBook): { records: ParsedRecord[]; ignoredColumns: string[] } {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
    const headerIndex = matrix.findIndex((row) => {
      const headers = row.map(text);
      return headers.includes("姓名") && headers.includes("学号");
    });
    if (headerIndex < 0) continue;

    const headerRow = matrix[headerIndex];
    if (!headerRow) continue;
    const headers = headerRow.map(text);
    const nameIndex = headers.indexOf("姓名");
    const studentIdIndex = headers.indexOf("学号");
    const ignoredColumns = [...new Set(headers.filter((header, index) => header && index !== nameIndex && index !== studentIdIndex))];
    const records: ParsedRecord[] = [];
    for (let index = headerIndex + 1; index < matrix.length; index += 1) {
      const source = matrix[index];
      if (!source) continue;
      const name = text(source[nameIndex]);
      const studentId = text(source[studentIdIndex]);
      if (!source.some((cell) => text(cell) !== "")) continue;
      records.push({ row: index + 1, name, studentId });
      if (records.length > MAX_ROWS) {
        throw new AppError(400, "IMPORT_INVALID", `一次最多导入 ${MAX_ROWS} 条非空记录`);
      }
    }
    return { records, ignoredColumns };
  }
  throw new AppError(400, "IMPORT_INVALID", "未找到同时包含“姓名”和“学号”的表头");
}

export async function parseImportFile(file: File): Promise<{ records: ParsedRecord[]; ignoredColumns: string[] }> {
  const extension = file.name.toLocaleLowerCase().split(".").pop();
  if (extension !== "xlsx" && extension !== "csv") {
    throw new AppError(400, "IMPORT_INVALID", "仅支持 .xlsx 或 .csv 文件");
  }
  if (file.size === 0) throw new AppError(400, "IMPORT_INVALID", "文件为空");
  if (file.size > MAX_FILE_BYTES) throw new AppError(413, "IMPORT_INVALID", "文件不能超过 256 KiB");

  try {
    const workbook = extension === "csv"
      ? XLSX.read(await file.text(), { type: "string", raw: false, cellText: true, cellDates: false, sheetRows: MAX_ROWS + 50 })
      : XLSX.read(await file.arrayBuffer(), { type: "array", raw: false, cellText: true, cellDates: false, sheetRows: MAX_ROWS + 50 });
    return findSheet(workbook);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "IMPORT_INVALID", "文件无法读取，请检查格式后重试");
  }
}

async function existingPeople(hashes: string[], env: Env): Promise<Map<string, ExistingPerson>> {
  if (hashes.length === 0) return new Map();
  const result = await env.DB.prepare(
    `SELECT id, student_id_hash, name, name_key, role
     FROM people
     WHERE student_id_hash IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify([...new Set(hashes)]))
    .all<ExistingPerson>();
  return new Map((result.results ?? []).map((person) => [person.student_id_hash, person]));
}

export async function classifyImport(records: ParsedRecord[], targetRole: Role, env: Env): Promise<ClassifiedImport> {
  const hashes = await Promise.all(
    records.map((record) => (record.studentId ? keyedHash(env.DATA_KEY, "student-id", record.studentId) : Promise.resolve(""))),
  );
  const existing = await existingPeople(hashes.filter(Boolean), env);
  const seen = new Set<string>();
  const rows: ImportPreviewRow[] = [];
  const additions: ClassifiedImport["additions"] = [];
  const upgrades: ExistingPerson[] = [];

  records.forEach((record, index) => {
    const hash = hashes[index] ?? "";
    let status: ImportPreviewRow["status"];
    let message: string;

    if (!record.name || !record.studentId) {
      status = "error";
      message = !record.name && !record.studentId ? "姓名和学号不能为空" : !record.name ? "姓名不能为空" : "学号不能为空";
    } else if (record.name.length > 80 || record.studentId.length > 40) {
      status = "error";
      message = record.name.length > 80 ? "姓名不能超过 80 个字符" : "学号不能超过 40 个字符";
    } else if (seen.has(hash)) {
      status = "error";
      message = "文件内学号重复";
    } else {
      seen.add(hash);
      const current = existing.get(hash);
      if (!current) {
        status = "add";
        message = targetRole === "admin" ? "将新增为管理者" : "将新增为志愿者";
        additions.push({ ...record, studentIdHash: hash });
      } else if (current.name_key !== normalizeName(record.name)) {
        status = "error";
        message = "该学号已对应其他姓名";
      } else if (targetRole === "admin" && current.role === "volunteer") {
        status = "upgrade";
        message = "将由志愿者升级为管理者";
        upgrades.push(current);
      } else {
        status = "skip";
        message = current.role === targetRole ? "名单中已存在相同角色" : "已有管理者权限，不会降级";
      }
    }
    rows.push({ row: record.row, name: record.name, studentId: record.studentId, status, message });
  });

  return { rows, counts: countRows(rows), additions, upgrades };
}

export async function previewImport(file: File, role: Role, env: Env): Promise<ImportPreviewResponse> {
  const parsed = await parseImportFile(file);
  const classified = await classifyImport(parsed.records, role, env);
  return { rows: classified.rows, ignoredColumns: parsed.ignoredColumns, counts: classified.counts };
}

export async function commitImport(records: ImportRecord[], role: Role, env: Env): Promise<ClassifiedImport & { changed: number }> {
  const parsed = records.map((record, index) => ({ ...record, row: index + 2 }));
  const classified = await classifyImport(parsed, role, env);
  if (classified.additions.length === 0 && classified.upgrades.length === 0) {
    throw new AppError(409, "IMPORT_NO_CHANGES", "没有可写入的人员变更");
  }

  const now = new Date().toISOString();
  const additions = await Promise.all(
    classified.additions.map(async (record) => {
      const encrypted = await encryptValue(env.DATA_KEY, record.studentId);
      return {
        id: crypto.randomUUID(),
        studentIdHash: record.studentIdHash,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        name: record.name.trim(),
        nameKey: normalizeName(record.name),
        role,
        now,
      };
    }),
  );
  const upgradeIds = classified.upgrades.map((person) => person.id);
  const statements: D1PreparedStatement[] = [];

  if (additions.length > 0) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO people (
          id, student_id_hash, student_id_ciphertext, student_id_iv,
          name, name_key, role, auth_version, created_at, updated_at
        )
        SELECT
          json_extract(value, '$.id'), json_extract(value, '$.studentIdHash'),
          json_extract(value, '$.ciphertext'), json_extract(value, '$.iv'),
          json_extract(value, '$.name'), json_extract(value, '$.nameKey'),
          json_extract(value, '$.role'), 1,
          json_extract(value, '$.now'), json_extract(value, '$.now')
        FROM json_each(?)`,
      ).bind(JSON.stringify(additions)),
    );
  }
  if (upgradeIds.length > 0) {
    statements.push(
      env.DB
        .prepare(
          `UPDATE people
           SET role = 'admin', auth_version = auth_version + 1, updated_at = ?
           WHERE role = 'volunteer' AND id IN (SELECT value FROM json_each(?))`,
        )
        .bind(now, JSON.stringify(upgradeIds)),
      env.DB.prepare("DELETE FROM sessions WHERE person_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(upgradeIds)),
    );
  }

  try {
    await env.DB.batch(statements);
  } catch {
    throw new AppError(409, "CONFLICT", "名单已发生变化，请重新预览后再导入");
  }
  return { ...classified, changed: classified.additions.length + classified.upgrades.length };
}

export function createTemplate(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["姓名", "学号"]]);
  sheet["!cols"] = [{ wch: 16 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(workbook, sheet, "导入模板");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}
