// GET /api/auth/me・POST /api/auth/logout（メモリ上の Repository）。
import { describe, expect, it } from "vitest";
import { createFakeSessionRepository } from "../../test/fake-session-repository";
import {
  TEST_ORIGIN,
  createAuthTestApp,
  createAuthTestEnv,
  issueCookie,
} from "../../test/auth-test-app";

const USER = { id: "testuser_me", email: "e2euser_session_001@example.com" };
const OTHER = { id: "testuser_other", email: "testuser_other@example.com" };

function setup(envOver: Record<string, string> = {}) {
  const repository = createFakeSessionRepository([USER, OTHER]);
  const env = createAuthTestEnv(envOver);
  const app = createAuthTestApp(repository);
  const me = (cookie?: string) =>
    app.request(
      "/api/auth/me",
      cookie ? { headers: { Cookie: cookie } } : {},
      env,
    );
  const logout = (cookie?: string, origin: string | null = TEST_ORIGIN) =>
    app.request(
      "/api/auth/logout",
      {
        method: "POST",
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(origin ? { Origin: origin } : {}),
        },
      },
      env,
    );
  return { repository, env, me, logout };
}

describe("GET /api/auth/me", () => {
  it("ログイン中は 200 で、利用者の id とメールだけを返す（ハッシュなどは返さない）", async () => {
    const { me, repository, env } = setup();
    const { cookie } = await issueCookie(repository, env, USER.id);
    const res = await me(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: USER.id, email: USER.email });
  });

  it("未認証は 401。200 にも 401 にも Cache-Control: no-store が付く", async () => {
    const { me, repository, env } = setup();
    const unauthorized = await me();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(unauthorized.headers.get("Cache-Control")).toBe("no-store");
    const { cookie } = await issueCookie(repository, env, USER.id);
    expect((await me(cookie)).headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("POST /api/auth/logout", () => {
  it("204 を返し、DB のセッションの行を消し、Cookie を消す指示（Max-Age=0）を返す", async () => {
    const { logout, repository, env } = setup();
    const { cookie } = await issueCookie(repository, env, USER.id);
    const res = await logout(cookie);
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie.startsWith("session=;")).toBe(true);
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("HttpOnly");
    expect(repository.sessions.size).toBe(0);
  });

  it("ログアウトの後は、同じ Cookie が 401（サーバー側で無効になっている）", async () => {
    const { logout, me, repository, env } = setup();
    const { cookie } = await issueCookie(repository, env, USER.id);
    expect((await me(cookie)).status).toBe(200);
    await logout(cookie);
    expect((await me(cookie)).status).toBe(401);
  });

  it("ほかのセッション（別の端末・別の利用者）には影響しない", async () => {
    const { logout, me, repository, env } = setup();
    const first = await issueCookie(repository, env, USER.id);
    const second = await issueCookie(repository, env, USER.id);
    const other = await issueCookie(repository, env, OTHER.id);
    await logout(first.cookie);
    expect((await me(second.cookie)).status).toBe(200);
    expect((await me(other.cookie)).status).toBe(200);
  });

  it("本番の環境では、Cookie を消す指示も __Host-session・Secure で返す", async () => {
    const { logout, repository, env } = setup({ APP_ENV: "production" });
    const { cookie } = await issueCookie(repository, env, USER.id);
    const res = await logout(cookie);
    expect(res.status).toBe(204);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie.startsWith("__Host-session=;")).toBe(true);
    expect(setCookie.split("; ")).toContain("Secure");
  });

  it("未認証は 401、許可していない送信元は 403（どちらも行は消えない）", async () => {
    const { logout, repository, env } = setup();
    const { cookie } = await issueCookie(repository, env, USER.id);
    expect((await logout()).status).toBe(401);
    expect((await logout(cookie, "https://origin.invalid")).status).toBe(403);
    expect((await logout(cookie, null)).status).toBe(403);
    expect(repository.sessions.size).toBe(1);
  });
});
