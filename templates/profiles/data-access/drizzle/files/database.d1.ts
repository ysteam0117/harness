// DB への接続（Cloudflare D1）。接続の仕方はこのファイルに閉じ込める。
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../../db/schema";

export type Database = DrizzleD1Database<typeof schema>;

export function withDatabase<T>(
  env: Env,
  run: (db: Database) => Promise<T>,
): Promise<T> {
  return run(drizzle(env.DB, { schema }));
}
