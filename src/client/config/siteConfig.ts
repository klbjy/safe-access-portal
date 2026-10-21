import {
  decodeBase64Url,
  decryptBytes,
  decryptJson,
  deriveWrappingKey,
  encodeBase64Url,
  encryptBytes,
  encryptJson,
  randomBytes,
  sha256,
} from "./crypto.ts";
import { normalizePeople, parseSiteConfig, rosterSchema, vaultPayloadSchema } from "./schema.ts";
import type { PersonRecord, PublishedUserEntry, SiteConfigV1, UnlockedSession } from "./types.ts";

export const DEFAULT_KDF_ITERATIONS = 120_000;

function normalizeName(name: string): string {
  return name.trim();
}

function normalizeStudentId(studentId: string): string {
  return studentId.trim();
}

function credentialMaterial(name: string, studentId: string): string {
  return `safe-access:kek:v1\0${normalizeName(name)}\0${normalizeStudentId(studentId)}`;
}

async function lookupFor(lookupSalt: string, name: string, studentId: string): Promise<string> {
  return sha256(`safe-access:lookup:v1\0${lookupSalt}\0${normalizeName(name)}\0${normalizeStudentId(studentId)}`);
}

function aad(version: string, purpose: string): string {
  return `safe-access:v1:${version}:${purpose}`;
}

function createVersion(): string {
  const compact = new Date().toISOString().replace(/[-:.]/gu, "");
  return `${compact}-${encodeBase64Url(randomBytes(4))}`;
}

export interface CreateSiteConfigOptions {
  version?: string;
  iterations?: number;
  onProgress?: (completed: number, total: number) => void;
}

export async function createSiteConfig(
  peopleInput: PersonRecord[],
  password: string,
  options: CreateSiteConfigOptions = {},
): Promise<SiteConfigV1> {
  const people = normalizePeople(peopleInput);
  const passwordValue = vaultPayloadSchema.parse({ password }).password;
  const version = options.version ?? createVersion();
  const iterations = options.iterations ?? DEFAULT_KDF_ITERATIONS;
  if (iterations < DEFAULT_KDF_ITERATIONS) throw new Error("密钥派生强度不足");

  const lookupSalt = encodeBase64Url(randomBytes(16));
  const vaultKey = randomBytes(32);
  const adminKey = randomBytes(32);
  const vault = await encryptJson(vaultKey, { password: passwordValue }, aad(version, "vault-payload"));
  const admin = await encryptJson(adminKey, { people }, aad(version, "admin-payload"));
  const users: PublishedUserEntry[] = [];

  for (const [index, person] of people.entries()) {
    const lookup = await lookupFor(lookupSalt, person.name, person.studentId);
    const salt = randomBytes(16);
    const wrappingKey = await deriveWrappingKey(credentialMaterial(person.name, person.studentId), salt, iterations);
    const entry: PublishedUserEntry = {
      lookup,
      role: person.role,
      salt: encodeBase64Url(salt),
      vaultKey: await encryptBytes(wrappingKey, vaultKey, aad(version, `wrap:vault:${lookup}`)),
    };
    if (person.role === "admin") {
      entry.adminKey = await encryptBytes(wrappingKey, adminKey, aad(version, `wrap:admin:${lookup}`));
    }
    users.push(entry);
    options.onProgress?.(index + 1, people.length);
  }

  return parseSiteConfig({
    schemaVersion: 1,
    version,
    lookupSalt,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations },
    users,
    vault,
    admin,
  });
}

async function verifyRoster(config: SiteConfigV1, people: PersonRecord[]): Promise<void> {
  const normalized = normalizePeople(people);
  if (normalized.length !== config.users.length) throw new Error("人员数量不一致");
  const entries = new Map(config.users.map((entry) => [entry.lookup, entry]));
  for (const person of normalized) {
    const lookup = await lookupFor(config.lookupSalt, person.name, person.studentId);
    if (entries.get(lookup)?.role !== person.role) throw new Error("人员配置不一致");
  }
}

export class ConfigUnlockError extends Error {
  constructor() {
    super("姓名或学号不正确，或尚未获得权限");
    this.name = "ConfigUnlockError";
  }
}

export async function unlockSiteConfig(configInput: SiteConfigV1, name: string, studentId: string): Promise<UnlockedSession> {
  try {
    const config = parseSiteConfig(configInput);
    const normalizedName = normalizeName(name);
    const normalizedStudentId = normalizeStudentId(studentId);
    const lookup = await lookupFor(config.lookupSalt, normalizedName, normalizedStudentId);
    const entry = config.users.find((candidate) => candidate.lookup === lookup);
    if (!entry) throw new Error("未找到人员");

    const salt = decodeBase64Url(entry.salt);
    if (salt.length !== 16) throw new Error("密钥派生盐无效");
    const wrappingKey = await deriveWrappingKey(
      credentialMaterial(normalizedName, normalizedStudentId),
      salt,
      config.kdf.iterations,
    );
    const vaultKey = await decryptBytes(wrappingKey, entry.vaultKey, aad(config.version, `wrap:vault:${lookup}`));
    const vault = vaultPayloadSchema.parse(await decryptJson(vaultKey, config.vault, aad(config.version, "vault-payload")));

    let people: PersonRecord[] | undefined;
    if (entry.role === "admin") {
      if (!entry.adminKey) throw new Error("管理密钥缺失");
      const adminKey = await decryptBytes(wrappingKey, entry.adminKey, aad(config.version, `wrap:admin:${lookup}`));
      const roster = rosterSchema.parse(await decryptJson(adminKey, config.admin, aad(config.version, "admin-payload")));
      people = roster.people;
      await verifyRoster(config, people);
    }

    return {
      user: { id: lookup, name: normalizedName, role: entry.role },
      password: vault.password,
      people,
      configVersion: config.version,
    };
  } catch {
    throw new ConfigUnlockError();
  }
}

export function serializeSiteConfig(config: SiteConfigV1): string {
  return `${JSON.stringify(parseSiteConfig(config), null, 2)}\n`;
}
