// 結合のテスト：本物と同じ実行エンジン（workerd）のローカルの D1 に対して、API（/api/auth/*）を通して確かめる（AC-1）。
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { hashSessionId, generateSessionId } from "../lib/session";
import app from "../index";

const USER = {
  id: "testuser_d1_route",
  email: "e2euser_session_001@example.com",
};
const ORIGIN = "http://localhost:5173";
// このテストの中だけで使う、毎回生成する値（実際の秘密情報は使わない）
const SECRET = crypto.randomUUID();
const testEnv = { ...env, SESSION_SECRET: SECRET, ALLOWED_ORIGINS: ORIGIN };
const COOKIE_NAME = "session"; // 検証・開発の環境（APP_ENV が production 以外）

afterEach(async () => {
  // このテストが足した行だけを、識別子で消す（C-05）。子の行（sessions）を先に消す
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?")
    .bind(USER.id)
    .run();
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(USER.id).run();
});

/** DB に直接、利用者とセッションの行を入れ、その Cookie を返す。expiresAt は期限（ミリ秒） */
async function seedSession(expiresAt: number): Promise<string> {
  const id = generateSessionId();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)",
  )
    .bind(USER.id, USER.email, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(await hashSessionId(id, SECRET), USER.id, now, now, expiresAt)
    .run();
  return `${COOKIE_NAME}=${id}`;
}

const me = (cookie: string) =>
  app.request("/api/auth/me", { headers: { Cookie: cookie } }, testEnv);
const logout = (cookie: string) =>
  app.request(
    "/api/auth/logout",
    { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN } },
    testEnv,
  );
const sessionCount = async () =>
  (
    await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?")
      .bind(USER.id)
      .first<{ n: number }>()
  )?.n;

describe("/api/auth（D1）", () => {
  it("未認証の保護 API は 401。公開の API（/api/health）は通る", async () => {
    const res = await app.request("/api/auth/me", {}, testEnv);
    expect(res.status).toBe(401);
    expect((await app.request("/api/health", {}, testEnv)).status).toBe(200);
  });

  it("有効なセッションは /me が 200。期限切れ・改ざんは 401", async () => {
    const valid = await seedSession(Date.now() + 60 * 60 * 1000);
    const ok = await me(valid);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ id: USER.id, email: USER.email });

    const tampered = `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`;
    expect((await me(tampered)).status).toBe(401);

    const expired = await seedSession(Date.now() - 1000);
    expect((await me(expired)).status).toBe(401);
  });

  it("ログアウトで DB の行が消え、同じ Cookie は 401 になる", async () => {
    const cookie = await seedSession(Date.now() + 60 * 60 * 1000);
    expect(await sessionCount()).toBe(1);
    expect((await logout(cookie)).status).toBe(204);
    expect(await sessionCount()).toBe(0);
    expect((await me(cookie)).status).toBe(401);
  });

  it("DB に生の識別子はなく、ハッシュだけが入っている", async () => {
    const cookie = await seedSession(Date.now() + 60 * 60 * 1000);
    const id = cookie.slice(COOKIE_NAME.length + 1);
    const rows = await env.DB.prepare(
      "SELECT * FROM sessions WHERE user_id = ?",
    )
      .bind(USER.id)
      .all();
    expect(JSON.stringify(rows.results)).not.toContain(id);
    expect(JSON.stringify(rows.results)).toContain(
      await hashSessionId(id, SECRET),
    );
  });
});
