// Controller（ルート）：ログイン中の利用者（GET /api/auth/me）とログアウト（POST /api/auth/logout）。
// 送信元の確認（POST）は app.ts の /api/* で行う。DB の処理は引数で受け取る（routes は db/ を直接読まない）。
import { Hono } from "hono";
import type { AppOptions } from "../app";
import { AppError } from "../lib/app-error";
import { apiGuard, currentUser } from "../lib/auth-middleware";
import { loadAuthConfig } from "../lib/auth-config";
import { readSessionId, serializeClearedSessionCookie } from "../lib/session";
import {
  createSessionService,
  type WithSessions,
} from "../services/session.service";

/**
 * 認証の組み立て。index.ts は、これを routes の先頭に置く。
 * 先頭の /api の入口が、これより後ろに足したルートも含めて、許可リストにない API をすべて保護する（既定で拒否）。
 */
export function authRoutes(
  withSessions: WithSessions,
): NonNullable<AppOptions["routes"]> {
  const guard = new Hono<{ Bindings: Env }>().use("*", apiGuard(withSessions));
  const session = new Hono<{ Bindings: Env }>()
    .get("/me", (c) => {
      const user = currentUser(c);
      return c.json({ id: user.id, email: user.email });
    })
    .post("/logout", async (c) => {
      const config = loadAuthConfig(c.env);
      const id = readSessionId(c.req.header("Cookie"), config.production);
      if (id === undefined) {
        throw new AppError("UNAUTHENTICATED", "ログインが必要です");
      }
      // サーバー側のセッションを無効にする。外部 IdP のセッションは終了しない（C-16）
      await withSessions(c.env, (repository) =>
        createSessionService(repository, {
          secret: config.sessionSecret,
        }).destroy(id),
      );
      c.header(
        "Set-Cookie",
        serializeClearedSessionCookie({ production: config.production }),
      );
      return c.body(null, 204);
    });
  return [
    { path: "/api", app: guard },
    { path: "/api/auth", app: session },
  ];
}
