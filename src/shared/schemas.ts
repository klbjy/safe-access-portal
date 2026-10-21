import { z } from "zod";

export const roleSchema = z.enum(["volunteer", "admin"]);

export const nameSchema = z
  .string()
  .trim()
  .min(1, "请输入姓名")
  .max(80, "姓名不能超过 80 个字符");

export const studentIdSchema = z
  .string()
  .trim()
  .min(1, "请输入学号")
  .max(40, "学号不能超过 40 个字符");

export const loginRequestSchema = z.object({
  name: nameSchema,
  studentId: studentIdSchema,
});

export const vaultUpdateSchema = z
  .object({
    password: z.string().regex(/^\d{4,32}$/, "请输入 4–32 位数字"),
    confirmation: z.string(),
  })
  .refine((value) => value.password === value.confirmation, {
    message: "两次输入的密码不一致",
    path: ["confirmation"],
  });

export const importRecordSchema = z.object({
  name: nameSchema,
  studentId: studentIdSchema,
});

export const importCommitSchema = z.object({
  role: roleSchema,
  records: z.array(importRecordSchema).min(1, "没有可导入的记录").max(500, "一次最多导入 500 条记录"),
});

export const roleChangeSchema = z.object({ role: roleSchema });

export const batchDeleteSchema = z.object({
  ids: z.array(z.string().uuid("人员标识无效")).min(1, "请至少选择一人").max(500, "一次最多删除 500 人"),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ImportRecord = z.infer<typeof importRecordSchema>;
