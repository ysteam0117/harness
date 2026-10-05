// Repository：セッションの DB へのアクセスはこの層に閉じ込める（C-03）。Service は、このファイルの型だけを知る。
import { eq } from "drizzle-orm";
import { sessions, users } from "../../db/auth-schema";
import type { Database } from "./database";

export type SessionRecord = {
  /** 識別子のハッシュ（生の識別子は保存しない） */
  idHash: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
};

export type SessionUser = { id: string; email: string };

export type SessionRepository = {
  insert(record: SessionRecord): Promise<void>;
  /** セッションと、その利用者。なければ undefined */
  findWithUser(
    idHash: string,
  ): Promise<{ session: SessionRecord; user: SessionUser } | undefined>;
  /** 最後に使った時刻を更新する */
  touch(idHash: string, lastSeenAt: Date): Promise<void>;
  delete(idHash: string): Promise<void>;
  /** 利用者のすべてのセッションを消す（パスワードの変更・再設定などで使う） */
  deleteAllForUser(userId: string): Promise<void>;
};

export function createSessionRepository(db: Database): SessionRepository {
  return {
    async insert(record) {
      await db.insert(sessions).values(record);
    },
    async findWithUser(idHash) {
      const [row] = await db
        .select({
          session: {
            idHash: sessions.idHash,
            userId: sessions.userId,
            createdAt: sessions.createdAt,
            lastSeenAt: sessions.lastSeenAt,
            expiresAt: sessions.expiresAt,
          },
          user: { id: users.id, email: users.email },
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.idHash, idHash))
        .limit(1);
      return row;
    },
    async touch(idHash, lastSeenAt) {
      await db
        .update(sessions)
        .set({ lastSeenAt })
        .where(eq(sessions.idHash, idHash));
    },
    async delete(idHash) {
      await db.delete(sessions).where(eq(sessions.idHash, idHash));
    },
    async deleteAllForUser(userId) {
      await db.delete(sessions).where(eq(sessions.userId, userId));
    },
  };
}

/**
 * Repository を使う間だけ DB につなぐ。
 * 接続のファイル（database）は、使うときに初めて読み込む（理由は sample-user.repository.ts と同じ）
 */
export async function withSessions<T>(
  env: Env,
  run: (repository: SessionRepository) => Promise<T>,
): Promise<T> {
  const { withDatabase } = await import("./database");
  return withDatabase(env, (db) => run(createSessionRepository(db)));
}
