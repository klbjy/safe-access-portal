import { z } from "zod";
import type { PersonRecord, SiteConfigV1 } from "./types.ts";

const encodedSchema = z.string().min(1).regex(/^[A-Za-z0-9_-]+$/u);
const encryptedValueSchema = z.object({
  iv: encodedSchema,
  ciphertext: encodedSchema,
});

const userEntrySchema = z
  .object({
    lookup: encodedSchema,
    role: z.enum(["volunteer", "admin"]),
    salt: encodedSchema,
    vaultKey: encryptedValueSchema,
    adminKey: encryptedValueSchema.optional(),
  })
  .superRefine((entry, context) => {
    if (entry.role === "admin" && !entry.adminKey) {
      context.addIssue({ code: "custom", message: "管理者缺少管理密钥" });
    }
    if (entry.role === "volunteer" && entry.adminKey) {
      context.addIssue({ code: "custom", message: "志愿者不能包含管理密钥" });
    }
  });

const siteConfigSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().min(1).max(80),
  lookupSalt: encodedSchema,
  kdf: z.object({
    name: z.literal("PBKDF2"),
    hash: z.literal("SHA-256"),
    iterations: z.number().int().min(120_000).max(1_000_000),
  }),
  users: z.array(userEntrySchema).min(1).max(500),
  vault: encryptedValueSchema,
  admin: encryptedValueSchema,
});

export const personSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  studentId: z.string().trim().min(1).max(40),
  role: z.enum(["volunteer", "admin"]),
});

export const rosterSchema = z.object({
  people: z.array(personSchema).min(1).max(500),
});

export const vaultPayloadSchema = z.object({
  password: z.string().regex(/^\d{4,32}$/u),
});

export function parseSiteConfig(value: unknown): SiteConfigV1 {
  const config = siteConfigSchema.parse(value) as SiteConfigV1;
  const lookups = new Set(config.users.map((entry) => entry.lookup));
  if (lookups.size !== config.users.length) throw new Error("配置包含重复人员条目");
  if (!config.users.some((entry) => entry.role === "admin")) throw new Error("配置必须保留至少一名管理者");
  return config;
}

export function normalizePeople(people: PersonRecord[]): PersonRecord[] {
  const normalized = people.map((person) => personSchema.parse({
    ...person,
    name: person.name.trim(),
    studentId: person.studentId.trim(),
  }));
  const ids = new Set<string>();
  const studentIds = new Set<string>();
  for (const person of normalized) {
    if (ids.has(person.id)) throw new Error("人员标识重复");
    if (studentIds.has(person.studentId)) throw new Error(`学号重复：${person.studentId}`);
    ids.add(person.id);
    studentIds.add(person.studentId);
  }
  if (!normalized.some((person) => person.role === "admin")) throw new Error("必须至少保留一名管理者");
  return normalized;
}
