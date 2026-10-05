// Skill「data-access-drizzle」の例：トランザクション（PostgreSQL。D1 は db.batch を使う）。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import { eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { integer, pgTable } from "drizzle-orm/pg-core";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectTestDatabase } from "./test-database";

// この接続だけの一時的な表（接続を閉じると消える）
const accounts = pgTable("example_tx_accounts", {
  id: integer("id").primaryKey(),
  balance: integer("balance").notNull(),
});

type Db = NodePgDatabase;

// #region example:transaction
export async function transfer(
  db: Db,
  from: number,
  to: number,
  amount: number,
) {
  // db.transaction() の中で失敗（例外）すると、全体が取り消される。この処理は Repository の中に閉じ込める
  await db.transaction(async (tx) => {
    await tx
      .update(accounts)
      .set({ balance: sql`${accounts.balance} + ${amount}` })
      .where(eq(accounts.id, to));
    await tx
      .update(accounts)
      .set({ balance: sql`${accounts.balance} - ${amount}` })
      .where(eq(accounts.id, from));
  });
}
// #endregion

// #region example:sequential-writes-bad
export async function transferBad(
  db: Db,
  from: number,
  to: number,
  amount: number,
) {
  // 悪い例：トランザクションを使わずに、文を1つずつ実行している。2つ目が失敗しても、1つ目の書き込みは残る
  await db
    .update(accounts)
    .set({ balance: sql`${accounts.balance} + ${amount}` })
    .where(eq(accounts.id, to));
  await db
    .update(accounts)
    .set({ balance: sql`${accounts.balance} - ${amount}` })
    .where(eq(accounts.id, from));
}
// #endregion

let client: Client;
let db: Db;

/** 口座 1 は 100、口座 2 は 0 に戻す。残高は 0 未満にならない（CHECK 制約）ため、100 を超える送金は途中で失敗する */
async function reset() {
  await client.query("DELETE FROM example_tx_accounts");
  await db.insert(accounts).values([
    { id: 1, balance: 100 },
    { id: 2, balance: 0 },
  ]);
}

async function balances() {
  const rows = await db.select().from(accounts).orderBy(accounts.id);
  return rows.map((r) => r.balance);
}

beforeAll(async () => {
  client = await connectTestDatabase();
  await client.query(
    "CREATE TEMP TABLE example_tx_accounts (id integer PRIMARY KEY, balance integer NOT NULL CHECK (balance >= 0))",
  );
  db = drizzle(client);
});

afterAll(async () => {
  await client.end();
});

describe("トランザクション", () => {
  it("良い例：全部成功すれば、すべて反映される", async () => {
    await reset();
    await transfer(db, 1, 2, 30);
    expect(await balances()).toEqual([70, 30]);
  });

  it("良い例：途中で失敗すると、先に実行した書き込みも取り消される", async () => {
    await reset();
    await expect(transfer(db, 1, 2, 150)).rejects.toThrow();
    expect(await balances()).toEqual([100, 0]);
  });

  it("悪い例の問題：途中で失敗しても、先に実行した書き込みが残る（お金が増える）", async () => {
    await reset();
    await expect(transferBad(db, 1, 2, 150)).rejects.toThrow();
    expect(await balances()).toEqual([100, 150]);
  });
});
