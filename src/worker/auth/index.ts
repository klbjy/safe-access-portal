import { loginRequestSchema } from "../../shared/schemas";
import type { Role, UserSummary } from "../../shared/api";
import { keyedHash, normalizeName, randomToken } from "../crypto";
import { AppError } from "../errors";
import type { Env } from "../env";
import { empty, json, parseJson } from "../http";

const SESSION_COOKIE = "safe_session";
const SESSION_SECONDS = 12 * 60 * 60;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

interface PersonRow {
  id: string;
  name: string;
  name_key: string;
  role: Role;
  auth_version: number;
}

interface SessionRow extends PersonRow {
  session_auth_version: number;
  expires_at: string;
}

export interface CurrentUser extends UserSummary {
  authVersion: number;
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function sessionCookie(token: string, env: Env): string {
  const secure = env.APP_ENV === "local" ? "" : "; Secure";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
}

function expiredCookie(env: Env): string {
  const secure = env.APP_ENV === "local" ? "" : "; Secure";
  return `${SESSION_COOKIE}=; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=0`;
}

async function bucketHash(request: Request, env: Env): Promise<string> {
  const network = request.headers.get("CF-Connecting-IP") ?? "local-development";
  return keyedHash(env.DATA_KEY, "login-network", network);
}

async function assertRateAvailable(hash: string, env: Env): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    "DELETE FROM login_limits WHERE bucket_hash IN (SELECT bucket_hash FROM login_limits WHERE expires_at <= ? LIMIT 20)",
  )
    .bind(now)
    .run();
  const row = await env.DB.prepare("SELECT failure_count, expires_at FROM login_limits WHERE bucket_hash = ?")
    .bind(hash)
    .first<{ failure_count: number; expires_at: number }>();
  if (row && row.expires_at > now && row.failure_count >= MAX_FAILURES) {
    throw new AppError(429, "RATE_LIMITED", "尝试次数过多，请稍后再试");
  }
}

async function recordFailure(hash: string, env: Env): Promise<void> {
  const now = Date.now();
  const expiresAt = now + RATE_WINDOW_MS;
  await env.DB.prepare(
    `INSERT INTO login_limits (bucket_hash, window_started_at, failure_count, expires_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(bucket_hash) DO UPDATE SET
       window_started_at = CASE WHEN login_limits.expires_at <= excluded.window_started_at THEN excluded.window_started_at ELSE login_limits.window_started_at END,
       failure_count = CASE WHEN login_limits.expires_at <= excluded.window_started_at THEN 1 ELSE login_limits.failure_count + 1 END,
       expires_at = CASE WHEN login_limits.expires_at <= excluded.window_started_at THEN excluded.expires_at ELSE login_limits.expires_at END`,
  )
    .bind(hash, now, expiresAt)
    .run();
}

async function issueSession(request: Request, person: PersonRow, env: Env): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const tokenHash = await keyedHash(env.DATA_KEY, "session-token", token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString();
  const statements: D1PreparedStatement[] = [];
  const previousToken = readCookie(request, SESSION_COOKIE);
  if (previousToken) {
    const previousHash = await keyedHash(env.DATA_KEY, "session-token", previousToken);
    statements.push(env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(previousHash));
  }
  statements.push(
    env.DB.prepare(
      "DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at <= ? LIMIT 20)",
    ).bind(now.toISOString()),
    env.DB
      .prepare(
        "INSERT INTO sessions (token_hash, person_id, auth_version, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(tokenHash, person.id, person.auth_version, now.toISOString(), expiresAt),
  );
  await env.DB.batch(statements);
  return { token, expiresAt };
}

export async function requireUser(request: Request, env: Env, role?: Role): Promise<CurrentUser> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) throw new AppError(401, "SESSION_REQUIRED", "请先登录");
  const tokenHash = await keyedHash(env.DATA_KEY, "session-token", token);
  const row = await env.DB.prepare(
    `SELECT p.id, p.name, p.name_key, p.role, p.auth_version,
            s.auth_version AS session_auth_version, s.expires_at
     FROM sessions s
     JOIN people p ON p.id = s.person_id
     WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<SessionRow>();

  const invalid = !row || row.expires_at <= new Date().toISOString() || row.session_auth_version !== row.auth_version;
  if (invalid) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    throw new AppError(401, "SESSION_EXPIRED", "登录状态已失效，请重新登录");
  }
  if (role && row.role !== role) throw new AppError(403, "FORBIDDEN", "没有执行此操作的权限");
  return { id: row.id, name: row.name, role: row.role, authVersion: row.auth_version };
}

export async function login(request: Request, env: Env): Promise<Response> {
  const input = await parseJson(request, loginRequestSchema);
  const networkHash = await bucketHash(request, env);
  await assertRateAvailable(networkHash, env);
  const studentIdHash = await keyedHash(env.DATA_KEY, "student-id", input.studentId);
  const person = await env.DB.prepare(
    "SELECT id, name, name_key, role, auth_version FROM people WHERE student_id_hash = ? LIMIT 1",
  )
    .bind(studentIdHash)
    .first<PersonRow>();

  if (!person || person.name_key !== normalizeName(input.name)) {
    await recordFailure(networkHash, env);
    throw new AppError(401, "INVALID_CREDENTIALS", "姓名或学号不正确，或尚未获得权限");
  }

  const { token } = await issueSession(request, person, env);
  await env.DB.prepare("DELETE FROM login_limits WHERE bucket_hash = ?").bind(networkHash).run();
  return json(
    { user: { id: person.id, name: person.name, role: person.role } },
    { headers: { "Set-Cookie": sessionCookie(token, env) } },
  );
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    const hash = await keyedHash(env.DATA_KEY, "session-token", token);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run();
  }
  return empty({ status: 204, headers: { "Set-Cookie": expiredCookie(env) } });
}

export async function getSession(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  return json({ user: { id: user.id, name: user.name, role: user.role } });
}

export function sessionExpiredResponse(error: AppError, env: Env): HeadersInit | undefined {
  if (error.code !== "SESSION_EXPIRED" && error.code !== "SESSION_REQUIRED") return undefined;
  return { "Set-Cookie": expiredCookie(env) };
}
