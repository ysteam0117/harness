// 認可のミドルウェア（C-13）。/api/* は、公開すると明示したもの以外すべて、セッションを確かめる（既定で拒否）。
// 新しい API は、何もしなくても保護される。公開したいときだけ、下の許可リストに理由つきで足す。
import type { Context, MiddlewareHandler } from "hono";
import type { SessionUser } from "../db/session.repository";
import {
  createSessionService,
  type WithSessions,
} from "../services/session.service";
import { AppError } from "./app-error";
import { loadAuthConfig } from "./auth-config";
import { readSessionId } from "./session";

export type AuthUser = SessionUser;

// requireAuth が c.set("user", ...) で入れる値。どの Hono のアプリでも c.get("user") で読める（読むのは currentUser を通す）
declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

type AuthEnv = { Bindings: Env };

type PublicApi = {
  /** この名前そのものと、その下のパス（/api/health と /api/health/...）が対象 */
  path: string;
  /** 認証なしで公開する理由 */
  reason: string;
};

/**
 * 認証なしで公開する API。ここに足すときは、理由を必ず書く。
 * 応答は、キャッシュの制御を変えない（Cache-Control: no-store を付けない）。
 */
export const PUBLIC_API_PATHS: readonly PublicApi[] = [
  { path: "/api/health", reason: "死活監視と画面の動作確認のため" },
  {
    path: "/api/sample-users",
    reason:
      "動作確認の見本。実際の業務の API は requireAuth で保護する（この行は、見本を消すときに消す）",
  },
];

/**
 * 認証なしで公開する認証の API（ログイン・登録・パスワードの再設定・OIDC のコールバックなど）。
 * 応答は、キャッシュさせない（Cache-Control: no-store）。独自認証・OIDC の Issue で足す。
 */
export const PUBLIC_AUTH_API_PATHS: readonly PublicApi[] = [];

function isListed(path: string, list: readonly PublicApi[]): boolean {
  return list.some(
    (entry) => path === entry.path || path.startsWith(`${entry.path}/`),
  );
}

/** Cookie のセッションが有効なときだけ通す。違うときは 401（原因は知らせない）。成功したら c.get("user") で利用者を読める */
export function requireAuth(
  withSessions: WithSessions,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const config = loadAuthConfig(c.env);
    const id = readSessionId(c.req.header("Cookie"), config.production);
    const user =
      id === undefined
        ? undefined
        : await withSessions(c.env, (repository) =>
            createSessionService(repository, {
              secret: config.sessionSecret,
            }).verify(id),
          );
    if (user === undefined) {
      throw new AppError("UNAUTHENTICATED", "ログインが必要です");
    }
    c.set("user", user);
    await next();
  };
}

/**
 * /api/* の入口。許可リストにない API は requireAuth を通し、許可リストの外の応答には Cache-Control: no-store を付ける（C-58）。
 * Cache-Control は、requireAuth が 401 を投げた応答にも付ける（security.ts の noStore は、後続が例外を投げると付けないため、finally で付ける）。
 */
export function apiGuard(
  withSessions: WithSessions,
): MiddlewareHandler<AuthEnv> {
  const authenticate = requireAuth(withSessions);
  return async (c, next) => {
    if (isListed(c.req.path, PUBLIC_API_PATHS)) return next();
    try {
      if (isListed(c.req.path, PUBLIC_AUTH_API_PATHS)) await next();
      else await authenticate(c, next);
    } finally {
      c.header("Cache-Control", "no-store");
    }
  };
}

/** ルートの中で、ログイン中の利用者を読む。requireAuth を通っていなければ 401（保護の組み忘れを、通さない） */
export function currentUser(c: Context<AuthEnv>): AuthUser {
  const user = c.get("user") as AuthUser | undefined;
  if (user === undefined) {
    throw new AppError("UNAUTHENTICATED", "ログインが必要です");
  }
  return user;
}
