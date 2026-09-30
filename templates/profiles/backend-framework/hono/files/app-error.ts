// アプリ独自のエラー（C-73）。想定できるエラーはこれで投げ、エラーハンドラでHTTPステータスとエラーコードに変換する。
export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "FORBIDDEN_ORIGIN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE";

const STATUS: Record<AppErrorCode, 401 | 403 | 404 | 409 | 422 | 429 | 503> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  FORBIDDEN_ORIGIN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
};

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    readonly userMessage: string,
    readonly details: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(userMessage, options);
    this.name = "AppError";
  }

  get status() {
    return STATUS[this.code];
  }
}
