// 共通ロガー（C-30）。各層から console.log を直接呼ばず、これを使う。
// JSONで1行1件、OpenTelemetryの項目名に合わせる。秘密情報・個人情報は項目名で自動的に伏せ字にする。

type Severity = "DEBUG" | "INFO" | "WARN" | "ERROR";
type Attributes = Record<string, unknown>;

// 伏せ字にする項目名（大文字・小文字を区別しない、部分一致）
const REDACT_KEYS = [
  "password",
  "passcode",
  "otp",
  "token",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "session",
  "set-cookie",
  "email",
  "phone",
  "address",
  "name_kana",
  "birthday",
];
const REDACTED = "[REDACTED]";
const MAX_DEPTH = 5;

function shouldRedact(key: string): boolean {
  const k = key.toLowerCase();
  return REDACT_KEYS.some((r) => k.includes(r));
}

// 改行などの制御文字を無害化する（ログインジェクション対策）
function sanitizeText(value: string): string {
  return value.replace(
    /[\u0000-\u001f\u007f]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error)
    return { name: value.name, message: sanitizeText(value.message) };
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Attributes).map(([k, v]) => [
        k,
        shouldRedact(k) ? REDACTED : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

export type LogContext = { traceId?: string; userId?: string };

function write(
  severity: Severity,
  body: string,
  attributes: Attributes,
  context: LogContext,
): void {
  const record = {
    timestamp: new Date().toISOString(),
    severity_text: severity,
    body: sanitizeText(body),
    trace_id: context.traceId,
    user_id: context.userId,
    attributes: redact(attributes),
  };
  const line = JSON.stringify(record);
  if (severity === "ERROR") console.error(line);
  else if (severity === "WARN") console.warn(line);
  else console.log(line);
}

export function createLogger(context: LogContext = {}) {
  return {
    debug: (body: string, attributes: Attributes = {}) =>
      write("DEBUG", body, attributes, context),
    info: (body: string, attributes: Attributes = {}) =>
      write("INFO", body, attributes, context),
    warn: (body: string, attributes: Attributes = {}) =>
      write("WARN", body, attributes, context),
    error: (body: string, attributes: Attributes = {}) =>
      write("ERROR", body, attributes, context),
    // 監査ログ：誰が・何を・どの対象に・結果（C-30）
    audit: (
      action: string,
      target: string,
      result: "success" | "failure",
      attributes: Attributes = {},
    ) =>
      write(
        "INFO",
        action,
        { ...attributes, log_type: "audit", target, result },
        context,
      ),
  };
}

export type Logger = ReturnType<typeof createLogger>;
