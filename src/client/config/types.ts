export const roles = ["volunteer", "admin"] as const;
export type Role = (typeof roles)[number];

export interface PersonRecord {
  id: string;
  name: string;
  studentId: string;
  role: Role;
}

export interface UserSummary {
  id: string;
  name: string;
  role: Role;
}

export interface EncryptedValue {
  iv: string;
  ciphertext: string;
}

export interface PublishedUserEntry {
  lookup: string;
  role: Role;
  salt: string;
  vaultKey: EncryptedValue;
  adminKey?: EncryptedValue;
}

export interface SiteConfigV1 {
  schemaVersion: 1;
  version: string;
  lookupSalt: string;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
  };
  users: PublishedUserEntry[];
  vault: EncryptedValue;
  admin: EncryptedValue;
}

export interface UnlockedSession {
  user: UserSummary;
  password: string;
  people?: PersonRecord[];
  configVersion: string;
}
