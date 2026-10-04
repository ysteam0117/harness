// Hono のアプリ。ミドルウェア・エラーハンドラ・ルートをここで組み立てる。
// DB につなぐルートなどは、入口（index.ts）が options.routes で渡す。テストは、差し替えたものを渡す。
import { Hono } from "hono";
import { loadConfig } from "./config";
import { handleError, handleNotFound } from "./lib/error-handler";
import { originCheck, securityHeaders } from "./lib/security";
import { healthRoutes } from "./routes/health";

export type AppOptions = {
  /** 追加で組み込むルート（パスと、そのルートの Hono のアプリ） */
  routes?: { path: string; app: Hono<{ Bindings: Env }> }[];
};

export function createApp(options: AppOptions = {}) {
  const app = new Hono<{ Bindings: Env }>()
    .use(securityHeaders)
    .use(
      "/api/*",
      originCheck((env) => loadConfig(env).allowedOrigins),
    )
    .route("/api/health", healthRoutes);
  for (const route of options.routes ?? []) app.route(route.path, route.app);
  app.onError(handleError);
  app.notFound(handleNotFound);
  return app;
}
