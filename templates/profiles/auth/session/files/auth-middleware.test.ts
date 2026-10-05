// 認可（C-13）：認証が要る API は既定で拒否し、公開する API は許可リストで明示する。メモリ上の Repository で、本物の組み立て（createApp・authRoutes）を動かす。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createFakeSessionRepository } from "../../test/fake-session-repository";
import {
  TEST_ORIGIN,
  createAuthTestApp,
  createAuthTestEnv,
  issueCookie,
} from "../../test/auth-test-app";
import { PUBLIC_API_PATHS, PUBLIC_AUTH_API_PATHS } from "./auth-middleware";
import { SESSION_IDLE_MS } from "./session";

const USER = { id: "testuser_mw", email: "testuser_mw@example.com" };

function setup() {
  const repository = createFakeSessionRepository([USER]);
  const env = createAuthTestEnv();
  // 許可リストにない新しいルート（保護されるはず）と、許可リストにあるルート
  const protectedRoute = new Hono<{ Bindings: Env }>().get("/", (c) =>
    c.json({ ok: true }),
  );
  const publicRoute = new Hono<{ Bindings: Env }>().get("/", (c) =>
    c.json({ public: true }),
  );
  const app = createAuthTestApp(repository, [
    { path: "/api/new-feature", app: protectedRoute },
    { path: "/api/sample-users", app: publicRoute },
    { path: "/api/sample-users-private", app: protectedRoute },
  ]);
  const get = (path: string, cookie?: string, over = env) =>
    app.request(path, cookie ? { headers: { Cookie: cookie } } : {}, over);
  return { repository, env, app, get };
}

describe("既定で拒否（C-13）", () => {
  it("許可リストにない新しい API は、Cookie がなければ 401（UNAUTHENTICATED）", async () => {
    const { get } = setup();
    const res = await get("/api/new-feature");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("有効なセッションの Cookie があれば通る", async () => {
    const { get, repository, env } = setup();
    const { cookie } = await issueCookie(repository, env, USER.id);
    const res = await get("/api/new-feature", cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("存在しない API も、未認証は 401（存在の有無を知らせない）", async () => {
    const { get } = setup();
    expect((await get("/api/does-not-exist")).status).toBe(401);
  });

  it("許可リストと似た名前の API（/api/sample-users-private）は保護される", async () => {
    const { get } = setup();
    expect((await get("/api/sample-users-private")).status).toBe(401);
  });

  it("改ざんした Cookie（識別子を1文字変える）は 401", async () => {
    const { get, repository, env } = setup();
    const { id } = await issueCookie(repository, env, USER.id);
    const changed = `${id.slice(0, -1)}${id.endsWith("A") ? "B" : "A"}`;
    expect((await get("/api/new-feature", `session=${changed}`)).status).toBe(
      401,
    );
    expect((await get("/api/new-feature", "session=broken")).status).toBe(401);
    expect((await get("/api/new-feature", "session=")).status).toBe(401);
  });

  it("期限切れ（アイドル・絶対）のセッションは 401", async () => {
    const { get, repository, env } = setup();
    const past = new Date(Date.now() - SESSION_IDLE_MS - 60_000);
    // 作ったのが 24 時間より前なので、アイドルの期限を過ぎている
    const idle = await issueCookie(repository, env, USER.id, () => past);
    expect((await get("/api/new-feature", idle.cookie)).status).toBe(401);
    // 絶対の期限が過去の行を、直接入れる
    const fresh = await issueCookie(repository, env, USER.id);
    for (const [key, row] of repository.sessions) {
      repository.sessions.set(key, {
        ...row,
        expiresAt: new Date(Date.now() - 1),
      });
    }
    expect((await get("/api/new-feature", fresh.cookie)).status).toBe(401);
  });

  it("使えない Cookie（鍵が違う）のときも、拒否の応答は Cookie がないときと同じ形（原因を知らせない）", async () => {
    const { get, repository, env } = setup();
    const { cookie } = await issueCookie(repository, env, USER.id);
    const none = await get("/api/new-feature");
    const wrongKey = await get("/api/new-feature", cookie, createAuthTestEnv());
    expect(wrongKey.status).toBe(401);
    expect(await wrongKey.json()).toEqual(await none.json());
  });

  it("本番の Cookie の名前（__Host-session）は、本番の環境でだけ読む", async () => {
    const { app, repository } = setup();
    const production = createAuthTestEnv({ APP_ENV: "production" });
    const { id } = await issueCookie(repository, production, USER.id);
    const ok = await app.request(
      "/api/new-feature",
      { headers: { Cookie: `__Host-session=${id}` } },
      production,
    );
    expect(ok.status).toBe(200);
    const wrongName = await app.request(
      "/api/new-feature",
      { headers: { Cookie: `session=${id}` } },
      production,
    );
    expect(wrongName.status).toBe(401);
  });
});

describe("公開する API（許可リスト）", () => {
  it("許可リストは、理由つきで明示されている（health・sample-users）", () => {
    expect(PUBLIC_API_PATHS.map((p) => p.path)).toEqual([
      "/api/health",
      "/api/sample-users",
    ]);
    for (const entry of PUBLIC_API_PATHS) expect(entry.reason).not.toBe("");
    expect(
      PUBLIC_API_PATHS.find((p) => p.path === "/api/sample-users")?.reason,
    ).toContain("動作確認の見本");
    // ログインなどの公開の認証 API は、#74・#75 でここに足す
    expect(PUBLIC_AUTH_API_PATHS).toEqual([]);
  });

  it("/api/health と、許可リストの /api/sample-users は、Cookie なしで通る", async () => {
    const { get } = setup();
    expect((await get("/api/health")).status).toBe(200);
    const res = await get("/api/sample-users");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ public: true });
  });
});

describe("Cache-Control: no-store（C-58）", () => {
  it("保護された API は、200 にも 401 にも付く", async () => {
    const { get, repository, env } = setup();
    expect((await get("/api/new-feature")).headers.get("Cache-Control")).toBe(
      "no-store",
    );
    const { cookie } = await issueCookie(repository, env, USER.id);
    expect(
      (await get("/api/new-feature", cookie)).headers.get("Cache-Control"),
    ).toBe("no-store");
  });

  it("許可リストの API には付けない（キャッシュできる公開の応答）", async () => {
    const { get } = setup();
    expect((await get("/api/health")).headers.get("Cache-Control")).not.toBe(
      "no-store",
    );
  });
});

describe("送信元の確認と認証", () => {
  it("状態を変える要求は、送信元（Origin）がなければ 403。許可する送信元なら認証の判定に進む", async () => {
    const { app, env } = setup();
    const noOrigin = await app.request(
      "/api/auth/logout",
      { method: "POST" },
      env,
    );
    expect(noOrigin.status).toBe(403);
    const withOrigin = await app.request(
      "/api/auth/logout",
      { method: "POST", headers: { Origin: TEST_ORIGIN } },
      env,
    );
    expect(withOrigin.status).toBe(401);
  });
});
