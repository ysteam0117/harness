// 認証のテストの共通の準備：本物の組み立て（createApp・authRoutes）に、メモリ上の Repository を渡して動かす。
import { createApp, type AppOptions } from "../src/app";
import { sessionCookieName } from "../src/lib/session";
import { loadAuthConfig } from "../src/lib/auth-config";
import { authRoutes } from "../src/routes/auth-session";
import { createSessionService } from "../src/services/session.service";
import type { SessionRepository } from "../src/db/session.repository";

export const TEST_ORIGIN = "http://localhost:5173";

/** テストの環境。SESSION_SECRET は、このテストの中だけで使う毎回生成する値 */
export function createAuthTestEnv(over: Record<string, string> = {}) {
  return {
    APP_ENV: "test",
    ALLOWED_ORIGINS: TEST_ORIGIN,
    SESSION_SECRET: crypto.randomUUID(),
    ...over,
  };
}

type TestEnv = ReturnType<typeof createAuthTestEnv>;

/** 保護の組み立て（authRoutes）を先頭に置いて、追加のルートを足したアプリ */
export function createAuthTestApp(
  repository: SessionRepository,
  extraRoutes: NonNullable<AppOptions["routes"]> = [],
) {
  const withSessions = <T>(
    _env: unknown,
    run: (repository: SessionRepository) => Promise<T>,
  ) => run(repository);
  return createApp({
    routes: [...authRoutes(withSessions), ...extraRoutes],
  });
}

/** セッションを作り、その識別子を入れた Cookie のヘッダーの値を返す */
export async function issueCookie(
  repository: SessionRepository,
  env: TestEnv,
  userId: string,
  now: () => Date = () => new Date(),
): Promise<{ id: string; cookie: string }> {
  const config = loadAuthConfig(env);
  const issued = await createSessionService(repository, {
    secret: config.sessionSecret,
    now,
  }).create(userId);
  return {
    id: issued.id,
    cookie: `${sessionCookieName(config.production)}=${issued.id}`,
  };
}
