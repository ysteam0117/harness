// Skill「data-access-drizzle」の例：N+1 を避ける（Cloudflare D1）。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const users = sqliteTable("example_nplus1_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
});
const orders = sqliteTable("example_nplus1_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  item: text("item").notNull(),
});

type Db = DrizzleD1Database;

// #region example:batch-fetch
export async function listOrdersByUser(db: Db) {
  const allUsers = await db.select().from(users);
  // 利用者の件数にかかわらず、注文は1回のクエリで取る（inArray でまとめる。JOIN でもよい）
  const rows = await db
    .select()
    .from(orders)
    .where(
      inArray(
        orders.userId,
        allUsers.map((u) => u.id),
      ),
    );
  return allUsers.map((user) => ({
    username: user.username,
    items: rows.filter((o) => o.userId === user.id).map((o) => o.item),
  }));
}
// #endregion

// #region example:loop-query-bad
export async function listOrdersByUserBad(db: Db) {
  const allUsers = await db.select().from(users);
  const result = [];
  for (const user of allUsers) {
    // 悪い例：利用者ごとにクエリを投げている。利用者が増えるほど、クエリの数も増える（N+1）
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, user.id));
    result.push({ username: user.username, items: rows.map((o) => o.item) });
  }
  return result;
}
// #endregion

/** 実行したクエリの数を数える Drizzle を作る */
function countedDb() {
  const queries: string[] = [];
  const db = drizzle(env.DB, { logger: { logQuery: (q) => queries.push(q) } });
  return { db, queries };
}

async function seed(userCount: number) {
  await env.DB.exec("DELETE FROM example_nplus1_orders");
  await env.DB.exec("DELETE FROM example_nplus1_users");
  const plain = drizzle(env.DB);
  for (let i = 1; i <= userCount; i += 1) {
    await plain
      .insert(users)
      .values({ id: i, username: `testuser_${String(i)}` });
    await plain.insert(orders).values({ userId: i, item: `item_${String(i)}` });
  }
}

beforeAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS example_nplus1_orders");
  await env.DB.exec("DROP TABLE IF EXISTS example_nplus1_users");
  await env.DB.exec(
    "CREATE TABLE example_nplus1_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL)",
  );
  await env.DB.exec(
    "CREATE TABLE example_nplus1_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, item TEXT NOT NULL)",
  );
});

afterAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS example_nplus1_orders");
  await env.DB.exec("DROP TABLE IF EXISTS example_nplus1_users");
});

describe("N+1", () => {
  it("良い例：利用者が増えても、クエリの数は変わらない（2回）", async () => {
    for (const count of [3, 6]) {
      await seed(count);
      const { db, queries } = countedDb();
      const result = await listOrdersByUser(db);
      expect(result).toHaveLength(count);
      expect(result[0]).toEqual({ username: "testuser_1", items: ["item_1"] });
      expect(queries).toHaveLength(2);
    }
  });

  it("悪い例の問題：利用者の件数に比例して、クエリが増える（1 + 件数）", async () => {
    for (const count of [3, 6]) {
      await seed(count);
      const { db, queries } = countedDb();
      expect(await listOrdersByUserBad(db)).toHaveLength(count);
      expect(queries).toHaveLength(1 + count);
    }
  });
});
