// DB への接続（PostgreSQL。Cloudflare Hyperdrive 経由）。接続の仕方はこのファイルに閉じ込める。
// pg を読み込むのは backend/src/db/ だけにする（Workers のテストの道具の中では、pg を読み込めないため）。
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "../../db/schema";

export type Database = NodePgDatabase<typeof schema>;

/** 要求ごとに接続し、終わったら必ず閉じる（接続の再利用は Hyperdrive が行う） */
export async function withDatabase<T>(
  env: Env,
  run: (db: Database) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
  });
  await client.connect();
  try {
    return await run(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}
