import type { ApiErrorBody } from "../shared/api";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorBody["error"]["code"],
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  } catch {
    throw new ApiClientError(0, "INTERNAL_ERROR", "网络连接失败，请检查网络后重试");
  }
  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // A non-JSON gateway failure still maps to one actionable client error.
    }
    throw new ApiClientError(
      response.status,
      body?.error.code ?? "INTERNAL_ERROR",
      body?.error.message ?? "服务暂时不可用，请重试",
      body?.error.fieldErrors,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function isSessionError(error: unknown): boolean {
  return error instanceof ApiClientError && (error.code === "SESSION_REQUIRED" || error.code === "SESSION_EXPIRED");
}

export function errorMessage(error: unknown, fallback = "操作失败，请重试"): string {
  return error instanceof ApiClientError ? error.message : fallback;
}
