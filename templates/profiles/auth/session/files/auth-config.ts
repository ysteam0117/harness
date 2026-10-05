// 認証の設定の読み込み（C-40）。認証ありの生成物だけが持つため、共通の config.ts とは分けている。
// SESSION_SECRET は必須で、欠落を既定値で隠さない（値は表示しない）。
import { loadConfig } from "../config";

/** SESSION_SECRET の最小の長さ。生成した十分に長いランダムな値を使う */
const MIN_SECRET_LENGTH = 16;

export type AuthConfig = {
  /** セッションの識別子をハッシュにする鍵（HMAC-SHA-256） */
  sessionSecret: string;
  /** 本番か。本番は Cookie に __Host- の名前と Secure を使う */
  production: boolean;
};

/** Workers の環境（c.env）から、認証の設定を作る。足りなければ Error */
export function loadAuthConfig(env: unknown): AuthConfig {
  const raw = (typeof env === "object" && env !== null ? env : {}) as Record<
    string,
    unknown
  >;
  const secret = raw["SESSION_SECRET"];
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET を設定してください（${String(MIN_SECRET_LENGTH)} 文字以上。値は表示しません）。`,
    );
  }
  return {
    sessionSecret: secret,
    production: loadConfig(env).appEnv === "production",
  };
}
