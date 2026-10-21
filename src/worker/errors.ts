import type { ApiErrorCode } from "../shared/api";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
