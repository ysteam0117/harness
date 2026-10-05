// Service：セッションの作成・検証・削除。HTTP（Hono）も DB のライブラリも知らない（C-03）。
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  generateSessionId,
  hashSessionId,
} from "../lib/session";
import type { SessionRepository, SessionUser } from "../db/session.repository";

/** Repository を使う間だけ DB につなぐ処理。Workers の入口（index.ts）が本物を渡し、テストが差し替える */
export type WithSessions = <T>(
  env: Env,
  run: (repository: SessionRepository) => Promise<T>,
) => Promise<T>;

/** 最後に使った時刻の更新は、これより短い間隔では書かない（書き込みを減らす） */
const TOUCH_INTERVAL_MS = 60 * 1000;

export type SessionService = {
  /** セッションを作る。識別子（Cookie に入れる値）は、ここで1度だけ返す */
  create(userId: string): Promise<{ id: string; expiresAt: Date }>;
  /** 有効なら利用者を返す。ない・期限切れ（絶対・アイドル）は undefined（期限切れの行は消す） */
  verify(id: string): Promise<SessionUser | undefined>;
  /** そのセッションを消す。なくてもエラーにしない */
  destroy(id: string): Promise<void>;
  /** 利用者のすべてのセッションを消す */
  destroyAllForUser(userId: string): Promise<void>;
};

export function createSessionService(
  repository: SessionRepository,
  options: { secret: string; now?: () => Date },
): SessionService {
  const now = options.now ?? (() => new Date());
  return {
    async create(userId) {
      const id = generateSessionId();
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + SESSION_ABSOLUTE_MS);
      await repository.insert({
        idHash: await hashSessionId(id, options.secret),
        userId,
        createdAt,
        lastSeenAt: createdAt,
        expiresAt,
      });
      return { id, expiresAt };
    },
    async verify(id) {
      const idHash = await hashSessionId(id, options.secret);
      const found = await repository.findWithUser(idHash);
      if (found === undefined) return undefined;
      const current = now().getTime();
      const { session, user } = found;
      const idleLimit = session.lastSeenAt.getTime() + SESSION_IDLE_MS;
      if (current >= session.expiresAt.getTime() || current >= idleLimit) {
        await repository.delete(idHash);
        return undefined;
      }
      if (current - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
        await repository.touch(idHash, new Date(current));
      }
      return user;
    },
    async destroy(id) {
      await repository.delete(await hashSessionId(id, options.secret));
    },
    async destroyAllForUser(userId) {
      await repository.deleteAllForUser(userId);
    },
  };
}
