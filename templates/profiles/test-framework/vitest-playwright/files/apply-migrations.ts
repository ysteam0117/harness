// バックエンドのテストの前に、ローカルのD1へマイグレーションを適用する。
// マイグレーションは vitest.config.ts が読み込んで、バインディング TEST_MIGRATIONS に入れたもの（テストのときだけ入る）。
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
