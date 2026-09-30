// セキュリティの共通設定（C-27〜C-29・C-58）。
import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { AppError } from "./app-error";

// セキュリティヘッダー（初期値。外部のサービスを使う場合は、プロジェクトごとに追加してADRに記録する）
export const securityHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    frameAncestors: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  },
  strictTransportSecurity: "max-age=31536000; includeSubDomains",
  xFrameOptions: "DENY",
  referrerPolicy: "strict-origin-when-cross-origin",
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
});

// 状態を変える要求は、Content-Typeにかかわらず送信元（Origin）を確かめる（C-28）。
// 注意：Honoの csrf ミドルウェアはフォームの送信だけを確かめ、JSONの要求は確かめないため、これを使う。
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function originCheck(
  getAllowedOrigins: (env: unknown) => string[],
): MiddlewareHandler {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header("Origin");
      if (!origin || !getAllowedOrigins(c.env).includes(origin)) {
        throw new AppError("FORBIDDEN_ORIGIN", "この操作は許可されていません");
      }
    }
    await next();
  };
}

// 認証が必要なAPI・個人向けのデータをキャッシュに残さない（C-58）
export const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
};
