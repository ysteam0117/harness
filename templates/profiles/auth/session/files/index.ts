// Workers の入口。DB につなぐ処理（db/）を、認証とサンプルの利用者のルートへ渡して組み込む。処理は app.ts・routes/・services/ に書く。
import { createApp } from "./app";
import { withSampleUsers } from "./db/sample-user.repository";
import { withSessions } from "./db/session.repository";
import { authRoutes } from "./routes/auth-session";
import { sampleUserRoutes } from "./routes/sample-users";

export default createApp({
  routes: [
    // 認証の組み立ては先頭に置く。これより後ろのルートは、許可リスト（lib/auth-middleware.ts）にない限り、既定で保護される
    ...authRoutes(withSessions),
    { path: "/api/sample-users", app: sampleUserRoutes(withSampleUsers) },
  ],
});
