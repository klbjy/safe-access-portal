import { vaultUpdateSchema } from "../../shared/schemas";
import { decryptValue, encryptValue } from "../crypto";
import { AppError } from "../errors";
import type { Env } from "../env";
import { json, parseJson } from "../http";
import { requireUser } from "../auth";

interface VaultRow {
  password_ciphertext: string;
  password_iv: string;
  updated_at: string;
}

async function readVault(env: Env): Promise<VaultRow> {
  const row = await env.DB.prepare(
    "SELECT password_ciphertext, password_iv, updated_at FROM vault WHERE id = 1",
  ).first<VaultRow>();
  if (!row) throw new AppError(500, "INTERNAL_ERROR", "暂时无法获取密码");
  return row;
}

export async function getVault(request: Request, env: Env): Promise<Response> {
  await requireUser(request, env);
  const row = await readVault(env);
  const password = await decryptValue(env.DATA_KEY, row.password_ciphertext, row.password_iv);
  return json({ password, updatedAt: row.updated_at });
}

export async function updateVault(request: Request, env: Env): Promise<Response> {
  await requireUser(request, env, "admin");
  const input = await parseJson(request, vaultUpdateSchema);
  const current = await readVault(env);
  const currentPassword = await decryptValue(env.DATA_KEY, current.password_ciphertext, current.password_iv);
  if (currentPassword === input.password) {
    return json({ status: "unchanged", updatedAt: current.updated_at });
  }

  const encrypted = await encryptValue(env.DATA_KEY, input.password);
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE vault SET password_ciphertext = ?, password_iv = ?, updated_at = ? WHERE id = 1",
  )
    .bind(encrypted.ciphertext, encrypted.iv, updatedAt)
    .run();
  return json({ status: "updated", updatedAt });
}
