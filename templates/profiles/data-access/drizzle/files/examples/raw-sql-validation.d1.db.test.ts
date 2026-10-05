// Skill「data-access-drizzle」の例：生 SQL（DAO）の戻り値を Zod で検証する（Cloudflare D1）。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

type Db = DrizzleD1Database;

const totalSchema = z.object({ username: z.string(), total: z.number() });
type Total = z.infer<typeof totalSchema>;

const totalsQuery = sql`
  SELECT u.username AS username, CAST(SUM(o.amount) AS INTEGER) AS total
  FROM example_raw_users u LEFT JOIN example_raw_orders o ON o.user_id = u.id
  GROUP BY u.id ORDER BY u.id`;

// #region example:validate-raw-result
export async function totalsByUser(db: Db): Promise<Total[]> {
  const rows = await db.all(totalsQuery);
  // 生 SQL の結果は型が付かない。型の宣言（as）に頼らず、Zod で検証して、想定と違う行をここで見つける
  return z.array(totalSchema).parse(rows);
}
// #endregion

// #region example:unchecked-raw-result-bad
export async function totalsByUserBad(db: Db): Promise<Total[]> {
  const rows = await db.all(totalsQuery);
  // 悪い例：検証せずに型を宣言している。想定と違う行（注文のない利用者の total が null）も、number として通ってしまう
  return rows as Total[];
}
// #endregion

const db = drizzle(env.DB);

async function seed(withEmptyUser: boolean) {
  await env.DB.exec("DELETE FROM example_raw_orders");
  await env.DB.exec("DELETE FROM example_raw_users");
  await env.DB.exec(
    "INSERT INTO example_raw_users (id, username) VALUES (1, 'testuser_001')",
  );
  await env.DB.exec(
    "INSERT INTO example_raw_orders (user_id, amount) VALUES (1, 100), (1, 50)",
  );
  if (withEmptyUser) {
    await env.DB.exec(
      "INSERT INTO example_raw_users (id, username) VALUES (2, 'testuser_002')",
    );
  }
}

beforeAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS example_raw_orders");
  await env.DB.exec("DROP TABLE IF EXISTS example_raw_users");
  await env.DB.exec(
    "CREATE TABLE example_raw_users (id INTEGER PRIMARY KEY, username TEXT NOT NULL)",
  );
  await env.DB.exec(
    "CREATE TABLE example_raw_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL)",
  );
});

afterAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS example_raw_orders");
  await env.DB.exec("DROP TABLE IF EXISTS example_raw_users");
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
