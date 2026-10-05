// Skill「data-access-drizzle」の例：楽観的ロック（Cloudflare D1）。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import { env } from "cloudflare:workers";
import { and, eq, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../lib/app-error";

const items = sqliteTable("example_lock_items", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  version: integer("version").notNull(),
});

type Db = DrizzleD1Database;

// #region example:optimistic-lock
export async function rename(
  db: Db,
  id: number,
  expectedVersion: number,
  name: string,
) {
  const result = await db
    .update(items)
    .set({ name, version: sql`${items.version} + 1` })
    .where(and(eq(items.id, id), eq(items.version, expectedVersion)))
    .run();
  // 更新した件数が0なら、読んだあとに誰かが更新している。上書きせず、衝突として知らせる
  if (result.meta.changes === 0) {
    throw new AppError(
      "CONFLICT",
      "他の人が先に更新しました。読み込み直してください",
    );
  }
}
// #endregion

// #region example:no-version-check-bad
export async function renameBad(db: Db, id: number, name: string) {
  // 悪い例：版を確かめずに更新している。古い画面からの更新が、他の人の変更を黙って上書きする
  await db
    .update(items)
    .set({ name, version: sql`${items.version} + 1` })
    .where(eq(items.id, id))
    .run();
}
// #endregion

const db = drizzle(env.DB);

async function nameOf(id: number) {
  const [row] = await db.select().from(items).where(eq(items.id, id));
  return row?.name;
}

beforeAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS example_lock_items");
  await env.DB.exec(
    "CREATE TABLE example_lock_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL)",
  );
});

afterAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS example_lock_items");
});

describe("楽観的ロック", () => {
  // 2人が、同じ版（1）を読んだあとで、それぞれ更新する
  async function twoEditors() {
    await env.DB.exec("DELETE FROM example_lock_items");
    await db.insert(items).values({ id: 1, name: "original", version: 1 });
  }

  it("良い例：先に更新した人の変更を、あとから更新した人が上書きしない（CONFLICT）", async () => {
    await twoEditors();
    await rename(db, 1, 1, "edited_by_a");
    await expect(rename(db, 1, 1, "edited_by_b")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await nameOf(1)).toBe("edited_by_a");
  });

  it("悪い例の問題：版を確かめないと、先に更新した人の変更が消える", async () => {
    await twoEditors();
    await renameBad(db, 1, "edited_by_a");
    await renameBad(db, 1, "edited_by_b");
    expect(await nameOf(1)).toBe("edited_by_b");
  });
});
