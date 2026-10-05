// 結合のテスト：本物と同じ実行エンジン（workerd）のローカルの D1 に、マイグレーションを適用して、セッションの読み書きを確かめる。
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { generateSessionId, hashSessionId } from "../lib/session";
import { createSessionRepository } from "./session.repository";
import { withDatabase } from "./database";

const USER = { id: "testuser_repo", email: "testuser_repo@example.com" };
const OTHER = {
  id: "testuser_repo_other",
  email: "testuser_repo_other@example.com",
};

afterEach(async () => {
  // このテストが足した行だけを、識別子で消す（C-05）。子の行（sessions）を先に消す
  for (const user of [USER, OTHER]) {
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?")
      .bind(user.id)
      .run();
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
  }
});

async function addUsers() {
  for (const user of [USER, OTHER]) {
    await env.DB.prepare(
      "INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)",
    )
      .bind(user.id, user.email, Date.now())
      .run();
  }
}

async function newRecord(userId: string) {
  const now = new Date();
  return {
    idHash: await hashSessionId(generateSessionId(), crypto.randomUUID()),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
  };
}

const count = async (userId: string) =>
  (
    await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number }>()
  )?.n;

describe("SessionRepository（D1）", () => {
  it("足したセッションを、利用者（id・メール）と一緒に読める。日時は Date で戻る", async () => {
    await addUsers();
    await withDatabase(env, async (db) => {
      const repository = createSessionRepository(db);
      const record = await newRecord(USER.id);
      await repository.insert(record);
      const found = await repository.findWithUser(record.idHash);
      expect(found?.user).toEqual(USER);
      expect(found?.session.idHash).toBe(record.idHash);
      expect(found?.session.expiresAt).toEqual(record.expiresAt);
      expect(await repository.findWithUser("unknown")).toBeUndefined();
    });
  });

  it("最後に使った時刻を更新できる", async () => {
    await addUsers();
    await withDatabase(env, async (db) => {
      const repository = createSessionRepository(db);
      const record = await newRecord(USER.id);
      await repository.insert(record);
      const later = new Date(record.lastSeenAt.getTime() + 5000);
      await repository.touch(record.idHash, later);
      expect(
        (await repository.findWithUser(record.idHash))?.session.lastSeenAt,
      ).toEqual(later);
    });
  });

  it("1件の削除は、そのセッションだけを消す", async () => {
    await addUsers();
    await withDatabase(env, async (db) => {
      const repository = createSessionRepository(db);
      const first = await newRecord(USER.id);
      const second = await newRecord(USER.id);
      await repository.insert(first);
      await repository.insert(second);
      await repository.delete(first.idHash);
      expect(await repository.findWithUser(first.idHash)).toBeUndefined();
      expect(await repository.findWithUser(second.idHash)).toBeDefined();
    });
  });

  it("利用者の全セッションの削除は、その利用者の行だけを消す", async () => {
    await addUsers();
    await withDatabase(env, async (db) => {
      const repository = createSessionRepository(db);
      await repository.insert(await newRecord(USER.id));
      await repository.insert(await newRecord(USER.id));
      await repository.insert(await newRecord(OTHER.id));
      await repository.deleteAllForUser(USER.id);
      expect(await count(USER.id)).toBe(0);
      expect(await count(OTHER.id)).toBe(1);
    });
  });

  it("利用者を消すと、その利用者のセッションも消える（外部キーの連鎖）", async () => {
    await addUsers();
    await withDatabase(env, async (db) => {
      await createSessionRepository(db).insert(await newRecord(USER.id));
    });
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(USER.id).run();
    expect(await count(USER.id)).toBe(0);
  });
});
