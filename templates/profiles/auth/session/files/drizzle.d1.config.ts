import { defineConfig } from "drizzle-kit";

// マイグレーションを作る設定（npm run db:generate）。D1 への適用は wrangler が行う（npm run db:migrate:local）。
// 認証の表（auth-schema.ts）も、アプリの表（schema.ts）と同じマイグレーションに入れる。
export default defineConfig({
  dialect: "sqlite",
  schema: ["./backend/db/schema.ts", "./backend/db/auth-schema.ts"],
  out: "./backend/db/migrations",
});
