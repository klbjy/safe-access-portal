import { getSession, login, logout, sessionExpiredResponse } from "./auth";
import { ensureBootstrap } from "./db/bootstrap";
import type { Env } from "./env";
import { AppError, isAppError } from "./errors";
import { assertSameOrigin, errorResponse, json } from "./http";
import {
  batchDeletePeople,
  changeRole,
  deletePerson,
  downloadTemplate,
  importCommit,
  importPreview,
  listPeople,
} from "./people";
import { getVault, updateVault } from "./vault";

type Handler = (request: Request, env: Env) => Promise<Response>;

async function health(env: Env): Promise<Response> {
  try {
    await env.DB.prepare("SELECT 1 AS ready").first();
    return json({ status: "ok" });
  } catch {
    return json({ status: "unavailable" }, { status: 503 });
  }
}

function route(request: Request): { handler: Handler; needsBootstrap: boolean } | null {
  const { pathname } = new URL(request.url);
  const key = `${request.method} ${pathname}`;
  const fixed = new Map<string, { handler: Handler; needsBootstrap: boolean }>([
    ["GET /api/health", { handler: (_request, env) => health(env), needsBootstrap: false }],
    ["POST /api/auth/login", { handler: login, needsBootstrap: true }],
    ["POST /api/auth/logout", { handler: logout, needsBootstrap: true }],
    ["GET /api/session", { handler: getSession, needsBootstrap: true }],
    ["GET /api/vault", { handler: getVault, needsBootstrap: true }],
    ["PUT /api/admin/vault", { handler: updateVault, needsBootstrap: true }],
    ["GET /api/admin/people", { handler: listPeople, needsBootstrap: true }],
    ["POST /api/admin/import/preview", { handler: importPreview, needsBootstrap: true }],
    ["POST /api/admin/import/commit", { handler: importCommit, needsBootstrap: true }],
    ["POST /api/admin/people/batch-delete", { handler: batchDeletePeople, needsBootstrap: true }],
    ["GET /api/admin/import-template.xlsx", { handler: downloadTemplate, needsBootstrap: true }],
  ]);
  const direct = fixed.get(key);
  if (direct) return direct;

  const personIdPattern = "([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})";
  const roleMatch = pathname.match(new RegExp(`^/api/admin/people/${personIdPattern}/role$`, "u"));
  if (request.method === "PATCH" && roleMatch) {
    const id = roleMatch[1] ?? "";
    return { handler: (innerRequest, env) => changeRole(innerRequest, env, id), needsBootstrap: true };
  }
  const deleteMatch = pathname.match(new RegExp(`^/api/admin/people/${personIdPattern}$`, "u"));
  if (request.method === "DELETE" && deleteMatch) {
    const id = deleteMatch[1] ?? "";
    return { handler: (innerRequest, env) => deletePerson(innerRequest, env, id), needsBootstrap: true };
  }
  return null;
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const resolved = route(request);
    if (!resolved) throw new AppError(404, "NOT_FOUND", "未找到该接口");
    if (resolved.needsBootstrap) await ensureBootstrap(env);
    const response = await resolved.handler(request, env);
    response.headers.set("X-Request-Id", requestId);
    return response;
  } catch (error) {
    if (isAppError(error)) {
      const response = errorResponse(error);
      const cookieHeaders = sessionExpiredResponse(error, env);
      if (cookieHeaders) {
        const headers = new Headers(cookieHeaders);
        const cookie = headers.get("Set-Cookie");
        if (cookie) response.headers.set("Set-Cookie", cookie);
      }
      response.headers.set("X-Request-Id", requestId);
      return response;
    }
    console.error(JSON.stringify({ event: "worker.unhandled", requestId, errorType: error instanceof Error ? error.name : "UnknownError" }));
    const response = errorResponse(new AppError(500, "INTERNAL_ERROR", "服务暂时不可用，请重试"));
    response.headers.set("X-Request-Id", requestId);
    return response;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/api/")) return handleApi(request, env);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
