import type { ZodType } from "zod";
import type { ApiErrorBody } from "../shared/api";
import { AppError } from "./errors";

const apiHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(apiHeaders)) headers.set(name, value);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function empty(init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(apiHeaders)) headers.set(name, value);
  return new Response(null, { ...init, headers });
}

export function fileResponse(body: BodyInit, filename: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      ...apiHeaders,
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export function errorResponse(error: AppError): Response {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    },
  };
  return json(body, { status: error.status });
}

export function assertSameOrigin(request: Request): void {
  if (!new Set(["POST", "PUT", "PATCH", "DELETE"]).has(request.method)) return;
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new AppError(403, "FORBIDDEN", "请求来源无效");
  }
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
  status: number,
  code: "VALIDATION_ERROR" | "IMPORT_INVALID",
  message: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > maxBytes) throw new AppError(status, code, message);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError(status, code, message);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function boundedRequest(
  request: Request,
  maxBytes: number,
  status: number,
  code: "VALIDATION_ERROR" | "IMPORT_INVALID",
  message: string,
): Promise<Request> {
  const body = await readBoundedBody(request, maxBytes, status, code, message);
  return new Request(request.url, { method: request.method, headers: request.headers, body });
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AppError(415, "VALIDATION_ERROR", "请使用 JSON 提交数据");
  }
  let value: unknown;
  try {
    const body = await readBoundedBody(request, 64 * 1024, 413, "VALIDATION_ERROR", "提交内容过大");
    value = JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "VALIDATION_ERROR", "提交内容不是有效的 JSON");
  }

  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  throw new AppError(400, "VALIDATION_ERROR", "请检查填写内容", fieldErrors);
}
