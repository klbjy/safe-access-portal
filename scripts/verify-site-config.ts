import * as XLSX from "@e965/xlsx";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parseSiteConfig } from "../src/client/config/schema.ts";
import { unlockSiteConfig } from "../src/client/config/siteConfig.ts";

const [informationArgument, configArgument = "public/site-config.json", artifactArgument = "dist"] = process.argv.slice(2);
if (!informationArgument) throw new Error("Usage: pnpm config:verify -- <information.xlsx> [config.json] [artifact-directory]");

const adminName = process.env.SEED_ADMIN_NAME?.trim();
const adminStudentId = process.env.SEED_ADMIN_STUDENT_ID?.trim();
const vaultPassword = process.env.SEED_VAULT_PASSWORD?.trim();
if (!adminName || !adminStudentId || !vaultPassword) throw new Error("Seed verification environment is incomplete");

function cell(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function protectedValues(filePath: string): Set<string> {
  const book = XLSX.read(readFileSync(path.resolve(filePath)), { type: "buffer", raw: false, cellText: true });
  const values = new Set<string>([adminName!, adminStudentId!, vaultPassword!]);
  for (const sheetName of book.SheetNames) {
    const sheet = book.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    const headerIndex = rows.findIndex((row) => row.map(cell).includes("姓名") && row.map(cell).includes("学号"));
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex]!.map(cell);
    const columns = [headers.indexOf("姓名"), headers.indexOf("学号"), headers.indexOf("联系电话")].filter((index) => index >= 0);
    for (const row of rows.slice(headerIndex + 1)) {
      for (const index of columns) {
        const value = cell(row[index]);
        if (value) values.add(value);
      }
    }
  }
  return values;
}

function filesUnder(target: string): string[] {
  const resolved = path.resolve(target);
  if (!statSync(resolved).isDirectory()) return [resolved];
  return readdirSync(resolved, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(resolved, entry.name);
    return entry.isDirectory() ? filesUnder(child) : entry.isFile() ? [child] : [];
  });
}

const config = parseSiteConfig(JSON.parse(readFileSync(path.resolve(configArgument), "utf8")));
const admin = await unlockSiteConfig(config, adminName, adminStudentId);
if (admin.user.role !== "admin" || admin.people?.length !== 29) throw new Error("Initial administrator or roster count is invalid");
if (admin.people.filter((person) => person.role === "admin").length !== 1) throw new Error("Initial administrator count is invalid");
const volunteer = admin.people.find((person) => person.role === "volunteer");
if (!volunteer) throw new Error("Initial volunteer roster is empty");
const volunteerSession = await unlockSiteConfig(config, volunteer.name, volunteer.studentId);
if (volunteerSession.user.role !== "volunteer" || volunteerSession.people) throw new Error("Volunteer isolation check failed");

const values = protectedValues(informationArgument);
const targets = [path.resolve(configArgument), ...filesUnder(artifactArgument)];
for (const target of targets) {
  const content = readFileSync(target);
  for (const value of values) {
    if (content.includes(Buffer.from(value))) throw new Error(`Protected plaintext found in ${path.relative(process.cwd(), target)}`);
  }
}

process.stdout.write(`${JSON.stringify({ configVersion: config.version, people: admin.people.length, volunteers: admin.people.length - 1, scannedProtectedValues: values.size, scannedFiles: targets.length, plaintextMatches: 0 })}\n`);
