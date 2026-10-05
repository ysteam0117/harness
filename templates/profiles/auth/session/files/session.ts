// セッションの識別子・ハッシュ・Cookie（C-16）。Hono も DB も知らない。
// Cookie に入れるのはランダムな識別子だけで、DB にはそのハッシュだけを保存する（漏えいしても、そのままは使えない）。

/** 絶対の期限：作ってから 7 日で、使っていても切れる */
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
/** アイドルの期限：最後に使ってから 24 時間で切れる */
export const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;

const ID_BYTES = 32;
/** 32 バイトを base64url（パディングなし）にした長さ */
const ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** 推測できないセッションの識別子（32 バイトの乱数を base64url にした 43 文字） */
export function generateSessionId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(ID_BYTES)));
}

/** DB に保存する値。識別子を、SESSION_SECRET を鍵にした HMAC-SHA-256 のハッシュ（16 進数）にする */
export async function hashSessionId(
  id: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(id));
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

type CookieEnvironment = { production: boolean };

/** 本番は __Host-session（Secure・Path=/・Domain なしが必須）、開発・検証は session（http の手元でも動く） */
export function sessionCookieName(production: boolean): string {
  return production ? "__Host-session" : "session";
}

function attributes(
  { production }: CookieEnvironment,
  maxAgeSeconds: number,
): string {
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${String(maxAgeSeconds)}`,
    ...(production ? ["Secure"] : []),
  ].join("; ");
}

/** Set-Cookie の値（セッションの識別子を入れる） */
export function serializeSessionCookie(
  id: string,
  options: CookieEnvironment & { maxAgeSeconds: number },
): string {
  return `${sessionCookieName(options.production)}=${id}; ${attributes(options, options.maxAgeSeconds)}`;
}

/** Set-Cookie の値（Cookie を消す。同じ名前・属性で Max-Age=0） */
export function serializeClearedSessionCookie(
  options: CookieEnvironment,
): string {
  return `${sessionCookieName(options.production)}=; ${attributes(options, 0)}`;
}

/** Cookie ヘッダーから、セッションの識別子を読む。ない・形が違うときは undefined（DB は引かない） */
export function readSessionId(
  cookieHeader: string | undefined,
  production: boolean,
): string | undefined {
  if (cookieHeader === undefined) return undefined;
  const prefix = `${sessionCookieName(production)}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const value = trimmed.slice(prefix.length);
    return ID_PATTERN.test(value) ? value : undefined;
  }
  return undefined;
}
