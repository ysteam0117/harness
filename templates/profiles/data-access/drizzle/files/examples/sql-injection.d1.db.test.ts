// Skill「data-access-drizzle」の例：SQL インジェクション（Cloudflare D1）。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import { env } from "cloudflare:workers";
import { asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const users = sqliteTable("example_injection_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
});
const db = drizzle(env.DB);

// #region example:parameterized
export function findByUsername(username: string) {
  // 値はクエリビルダーで渡す。ドライバがパラメータとして扱うため、入力はSQLの一部にならない
  // （sql テンプレートを使う場合も、値は ${username} で埋め込む）
  return db.select().from(users).where(eq(users.username, username));
}
// #endregion

// #region example:order-by-allowlist
const SORT_COLUMNS = { id: users.id, username: users.username };

export function listSorted(sort: string) {
  // 並び替えの列名はパラメータで渡せない。許可リストにある列だけを使い、それ以外は既定の列にする
  const column = Object.hasOwn(SORT_COLUMNS, sort)
    ? SORT_COLUMNS[sort as keyof typeof SORT_COLUMNS]
    : users.id;
  return db.select().from(users).orderBy(asc(column));
}
// #endregion

// #region example:string-concat-bad
export function findByUsernameBad(username: string) {
  // 悪い例：入力を文字列でSQLにつなげている。' OR 1=1 -- を渡すと、全件が返る
  return db.all(
    sql.raw(
      `SELECT * FROM example_injection_users WHERE username = '${username}'`,
    ),
  );
}
// #endregion

const ATTACK = "' OR 1=1 --";

beforeAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS example_injection_users");
  await env.DB.exec(
    "CREATE TABLE example_injection_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL)",
  );
  await db
    .insert(users)
    .values([{ username: "testuser_002" }, { username: "testuser_001" }]);
});

afterAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS example_injection_users");
});

describe("SQL インジェクション", () => {
  it("良い例：入力は値として扱われ、細工した文字列では何も見つからない", async () => {
    expect(await findByUsername("testuser_001")).toHaveLength(1);
    expect(await findByUsername(ATTACK)).toEqual([]);
  });

  it("良い例：並び替えの列は許可リストで決まり、許可外の入力は既定の列になる", async () => {
    const byName = await listSorted("username");
    expect(byName.map((u) => u.username)).toEqual([
      "testuser_001",
      "testuser_002",
    ]);
    const fallback = await listSorted(
      "username; DROP TABLE example_injection_users",
    );
    expect(fallback.map((u) => u.id)).toEqual([1, 2]);
  });

  it("悪い例の問題：文字列をつなげると、細工した入力で全件が返ってしまう", async () => {
    expect(await findByUsernameBad("testuser_001")).toHaveLength(1);
    expect(await findByUsernameBad(ATTACK)).toHaveLength(2);
  });
});
