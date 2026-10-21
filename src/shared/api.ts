export const roles = ["volunteer", "admin"] as const;
export type Role = (typeof roles)[number];

export interface UserSummary {
  id: string;
  name: string;
  role: Role;
}

export interface PersonSummary extends UserSummary {
  studentId: string;
}

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "RATE_LIMITED"
  | "SESSION_REQUIRED"
  | "SESSION_EXPIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "IMPORT_INVALID"
  | "IMPORT_NO_CHANGES"
  | "LAST_ADMIN"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    fieldErrors?: Record<string, string>;
  };
}

export type ImportStatus = "add" | "upgrade" | "skip" | "error";

export interface ImportPreviewRow {
  row: number;
  name: string;
  studentId: string;
  status: ImportStatus;
  message: string;
}

export interface ImportCounts {
  add: number;
  upgrade: number;
  skip: number;
  error: number;
}

export interface ImportPreviewResponse {
  rows: ImportPreviewRow[];
  ignoredColumns: string[];
  counts: ImportCounts;
}

export interface ImportCommitResponse {
  outcomes: ImportPreviewRow[];
  counts: ImportCounts;
  changed: number;
}
