// Repository：DB へのアクセスはこの層に閉じ込める（C-03）。Service は、このファイルの型だけを知る。
import { asc } from "drizzle-orm";
import { sampleUsers } from "../../db/schema";
import type { Database } from "./database";

export type SampleUser = { username: string };

/** 例の一覧に出す件数の上限 */
export const LIST_LIMIT = 100;

/** 同じユーザー名がすでにある（一意の制約に違反した）ときに、add が投げる */
export class DuplicateSampleUserError extends Error {
  constructor(
    readonly username: string,
    options?: { cause?: unknown },
  ) {
    super("同じユーザー名がすでにあります", options);
    this.name = "DuplicateSampleUserError";
  }
}

/** DB のエラー（原因の連なりを含む）が、一意の制約の違反か。D1（SQLite）はメッセージ、PostgreSQL はエラーコード 23505 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (/UNIQUE constraint failed/i.test(current.message)) return true;
    if ((current as { code?: unknown }).code === "23505") return true;
    current = current.cause;
  }
  return false;
}

export type SampleUserRepository = {
  /** ユーザー名の昇順。件数は LIST_LIMIT まで */
  list(): Promise<SampleUser[]>;
  /** 同じユーザー名がすでにあれば、DuplicateSampleUserError を投げる */
  add(username: string): Promise<void>;
};

export function createSampleUserRepository(db: Database): SampleUserRepository {
  return {
    async list() {
      return db
        .select({ username: sampleUsers.username })
        .from(sampleUsers)
        .orderBy(asc(sampleUsers.username))
        .limit(LIST_LIMIT);
    },
    async add(username) {
      try {
        await db.insert(sampleUsers).values({ username });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DuplicateSampleUserError(username, { cause: error });
        }
        throw error;
      }
    },
  };
}

/**
 * Repository を使う間だけ DB につなぐ。
 * 接続のファイル（database）は、使うときに初めて読み込む（PostgreSQL の pg は Workers のテストの道具の中では読み込めないため、
 * このファイルを読むだけの Service のテストが落ちないようにする）
 */
export async function withSampleUsers<T>(
  env: Env,
  run: (repository: SampleUserRepository) => Promise<T>,
): Promise<T> {
  const { withDatabase } = await import("./database");
  return withDatabase(env, (db) => run(createSampleUserRepository(db)));
}
