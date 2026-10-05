// Skill「data-access-drizzle」の例：楽観的ロック（PostgreSQL）。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import { and, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../lib/app-error";
import { connectTestDatabase } from "./test-database";

// この接続だけの一時的な表（接続を閉じると消える）
const items = pgTable("example_lock_items", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  version: integer("version").notNull(),
});

type Db = NodePgDatabase;

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
    .where(and(eq(items.id, id), eq(items.version, expectedVersion)));
  // 更新した件数（rowCount）が0なら、読んだあとに誰かが更新している。上書きせず、衝突として知らせる
  if (result.rowCount === 0) {
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
    .where(eq(items.id, id));
}
// #endregion

let client: Client;
let db: Db;

async function nameOf(id: number) {
  const [row] = await db.select().from(items).where(eq(items.id, id));
  return row?.name;
}

beforeAll(async () => {
  client = await connectTestDatabase();
  await client.query(
    "CREATE TEMP TABLE example_lock_items (id integer PRIMARY KEY, name text NOT NULL, version integer NOT NULL)",
  );
  db = drizzle(client);
});

afterAll(async () => {
  await client.end();
});

describe("楽観的ロック", () => {
  // 2人が、同じ版（1）を読んだあとで、それぞれ更新する
  async function twoEditors() {
    await client.query("DELETE FROM example_lock_items");
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
