import * as XLSX from "@e965/xlsx";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSiteConfig, serializeSiteConfig } from "../src/client/config/siteConfig.ts";
import type { PersonRecord } from "../src/client/config/types.ts";

const [scheduleArgument, informationArgument, outputArgument = "public/site-config.json"] = process.argv.slice(2);
if (!scheduleArgument || !informationArgument) {
  throw new Error("Usage: pnpm config:generate -- <schedule.xlsx> <information.xlsx> [output.json]");
}

const adminName = process.env.SEED_ADMIN_NAME?.trim();
const adminStudentId = process.env.SEED_ADMIN_STUDENT_ID?.trim();
const vaultPassword = process.env.SEED_VAULT_PASSWORD?.trim();
if (!adminName || !adminStudentId || !vaultPassword) {
  throw new Error("SEED_ADMIN_NAME, SEED_ADMIN_STUDENT_ID and SEED_VAULT_PASSWORD are required");
}

function workbook(filePath: string): XLSX.WorkBook {
  return XLSX.read(readFileSync(path.resolve(filePath)), { type: "buffer", raw: false, cellText: true });
}

function cell(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function timeKey(value: unknown): string {
  return cell(value).replace(/[：﹕]/gu, ":").replace(/\s+/gu, "");
}

function scheduleNames(filePath: string): string[] {
  const book = workbook(filePath);
  const sheet = book.Sheets[book.SheetNames[0] ?? ""];
  if (!sheet) throw new Error("排班表没有可读取工作表");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
  const first = rows.findIndex((row) => timeKey(row[0]) === "8:00-10:00");
  const last = rows.findIndex((row) => timeKey(row[0]) === "20:00-22:00");
  if (first < 0 || last < 0 || !rows[first + 1] || !rows[last + 1]) throw new Error("无法定位每日首班或末班两行人员");

  const names: string[] = [];
  for (const index of [first, first + 1, last, last + 1]) {
    for (let day = 1; day <= 7; day += 1) {
      const name = cell(rows[index]?.[day]);
      if (name) names.push(name);
    }
  }
  const unique = [...new Set(names)];
  if (unique.length !== 28) throw new Error(`首末班应有 28 名不同志愿者，实际为 ${unique.length} 名`);
  return unique;
}

function informationMap(filePath: string): Map<string, string> {
  const book = workbook(filePath);
  for (const sheetName of book.SheetNames) {
    const sheet = book.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    const headerIndex = rows.findIndex((row) => row.map(cell).includes("姓名") && row.map(cell).includes("学号"));
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex]!.map(cell);
    const nameIndex = headers.indexOf("姓名");
    const studentIdIndex = headers.indexOf("学号");
    const result = new Map<string, string>();
    for (const row of rows.slice(headerIndex + 1)) {
      const name = cell(row[nameIndex]);
      const studentId = cell(row[studentIdIndex]);
      if (!name || !studentId) continue;
      const existing = result.get(name);
      if (existing && existing !== studentId) throw new Error("人员信息表存在同名不同学号，无法唯一匹配");
      result.set(name, studentId);
    }
    return result;
  }
  throw new Error("信息表中未找到姓名和学号表头");
}

const names = scheduleNames(scheduleArgument);
const identifiers = informationMap(informationArgument);
const people: PersonRecord[] = [
  { id: crypto.randomUUID(), name: adminName, studentId: adminStudentId, role: "admin" },
  ...names.map((name) => {
    const studentId = identifiers.get(name);
    if (!studentId) throw new Error("首末班人员存在未匹配学号");
    return { id: crypto.randomUUID(), name, studentId, role: "volunteer" as const };
  }),
];

const config = await createSiteConfig(people, vaultPassword);
const serialized = serializeSiteConfig(config);
for (const person of people) {
  if (serialized.includes(person.name) || serialized.includes(person.studentId)) throw new Error("生成配置包含人员明文");
}
if (serialized.includes(vaultPassword)) throw new Error("生成配置包含密码明文");

const outputPath = path.resolve(outputArgument);
writeFileSync(outputPath, serialized, "utf8");
process.stdout.write(`${JSON.stringify({ schemaVersion: config.schemaVersion, version: config.version, administrators: 1, volunteers: names.length, total: people.length, output: path.relative(process.cwd(), outputPath) })}\n`);
