// Skill「data-access-drizzle」の例：生 SQL（DAO）の戻り値を Zod で検証する（PostgreSQL）。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { connectTestDatabase } from "./test-database";

type Db = NodePgDatabase;

const totalSchema = z.object({ username: z.string(), total: z.number() });
type Total = z.infer<typeof totalSchema>;

// SUM は bigint で返り、pg は文字列にするため、integer に変換する
const totalsQuery = sql`
  SELECT u.username AS username, CAST(SUM(o.amount) AS integer) AS total
  FROM example_raw_users u LEFT JOIN example_raw_orders o ON o.user_id = u.id
  GROUP BY u.id ORDER BY u.id`;

// #region example:validate-raw-result
export async function totalsByUser(db: Db): Promise<Total[]> {
  const { rows } = await db.execute(totalsQuery);
  // 生 SQL の結果は型が付かない。型の宣言（as）に頼らず、Zod で検証して、想定と違う行をここで見つける
  return z.array(totalSchema).parse(rows);
}
// #endregion

// #region example:unchecked-raw-result-bad
export async function totalsByUserBad(db: Db): Promise<Total[]> {
  const { rows } = await db.execute(totalsQuery);
  // 悪い例：検証せずに型を宣言している。想定と違う行（注文のない利用者の total が null）も、number として通ってしまう
  return rows as Total[];
}
// #endregion

let client: Client;
let db: Db;

async function seed(withEmptyUser: boolean) {
  await client.query("DELETE FROM example_raw_orders");
  await client.query("DELETE FROM example_raw_users");
  await client.query(
    "INSERT INTO example_raw_users (id, username) VALUES (1, 'testuser_001')",
  );
  await client.query(
    "INSERT INTO example_raw_orders (id, user_id, amount) VALUES (1, 1, 100), (2, 1, 50)",
  );
  if (withEmptyUser) {
    await client.query(
      "INSERT INTO example_raw_users (id, username) VALUES (2, 'testuser_002')",
    );
  }
}

beforeAll(async () => {
  client = await connectTestDatabase();
  // この接続だけの一時的な表（接続を閉じると消える）
  await client.query(
    "CREATE TEMP TABLE example_raw_users (id integer PRIMARY KEY, username text NOT NULL)",
  );
  await client.query(
    "CREATE TEMP TABLE example_raw_orders (id integer PRIMARY KEY, user_id integer NOT NULL, amount integer NOT NULL)",
  );
  db = drizzle(client);
});

afterAll(async () => {
  await client.end();
});

describe("生 SQL の戻り値の検証", () => {
  it("良い例：想定どおりの行は、型の付いた値として返る", async () => {
    await seed(false);
    expect(await totalsByUser(db)).toEqual([
      { username: "testuser_001", total: 150 },
    ]);
  });

  it("良い例：想定と違う行（total が null）は、境界でエラーになる", async () => {
    await seed(true);
    await expect(totalsByUser(db)).rejects.toThrow(z.ZodError);
  });

  it("悪い例の問題：検証しないと、型は number なのに null が入ったまま通る", async () => {
    await seed(true);
    const totals = await totalsByUserBad(db);
    expect(totals[1]?.total).toBeNull();
  });
});
