// テスト用の、メモリ上の SessionRepository。DB を使わないため、D1・PostgreSQL のどちらの生成物でも同じテストが動く。
import type {
  SessionRecord,
  SessionRepository,
  SessionUser,
} from "../src/db/session.repository";

export type FakeSessionRepository = SessionRepository & {
  /** 保存している行（キーは識別子のハッシュ） */
  sessions: Map<string, SessionRecord>;
};

export function createFakeSessionRepository(
  users: SessionUser[],
): FakeSessionRepository {
  const sessions = new Map<string, SessionRecord>();
  return {
    sessions,
    async insert(record) {
      sessions.set(record.idHash, record);
    },
    async findWithUser(idHash) {
      const session = sessions.get(idHash);
      const user = users.find((u) => u.id === session?.userId);
      return session && user ? { session, user } : undefined;
    },
    async touch(idHash, lastSeenAt) {
      const session = sessions.get(idHash);
      if (session) sessions.set(idHash, { ...session, lastSeenAt });
    },
    async delete(idHash) {
      sessions.delete(idHash);
    },
    async deleteAllForUser(userId) {
      for (const [key, session] of sessions) {
        if (session.userId === userId) sessions.delete(key);
      }
    },
  };
}
