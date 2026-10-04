import { defineConfig } from "drizzle-kit";

// マイグレーションを作る設定（npm run db:generate）。D1 への適用は wrangler が行う（npm run db:migrate:local）。
export default defineConfig({
  dialect: "sqlite",
  schema: "./backend/db/schema.ts",
  out: "./backend/db/migrations",
});
