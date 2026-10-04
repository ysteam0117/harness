// Drizzle のスキーマ（PostgreSQL）。最初の1つのテーブルは例（架空の名前）。自分のアプリの表に置き換える。
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const sampleUsers = pgTable("sample_users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  username: text("username").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
