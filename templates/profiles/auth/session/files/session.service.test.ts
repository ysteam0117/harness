import { beforeEach, describe, expect, it } from "vitest";
import { createFakeSessionRepository } from "../../test/fake-session-repository";
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  hashSessionId,
} from "../lib/session";
import { createSessionService } from "./session.service";

const HOUR = 60 * 60 * 1000;
const USER_A = { id: "testuser_a", email: "testuser_a@example.com" };
const USER_B = { id: "testuser_b", email: "testuser_b@example.com" };

// 時計を差し替える（テストの中で、進めたい分だけ進める）
function setup() {
  const secret = crypto.randomUUID();
  const repository = createFakeSessionRepository([USER_A, USER_B]);
  let now = new Date("2030-01-01T00:00:00.000Z");
  const service = createSessionService(repository, {
    secret,
    now: () => now,
  });
  return {
    secret,
    repository,
    service,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    now: () => now,
  };
}

describe("session.service", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("作成：識別子を返し、保存するのはハッシュだけ（生の識別子は残らない）", async () => {
    const issued = await t.service.create(USER_A.id);
    expect(issued.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([...t.repository.sessions.keys()]).toEqual([
      await hashSessionId(issued.id, t.secret),
    ]);
    expect(JSON.stringify([...t.repository.sessions.values()])).not.toContain(
      issued.id,
    );
  });

  it("作成：絶対の期限は 7 日後", async () => {
    const issued = await t.service.create(USER_A.id);
    expect(issued.expiresAt.getTime()).toBe(
      t.now().getTime() + SESSION_ABSOLUTE_MS,
    );
  });

  it("検証：有効なセッションは、利用者（id・メール）を返す", async () => {
    const { id } = await t.service.create(USER_A.id);
    expect(await t.service.verify(id)).toEqual(USER_A);
  });

  it("検証：知らない識別子・1文字違う識別子（改ざん）は、利用者を返さない", async () => {
    const { id } = await t.service.create(USER_A.id);
    const changed = `${id.slice(0, -1)}${id.endsWith("A") ? "B" : "A"}`;
    expect(await t.service.verify(changed)).toBeUndefined();
    expect(await t.service.verify("x".repeat(43))).toBeUndefined();
  });

  it("検証：鍵（SESSION_SECRET）が変わると、古いセッションは使えない", async () => {
    const { id } = await t.service.create(USER_A.id);
    const other = createSessionService(t.repository, {
      secret: crypto.randomUUID(),
      now: t.now,
    });
    expect(await other.verify(id)).toBeUndefined();
  });

  it("検証：絶対の期限（7 日）を過ぎると使えず、行も消える", async () => {
    const { id } = await t.service.create(USER_A.id);
    // アイドルの期限に掛からないよう、12 時間ごとに使い続ける（6 日半まで）
    for (let step = 1; step <= 13; step += 1) {
      t.advance(12 * HOUR);
      expect(await t.service.verify(id)).toEqual(USER_A);
    }
    // 7 日ちょうど（最後に使ってから 12 時間）。アイドルではなく、絶対の期限で切れる
    t.advance(12 * HOUR);
    expect(await t.service.verify(id)).toBeUndefined();
    expect(t.repository.sessions.size).toBe(0);
  });

  it("検証：アイドルの期限（24 時間）を過ぎると使えず、行も消える", async () => {
    const { id } = await t.service.create(USER_A.id);
    t.advance(SESSION_IDLE_MS);
    expect(await t.service.verify(id)).toBeUndefined();
    expect(t.repository.sessions.size).toBe(0);
  });

  it("検証：アイドルの期限の手前で使えば、最後に使った時刻が更新され、期限が延びる", async () => {
    const { id } = await t.service.create(USER_A.id);
    t.advance(23 * HOUR);
    expect(await t.service.verify(id)).toEqual(USER_A);
    const [row] = [...t.repository.sessions.values()];
    expect(row?.lastSeenAt.getTime()).toBe(t.now().getTime());
    t.advance(23 * HOUR);
    expect(await t.service.verify(id)).toEqual(USER_A);
  });

  it("検証：直前に更新したばかりのときは、書き込まない（書き込みを減らす）", async () => {
    const { id } = await t.service.create(USER_A.id);
    const before = [...t.repository.sessions.values()][0]?.lastSeenAt;
    t.advance(1000);
    await t.service.verify(id);
    expect([...t.repository.sessions.values()][0]?.lastSeenAt).toEqual(before);
  });

  it("削除：そのセッションだけが使えなくなる。ないセッションの削除はエラーにならない", async () => {
    const first = await t.service.create(USER_A.id);
    const second = await t.service.create(USER_A.id);
    await t.service.destroy(first.id);
    expect(await t.service.verify(first.id)).toBeUndefined();
    expect(await t.service.verify(second.id)).toEqual(USER_A);
    await expect(t.service.destroy(first.id)).resolves.toBeUndefined();
  });

  it("利用者の全セッションの削除：その利用者のものだけが消える", async () => {
    const a1 = await t.service.create(USER_A.id);
    const a2 = await t.service.create(USER_A.id);
    const b1 = await t.service.create(USER_B.id);
    await t.service.destroyAllForUser(USER_A.id);
    expect(await t.service.verify(a1.id)).toBeUndefined();
    expect(await t.service.verify(a2.id)).toBeUndefined();
    expect(await t.service.verify(b1.id)).toEqual(USER_B);
  });
});
