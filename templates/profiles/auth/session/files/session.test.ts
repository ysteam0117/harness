import { describe, expect, it } from "vitest";
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  generateSessionId,
  hashSessionId,
  readSessionId,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  sessionCookieName,
} from "./session";

// このテストの中だけで使う、毎回生成する値（実際の秘密情報は使わない）
const secret = () => crypto.randomUUID();

describe("セッションの識別子", () => {
  it("32 バイトの乱数を base64url にした 43 文字で、毎回違う値になる", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateSessionId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("hashSessionId（HMAC-SHA-256）", () => {
  it("同じ識別子と鍵なら同じ値（64 文字の 16 進数）で、識別子そのものを含まない", async () => {
    const key = secret();
    const id = generateSessionId();
    const hash = await hashSessionId(id, key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSessionId(id, key)).toBe(hash);
    expect(hash).not.toContain(id);
  });

  it("鍵が違えば別の値になる（鍵を変えると、古いセッションは使えなくなる）", async () => {
    const id = generateSessionId();
    expect(await hashSessionId(id, secret())).not.toBe(
      await hashSessionId(id, secret()),
    );
  });

  it("識別子が1文字でも違えば別の値になる", async () => {
    const key = secret();
    const id = generateSessionId();
    const changed = `${id.slice(0, -1)}${id.endsWith("A") ? "B" : "A"}`;
    expect(await hashSessionId(changed, key)).not.toBe(
      await hashSessionId(id, key),
    );
  });
});

describe("Cookie の名前と属性", () => {
  it("本番は __Host-session で、Secure・HttpOnly・SameSite=Lax・Path=/ を付け、Domain は付けない", () => {
    const cookie = serializeSessionCookie("abc", {
      production: true,
      maxAgeSeconds: 60,
    });
    expect(sessionCookieName(true)).toBe("__Host-session");
    expect(cookie.startsWith("__Host-session=abc;")).toBe(true);
    for (const attribute of [
      "Secure",
      "HttpOnly",
      "SameSite=Lax",
      "Path=/",
      "Max-Age=60",
    ]) {
      expect(cookie.split("; ")).toContain(attribute);
    }
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("開発・検証は session で、Secure を付けない（http の手元で動かすため）", () => {
    const cookie = serializeSessionCookie("abc", {
      production: false,
      maxAgeSeconds: 60,
    });
    expect(sessionCookieName(false)).toBe("session");
    expect(cookie.startsWith("session=abc;")).toBe(true);
    expect(cookie.split("; ")).not.toContain("Secure");
    for (const attribute of ["HttpOnly", "SameSite=Lax", "Path=/"]) {
      expect(cookie.split("; ")).toContain(attribute);
    }
  });

  it("消す Cookie は、同じ属性で Max-Age=0 にする", () => {
    for (const production of [true, false]) {
      const cookie = serializeClearedSessionCookie({ production });
      expect(cookie.startsWith(`${sessionCookieName(production)}=;`)).toBe(
        true,
      );
      expect(cookie.split("; ")).toContain("Max-Age=0");
      expect(cookie.split("; ")).toContain("HttpOnly");
      expect(cookie.split("; ")).toContain("Path=/");
      expect(cookie.split("; ").includes("Secure")).toBe(production);
    }
  });
});

describe("readSessionId", () => {
  const id = generateSessionId();

  it("Cookie の中から、自分の名前の値を読む", () => {
    expect(readSessionId(`a=1; session=${id}; b=2`, false)).toBe(id);
    expect(readSessionId(`__Host-session=${id}`, true)).toBe(id);
  });

  it("ない・名前が違う・形が違う（長さ・文字）ときは undefined", () => {
    expect(readSessionId(undefined, false)).toBeUndefined();
    expect(readSessionId("a=1", false)).toBeUndefined();
    expect(readSessionId(`session=${id}`, true)).toBeUndefined();
    expect(readSessionId(`__Host-session=${id}`, false)).toBeUndefined();
    expect(readSessionId("session=short", false)).toBeUndefined();
    expect(readSessionId(`session=${id.slice(0, -1)}!`, false)).toBeUndefined();
  });
});

describe("期限", () => {
  it("絶対の期限は 7 日、アイドルの期限は 24 時間", () => {
    expect(SESSION_ABSOLUTE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(SESSION_IDLE_MS).toBe(24 * 60 * 60 * 1000);
  });
});
