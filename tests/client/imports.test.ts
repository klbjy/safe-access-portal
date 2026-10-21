import { describe, expect, it } from "vitest";
import { applyImport, classifyImport, previewImport } from "../../src/client/imports";
import type { PersonRecord } from "../../src/client/config/types";

const people: PersonRecord[] = [
  { id: "10000000-0000-4000-8000-000000000001", name: "管理员", studentId: "A001", role: "admin" },
  { id: "10000000-0000-4000-8000-000000000002", name: "志愿者", studentId: "V001", role: "volunteer" },
];

describe("local roster imports", () => {
  it("adds new volunteers and skips an existing administrator", () => {
    const preview = classifyImport([
      { row: 2, name: "新人", studentId: "V002" },
      { row: 3, name: "管理员", studentId: "A001" },
    ], "volunteer", people);
    expect(preview.counts).toEqual({ add: 1, upgrade: 0, skip: 1, error: 0 });
    expect(applyImport(people, preview, "volunteer")).toHaveLength(3);
  });

  it("upgrades a matching volunteer through administrator import", () => {
    const preview = classifyImport([{ row: 2, name: "志愿者", studentId: "V001" }], "admin", people);
    expect(preview.rows[0]?.status).toBe("upgrade");
    expect(applyImport(people, preview, "admin").find((person) => person.studentId === "V001")?.role).toBe("admin");
  });

  it("marks every conflicting duplicate as an error", () => {
    const preview = classifyImport([
      { row: 2, name: "甲", studentId: "V009" },
      { row: 3, name: "乙", studentId: "V009" },
    ], "volunteer", people);
    expect(preview.counts.error).toBe(2);
  });

  it("keeps only the first identical duplicate", () => {
    const preview = classifyImport([
      { row: 2, name: "甲", studentId: "V009" },
      { row: 3, name: "甲", studentId: "V009" },
    ], "volunteer", people);
    expect(preview.rows.map((row) => row.status)).toEqual(["add", "skip"]);
  });

  it("parses CSV locally and discards the phone column", async () => {
    const file = new File(["姓名,学号,联系电话\n新人,V002,13800000000\n"], "people.csv", { type: "text/csv" });
    const preview = await previewImport(file, "volunteer", people);
    expect(preview.ignoredColumns).toEqual(["联系电话"]);
    expect(preview.rows[0]).toMatchObject({ name: "新人", studentId: "V002", status: "add" });
    expect(JSON.stringify(preview)).not.toContain("13800000000");
  });

  it("rejects unsupported files before parsing", async () => {
    const file = new File(["data"], "people.txt", { type: "text/plain" });
    await expect(previewImport(file, "volunteer", people)).rejects.toThrow("仅支持 .xlsx 或 .csv 文件");
  });
});
