// Skill「data-access-drizzle」の例：SQL インジェクション（PostgreSQL）。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import { asc, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectTestDatabase } from "./test-database";

// この接続だけの一時的な表（接続を閉じると消える）
const users = pgTable("example_injection_users", {
  id: integer("id").primaryKey(),
  username: text("username").notNull(),
});

type Db = NodePgDatabase;

// #region example:parameterized
export function findByUsername(db: Db, username: string) {
  // 値はクエリビルダーで渡す。ドライバがパラメータとして扱うため、入力はSQLの一部にならない
  // （sql テンプレートを使う場合も、値は ${username} で埋め込む）
  return db.select().from(users).where(eq(users.username, username));
}
// #endregion

// #region example:order-by-allowlist
const SORT_COLUMNS = { id: users.id, username: users.username };

export function listSorted(db: Db, sort: string) {
  // 並び替えの列名はパラメータで渡せない。許可リストにある列だけを使い、それ以外は既定の列にする
  const column = Object.hasOwn(SORT_COLUMNS, sort)
    ? SORT_COLUMNS[sort as keyof typeof SORT_COLUMNS]
    : users.id;
  return db.select().from(users).orderBy(asc(column));
}
// #endregion

// #region example:string-concat-bad
export function findByUsernameBad(db: Db, username: string) {
  // 悪い例：入力を文字列でSQLにつなげている。' OR 1=1 -- を渡すと、全件が返る
  return db.execute(
    sql.raw(
      `SELECT * FROM example_injection_users WHERE username = '${username}'`,
    ),
  );
}
// #endregion

const ATTACK = "' OR 1=1 --";

let client: Client;
let db: Db;

beforeAll(async () => {
  client = await connectTestDatabase();
  await client.query(
    "CREATE TEMP TABLE example_injection_users (id integer PRIMARY KEY, username text NOT NULL)",
  );
  db = drizzle(client);
  await db.insert(users).values([
    { id: 1, username: "testuser_002" },
    { id: 2, username: "testuser_001" },
  ]);
});

afterAll(async () => {
  await client.end();
});

describe("SQL インジェクション", () => {
  it("良い例：入力は値として扱われ、細工した文字列では何も見つからない", async () => {
    expect(await findByUsername(db, "testuser_001")).toHaveLength(1);
    expect(await findByUsername(db, ATTACK)).toEqual([]);
  });

  it("良い例：並び替えの列は許可リストで決まり、許可外の入力は既定の列になる", async () => {
    const byName = await listSorted(db, "username");
    expect(byName.map((u) => u.username)).toEqual([
      "testuser_001",
      "testuser_002",
    ]);
    const fallback = await listSorted(
      db,
      "username; DROP TABLE example_injection_users",
    );
    expect(fallback.map((u) => u.id)).toEqual([1, 2]);
  });

  it("悪い例の問題：文字列をつなげると、細工した入力で全件が返ってしまう", async () => {
    expect((await findByUsernameBad(db, "testuser_001")).rows).toHaveLength(1);
    expect((await findByUsernameBad(db, ATTACK)).rows).toHaveLength(2);
  });
});
