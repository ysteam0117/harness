// Workers の入口。DB につなぐ処理（db/）を、サンプルの利用者のルートへ渡して組み込む。処理は app.ts・routes/・services/ に書く。
import { createApp } from "./app";
import { withSampleUsers } from "./db/sample-user.repository";
import { sampleUserRoutes } from "./routes/sample-users";

export default createApp({
  routes: [
    { path: "/api/sample-users", app: sampleUserRoutes(withSampleUsers) },
  ],
});
