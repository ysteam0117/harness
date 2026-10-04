// Workers の入口。Hono のアプリを export する。処理は app.ts・routes/・services/ に書く。
import { createApp } from "./app";

export default createApp();
