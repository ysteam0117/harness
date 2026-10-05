// Skill「data-access-drizzle」の例：N+1 を避ける（PostgreSQL）。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import { eq, inArray } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectTestDatabase } from "./test-database";

// この接続だけの一時的な表（接続を閉じると消える）
const users = pgTable("example_nplus1_users", {
  id: integer("id").primaryKey(),
  username: text("username").notNull(),
});
const orders = pgTable("example_nplus1_orders", {
  id: integer("id").primaryKey(),
  userId: integer("user_id").notNull(),
  item: text("item").notNull(),
});

type Db = NodePgDatabase;

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

let client: Client;
let queries: string[] = [];
let db: Db;

async function seed(userCount: number) {
  await client.query("DELETE FROM example_nplus1_orders");
  await client.query("DELETE FROM example_nplus1_users");
  for (let i = 1; i <= userCount; i += 1) {
    await db.insert(users).values({ id: i, username: `testuser_${String(i)}` });
    await db
      .insert(orders)
      .values({ id: i, userId: i, item: `item_${String(i)}` });
  }
  // 数えるのは、確かめる処理のクエリだけ（準備のクエリは数えない）
  queries = [];
}

beforeAll(async () => {
  client = await connectTestDatabase();
  await client.query(
    "CREATE TEMP TABLE example_nplus1_users (id integer PRIMARY KEY, username text NOT NULL)",
  );
  await client.query(
    "CREATE TEMP TABLE example_nplus1_orders (id integer PRIMARY KEY, user_id integer NOT NULL, item text NOT NULL)",
  );
  // 実行したクエリの数を数える
  db = drizzle(client, { logger: { logQuery: (q) => queries.push(q) } });
});

afterAll(async () => {
  await client.end();
});

describe("N+1", () => {
  it("良い例：利用者が増えても、クエリの数は変わらない（2回）", async () => {
    for (const count of [3, 6]) {
      await seed(count);
      const result = await listOrdersByUser(db);
      expect(result).toHaveLength(count);
      expect(result[0]).toEqual({ username: "testuser_1", items: ["item_1"] });
      expect(queries).toHaveLength(2);
    }
  });

  it("悪い例の問題：利用者の件数に比例して、クエリが増える（1 + 件数）", async () => {
    for (const count of [3, 6]) {
      await seed(count);
      expect(await listOrdersByUserBad(db)).toHaveLength(count);
      expect(queries).toHaveLength(1 + count);
    }
  });
});
