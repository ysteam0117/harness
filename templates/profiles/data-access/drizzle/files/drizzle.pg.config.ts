import { defineConfig } from "drizzle-kit";

// .env があれば読む（なければ、環境変数をそのまま使う）。drizzle-kit は .env を自動では読まないため
try {
  process.loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const url = process.env.DATABASE_URL;

// マイグレーションを作る（npm run db:generate）ときは、接続先は要らない。適用する（npm run db:migrate）ときに必要になる
export default defineConfig({
  dialect: "postgresql",
  schema: "./backend/db/schema.ts",
  out: "./backend/db/migrations",
  ...(url ? { dbCredentials: { url } } : {}),
});
