import { defineConfig } from "drizzle-kit";

// DB 操作の入口（scripts/db-local.ts）が検証した接続先だけを渡す。

const url = process.env.DATABASE_URL;

// マイグレーションを作る（npm run db:generate）ときは、接続先は要らない。適用する（npm run db:migrate）ときに必要になる
export default defineConfig({
  dialect: "postgresql",
  schema: "./backend/db/schema.ts",
  out: "./backend/db/migrations",
  ...(url ? { dbCredentials: { url } } : {}),
});
