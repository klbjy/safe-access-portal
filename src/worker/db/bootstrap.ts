import { encryptValue, keyedHash, normalizeName } from "../crypto";
import { AppError } from "../errors";
import type { Env } from "../env";

function validateBootstrap(env: Env): { name: string; studentId: string; password: string } {
  const name = env.BOOTSTRAP_ADMIN_NAME?.trim();
  const studentId = env.BOOTSTRAP_ADMIN_STUDENT_ID?.trim();
  const password = env.BOOTSTRAP_VAULT_PASSWORD?.trim();
  if (!name || name.length > 80 || !studentId || studentId.length > 40 || !/^\d{4,32}$/u.test(password ?? "")) {
    throw new AppError(500, "INTERNAL_ERROR", "服务配置无效");
  }
  return { name, studentId, password };
}

export async function ensureBootstrap(env: Env): Promise<void> {
  const { name, studentId, password } = validateBootstrap(env);
  const studentIdHash = await keyedHash(env.DATA_KEY, "student-id", studentId);
  const checks = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM people"),
    env.DB.prepare("SELECT id FROM vault WHERE id = 1 LIMIT 1"),
  ]);
  const peopleCount = checks[0]?.results?.[0] as { count?: number } | undefined;
  const hasPerson = Number(peopleCount?.count ?? 0) > 0;
  const hasVault = (checks[1]?.results?.length ?? 0) > 0;
  if (hasPerson && hasVault) return;

  const statements: D1PreparedStatement[] = [];
  const now = new Date().toISOString();
  if (!hasPerson) {
    const encryptedStudentId = await encryptValue(env.DATA_KEY, studentId);
    statements.push(
      env.DB
        .prepare(
          `INSERT OR IGNORE INTO people (
            id, student_id_hash, student_id_ciphertext, student_id_iv,
            name, name_key, role, auth_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'admin', 1, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          studentIdHash,
          encryptedStudentId.ciphertext,
          encryptedStudentId.iv,
          name,
          normalizeName(name),
          now,
          now,
        ),
    );
  }
  if (!hasVault) {
    const encryptedPassword = await encryptValue(env.DATA_KEY, password);
    statements.push(
      env.DB
        .prepare(
          "INSERT OR IGNORE INTO vault (id, password_ciphertext, password_iv, updated_at) VALUES (1, ?, ?, ?)",
        )
        .bind(encryptedPassword.ciphertext, encryptedPassword.iv, now),
    );
  }
  if (statements.length > 0) await env.DB.batch(statements);
}
