import type * as Xlsx from "@e965/xlsx";
import type { PersonRecord, Role } from "./config/types";

export type ImportStatus = "add" | "upgrade" | "skip" | "error";

export interface ImportPreviewRow {
  row: number;
  name: string;
  studentId: string;
  status: ImportStatus;
  message: string;
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  ignoredColumns: string[];
  counts: Record<ImportStatus, number>;
}

interface ParsedRecord {
  row: number;
  name: string;
  studentId: string;
}

const MAX_FILE_BYTES = 256 * 1024;
const MAX_ROWS = 500;

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function findSheet(workbook: Xlsx.WorkBook, xlsx: typeof Xlsx): { records: ParsedRecord[]; ignoredColumns: string[] } {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
    const headerIndex = matrix.findIndex((row) => {
      const headers = row.map(text);
      return headers.includes("姓名") && headers.includes("学号");
    });
    if (headerIndex < 0) continue;

    const headers = matrix[headerIndex]!.map(text);
    const nameIndex = headers.indexOf("姓名");
    const studentIdIndex = headers.indexOf("学号");
    const ignoredColumns = [...new Set(headers.filter((header, index) => (
      header && index !== nameIndex && index !== studentIdIndex
    )))];
    const records: ParsedRecord[] = [];
    for (let index = headerIndex + 1; index < matrix.length; index += 1) {
      const row = matrix[index];
      if (!row || !row.some((cell) => text(cell))) continue;
      records.push({ row: index + 1, name: text(row[nameIndex]), studentId: text(row[studentIdIndex]) });
      if (records.length > MAX_ROWS) throw new Error(`一次最多导入 ${MAX_ROWS} 条非空记录`);
    }
    return { records, ignoredColumns };
  }
  throw new Error("未找到同时包含“姓名”和“学号”的表头");
}

export async function parseImportFile(file: File): Promise<{ records: ParsedRecord[]; ignoredColumns: string[] }> {
  const extension = file.name.toLocaleLowerCase().split(".").pop();
  if (extension !== "xlsx" && extension !== "csv") throw new Error("仅支持 .xlsx 或 .csv 文件");
  if (file.size === 0) throw new Error("文件为空");
  if (file.size > MAX_FILE_BYTES) throw new Error("文件不能超过 256 KiB");
  try {
    const xlsx = await import("@e965/xlsx");
    const workbook = extension === "csv"
      ? xlsx.read(await file.text(), { type: "string", raw: false, sheetRows: MAX_ROWS + 50 })
      : xlsx.read(await file.arrayBuffer(), { type: "array", raw: false, sheetRows: MAX_ROWS + 50 });
    return findSheet(workbook, xlsx);
  } catch (error) {
    if (error instanceof Error && /^(仅支持|文件|未找到|一次最多)/u.test(error.message)) throw error;
    throw new Error("文件无法读取，请检查格式后重试");
  }
}

function countRows(rows: ImportPreviewRow[]): Record<ImportStatus, number> {
  const counts = { add: 0, upgrade: 0, skip: 0, error: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

export function classifyImport(records: ParsedRecord[], targetRole: Role, people: PersonRecord[]): ImportPreview {
  const existing = new Map(people.map((person) => [person.studentId, person]));
  const groups = new Map<string, ParsedRecord[]>();
  for (const record of records) {
    if (!record.studentId) continue;
    const group = groups.get(record.studentId) ?? [];
    group.push(record);
    groups.set(record.studentId, group);
  }

  const rows = records.map<ImportPreviewRow>((record) => {
    if (!record.name || !record.studentId) {
      const message = !record.name && !record.studentId
        ? "姓名和学号不能为空"
        : !record.name ? "姓名不能为空" : "学号不能为空";
      return { ...record, status: "error", message };
    }
    if (record.name.length > 80 || record.studentId.length > 40) {
      return { ...record, status: "error", message: record.name.length > 80 ? "姓名不能超过 80 个字符" : "学号不能超过 40 个字符" };
    }

    const group = groups.get(record.studentId) ?? [];
    const names = new Set(group.map((item) => item.name));
    if (names.size > 1) return { ...record, status: "error", message: "文件内同一学号对应不同姓名" };
    if (group[0] !== record) return { ...record, status: "skip", message: "文件内重复，已保留首条" };

    const current = existing.get(record.studentId);
    if (!current) {
      return { ...record, status: "add", message: targetRole === "admin" ? "将新增为管理者" : "将新增为志愿者" };
    }
    if (current.name !== record.name) return { ...record, status: "error", message: "该学号已对应其他姓名" };
    if (targetRole === "admin" && current.role === "volunteer") {
      return { ...record, status: "upgrade", message: "将由志愿者升级为管理者" };
    }
    return {
      ...record,
      status: "skip",
      message: current.role === targetRole ? "名单中已存在相同角色" : "已有管理者权限，不会降级",
    };
  });
  return { rows, ignoredColumns: [], counts: countRows(rows) };
}

export async function previewImport(file: File, role: Role, people: PersonRecord[]): Promise<ImportPreview> {
  const parsed = await parseImportFile(file);
  return { ...classifyImport(parsed.records, role, people), ignoredColumns: parsed.ignoredColumns };
}

export function applyImport(people: PersonRecord[], preview: ImportPreview, role: Role): PersonRecord[] {
  const next = people.map((person) => ({ ...person }));
  for (const row of preview.rows) {
    if (row.status === "add") {
      next.push({ id: crypto.randomUUID(), name: row.name, studentId: row.studentId, role });
    } else if (row.status === "upgrade") {
      const current = next.find((person) => person.studentId === row.studentId);
      if (current) current.role = "admin";
    }
  }
  return next;
}

export async function createTemplate(): Promise<Uint8Array> {
  const xlsx = await import("@e965/xlsx");
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet([["姓名", "学号"]]);
  sheet["!cols"] = [{ wch: 16 }, { wch: 20 }];
  xlsx.utils.book_append_sheet(workbook, sheet, "导入模板");
  return xlsx.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
}
