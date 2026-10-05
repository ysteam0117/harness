// #73 R2：smoke の、実 DB（D1・PostgreSQL）でのセッションの確認の部品のテスト。
// 実際の DB・サーバーの起動は、npm run smoke:generated（認証ありの通り：d1+oidc・postgresql+app）で行う。
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SMOKE_CASES,
  SMOKE_SESSION_USER,
  buildCountSql,
  buildSessionSeed,
  hashSmokeSessionId,
  parseCount,
  smokeSessionId,
  smokeSessionSecret,
} from "../../scripts/smoke-generated.js";
import {
  generateSessionId,
  hashSessionId,
} from "../../templates/profiles/auth/session/files/session.ts";

const NOW = new Date("2030-01-01T00:00:00.000Z");

describe("#73 R2: 架空の識別子・ハッシュ・SESSION_SECRET", () => {
  it("識別子は、生成物の識別子と同じ形（43 文字の base64url）で固定。番号ごとに違う", () => {
    expect(smokeSessionId(1)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(smokeSessionId(1)).toBe(smokeSessionId(1));
    expect(smokeSessionId(1)).not.toBe(smokeSessionId(2));
    expect(generateSessionId()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(smokeSessionId(1), "base64url").toString()).toContain("smoke-session-0001");
  });

  it("ハッシュは、生成物の hashSessionId（HMAC-SHA-256・16 進数）と同じ値になる", async () => {
    const secret = smokeSessionSecret("test");
    for (const id of [smokeSessionId(1), smokeSessionId(2), generateSessionId()]) {
      expect(hashSmokeSessionId(id, secret)).toBe(await hashSessionId(id, secret));
      expect(hashSmokeSessionId(id, secret)).toBe(
        createHmac("sha256", secret).update(id).digest("hex"),
      );
    }
  });

  it("SESSION_SECRET は、開発と検証で別の架空の値（実際の秘密情報ではない）", () => {
    expect(smokeSessionSecret("test")).not.toBe(smokeSessionSecret("development"));
    expect(smokeSessionSecret("test")).toMatch(/^dummy_smoke_test_/);
    // 生成物の最小の長さ（16 文字）を満たす
    expect(smokeSessionSecret("test").length).toBeGreaterThanOrEqual(16);
  });
});

describe("#73 R2: 実 DB に入れる行の SQL", () => {
  const secret = smokeSessionSecret("test");

  it.each(["d1", "postgresql"] as const)(
    "%s：利用者は e2euser_・架空のメール。ハッシュだけを入れ、生の識別子は入れない",
    (database) => {
      const seed = buildSessionSeed(database, NOW, secret);
      expect(SMOKE_SESSION_USER.id.startsWith("e2euser_")).toBe(true);
      expect(SMOKE_SESSION_USER.email).toMatch(/^e2euser_\w+@example\.com$/);
      expect(seed.sql).toContain(SMOKE_SESSION_USER.id);
      expect(seed.sql).toContain(seed.valid.hash);
      expect(seed.sql).toContain(seed.expired.hash);
      expect(seed.sql).not.toContain(seed.valid.id);
      expect(seed.sql).not.toContain(seed.expired.id);
      expect(seed.sql).not.toContain(secret);
      expect(seed.valid.hash).toBe(hashSmokeSessionId(seed.valid.id, secret));
    },
  );

  it("D1 は日時をミリ秒の整数で、PostgreSQL は to_timestamp で書く。期限切れは過去、有効は未来", () => {
    const d1 = buildSessionSeed("d1", NOW, secret).sql;
    const pg = buildSessionSeed("postgresql", NOW, secret).sql;
    expect(d1).toContain(`${String(NOW.getTime())}`);
    expect(d1).not.toContain("to_timestamp");
    expect(pg).toContain("to_timestamp(");
    // 行の並び：有効（期限が未来）→ 期限切れ（期限が過去）
    const rows = d1.split("\n").filter((l) => l.startsWith("('"));
    const expiresAt = rows.map((r) => Number(/(\d+)\)[,;]$/.exec(r)?.[1]));
    expect(expiresAt[0]).toBeGreaterThan(NOW.getTime());
    expect(expiresAt[1]).toBeLessThan(NOW.getTime());
  });

  it("利用者の挿入は、何回流しても同じ結果になる（すでにあれば何もしない）", () => {
    for (const database of ["d1", "postgresql"] as const) {
      expect(buildSessionSeed(database, NOW, secret).sql).toContain("ON CONFLICT (id) DO NOTHING");
    }
  });
});

describe("#73 R2: 件数の SQL と、出力の読み取り", () => {
  it("buildCountSql は、alias の名前で数える SELECT を作る", () => {
    expect(buildCountSql("sessions", "id_hash = 'abc'", "session_rows")).toBe(
      "SELECT COUNT(*) AS session_rows FROM sessions WHERE id_hash = 'abc';\n",
    );
  });

  it("parseCount は、wrangler（JSON・表）・psql の出力から件数を読む", () => {
    expect(parseCount('[{"results":[{"session_rows": 3}],"success":true}]', "session_rows")).toBe(
      3,
    );
    expect(parseCount("│ session_rows │\n├──────────────┤\n│ 0            │", "session_rows")).toBe(
      0,
    );
    expect(
      parseCount(" session_rows \n--------------\n            1\n(1 row)\n", "session_rows"),
    ).toBe(1);
  });

  it("parseCount は、読めないときに、エラーにする（0 件とみなさない）", () => {
    expect(() => parseCount("エラーです", "session_rows")).toThrow("session_rows");
  });
});

describe("#73 R2: 認証ありの通り", () => {
  it("d1（oidc）・postgresql（app）が認証あり、none は認証なし（実 DB のセッションの確認は、認証ありの2通りだけ）", () => {
    const authenticated = SMOKE_CASES.filter((c) => c.auth !== "none").map(
      (c) => `${c.id}:${c.auth}`,
    );
    expect(authenticated).toEqual(["d1:oidc", "postgresql:app"]);
  });
});
