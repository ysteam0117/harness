// #56 R(レビュー1)-1・2・5・7：生成するプロジェクトの内容のテスト（コードレビュー1回目の指摘。メモリ上の buildProject の結果）
//
// 新しく想定する仕様（実装の役割はこの形に合わせる）
//   R-1  public/_headers（Cloudflare の静的配信のヘッダー）が常に出る。書き方：
//          /*
//            Content-Security-Policy: default-src 'self'; script-src 'self'; ...
//            X-Content-Type-Options: nosniff
//            ...
//        値は backend/src/lib/security.ts の securityHeaders（Hono の secureHeaders）と同じ：
//        CSP の各項目、Strict-Transport-Security、X-Frame-Options、Referrer-Policy、Permissions-Policy、X-Content-Type-Options: nosniff
//   R-2  backend/db/seeds/cleanup.sql（D1・PostgreSQL）：LIKE の _ を文字どおりに扱う
//        （例：LIKE 'testuser!_%' ESCAPE '!'）。DELETE と、残数の確認の SELECT で同じ条件
//   R-5  例の機能（D1・PostgreSQL の両方）。/api/health/db は使わない（置き換える。database-health のファイルも出さない）
//          backend/src/routes/sample-users.ts          GET /（一覧）・POST /（1件追加。validate を通る）
//          backend/src/services/sample-users.service.ts  Hono を知らない
//          backend/src/db/sample-user.repository.ts    一覧（list）と追加（add）
//          backend/src/index.ts                        /api/sample-users を組み込む。送信元の確認（originCheck）は /api/* の既存のまま
//        D1 のとき、結合テスト（生成物の中のテスト）backend/src/routes/sample-users.test.ts：
//          cloudflare:workers の env（本物のローカルの D1）で、/api/sample-users に
//          正しい入力の追加（成功）・不正な入力の 422・送信元（Origin）の違う要求の 403 を確かめる
//   R-7  README.md（D1 のとき）：Docker の D1 は手元（npm run dev）の D1 とは別のデータであることと、
//        `docker compose exec -T backend npm run db:migrate:local` と `... npm run db:seed:local` の手順
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { contentOf, generated, pathsOf, validCombos, type Combo } from "./skeleton-helpers.js";

const combos = validCombos();
const dbCombos = combos.filter((c) => c.database !== "none");
const d1Combo = combos.find((c) => c.database === "d1" && c.auth === "none" && !c.upload) as Combo;
const pgCombo = combos.find(
  (c) => c.database === "postgresql" && c.auth === "none" && !c.upload,
) as Combo;
const noneCombo = combos.find((c) => c.database === "none" && c.auth === "none") as Combo;

describe("#56 R(レビュー1)-1: 画面の配信にも CSP 等のヘッダーが付く", () => {
  /** _headers の「/*」の下の「名前: 値」 */
  function parseHeaders(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    let inAll = false;
    for (const raw of text.split("\n")) {
      if (/^\S/.test(raw)) {
        inAll = raw.trim() === "/*";
        continue;
      }
      if (!inAll) continue;
      const m = /^\s+([A-Za-z-]+):\s*(.+?)\s*$/.exec(raw);
      if (m) out[m[1] as string] = m[2] as string;
    }
    return out;
  }

  /** security.ts の securityHeaders の設定値 */
  function apiHeaderValues(security: string) {
    const csp = /contentSecurityPolicy:\s*\{([\s\S]*?)\n\s*\},/.exec(security)?.[1] ?? "";
    const directives: string[] = [];
    for (const m of csp.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
      const name = (m[1] as string).replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
      const values = [...(m[2] as string).matchAll(/"([^"]*)"/g)].map((v) => v[1]);
      directives.push([name, ...values].join(" "));
    }
    const str = (key: string) => new RegExp(`${key}:\\s*"([^"]*)"`).exec(security)?.[1] as string;
    return {
      directives,
      hsts: str("strictTransportSecurity"),
      xfo: str("xFrameOptions"),
      referrer: str("referrerPolicy"),
    };
  }

  for (const c of [d1Combo, pgCombo, noneCombo]) {
    it(`#56 R(レビュー1)-1: ${c.label}：public/_headers があり、API の securityHeaders と同じ値が入る`, async () => {
      const files = await generated(c);
      expect(pathsOf(files)).toContain("public/_headers");
      const text = contentOf(files, "public/_headers");
      expect(text.split("\n")[0]?.trim()).toBe("/*");
      const headers = parseHeaders(text);
      const expected = apiHeaderValues(contentOf(files, "backend/src/lib/security.ts"));

      // 値の取り出しそのものが成り立っていること（テストが空振りしないため）
      expect(expected.directives.length).toBeGreaterThanOrEqual(8);
      expect(expected.directives).toContain("default-src 'self'");
      expect(expected.hsts).toMatch(/max-age=/);

      const csp = (headers["Content-Security-Policy"] ?? "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(csp.sort()).toEqual([...expected.directives].sort());
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["Strict-Transport-Security"]).toBe(expected.hsts);
      expect(headers["X-Frame-Options"]).toBe(expected.xfo);
      expect(headers["Referrer-Policy"]).toBe(expected.referrer);
      for (const feature of ["camera=()", "microphone=()", "geolocation=()"]) {
        expect(headers["Permissions-Policy"], feature).toContain(feature);
      }
    });
  }

  it("#56 R(レビュー1)-1: 全ての組み合わせで public/_headers が出る", async () => {
    for (const c of combos) {
      expect(pathsOf(await generated(c)), c.label).toContain("public/_headers");
    }
  });
});

describe("#56 R(レビュー1)-2: 後始末の SQL は、LIKE の _ を文字どおりに扱う", () => {
  for (const c of dbCombos.filter((x) => x.auth === "none" && !x.upload)) {
    it(`#56 R(レビュー1)-2: ${c.label}：cleanup.sql は ESCAPE を使い、DELETE と残数の確認が同じ条件`, async () => {
      const sql = contentOf(await generated(c), "backend/db/seeds/cleanup.sql");
      const likes = [...sql.matchAll(/LIKE\s+'([^']*)'(\s+ESCAPE\s+'(.)')?/gi)];
      expect(likes.length).toBeGreaterThanOrEqual(2); // DELETE と SELECT
      for (const m of likes) {
        expect(m[2], `${m[0]} に ESCAPE がありません`).toBeTruthy();
        const esc = m[3] as string;
        expect(m[1]).toBe(`testuser${esc}_%`);
      }
      expect(new Set(likes.map((m) => m[0])).size).toBe(1);
    });
  }

  it("#56 R(レビュー1)-2: メモリ上の SQLite で、testuser_001 は消え、testuserX001・testuserA は残る。確認の SQL も同じ条件で数える", async () => {
    const files = await generated(d1Combo);
    const migration = contentOf(files, "backend/db/migrations/0000_init.sql");
    const cleanup = contentOf(files, "backend/db/seeds/cleanup.sql");
    const db = new DatabaseSync(":memory:");
    try {
      for (const stmt of migration.split("--> statement-breakpoint")) db.exec(stmt);
      for (const name of [
        "testuser_001",
        "testuser_002",
        "testuserX001",
        "testuserA",
        "realname",
      ]) {
        db.prepare("INSERT INTO sample_users (username) VALUES (?)").run(name);
      }
      const statements = cleanup
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      const del = statements.find((s) => /^DELETE/i.test(s)) as string;
      const count = statements.find((s) => /^SELECT/i.test(s)) as string;
      expect(del).toBeTruthy();
      expect(count).toBeTruthy();

      // 消す前：確認の SQL は、_ を文字どおりに扱って 2 件（testuser_001・testuser_002）だけを数える
      expect((db.prepare(count).get() as { remaining: number }).remaining).toBe(2);
      db.exec(del);
      const left = (
        db.prepare("SELECT username FROM sample_users ORDER BY username").all() as {
          username: string;
        }[]
      ).map((r) => r.username);
      expect(left).toEqual(["realname", "testuserA", "testuserX001"]);
      expect((db.prepare(count).get() as { remaining: number }).remaining).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe("#56 R(レビュー1)-5: 例の機能（サンプルの利用者の一覧・1件追加）", () => {
  for (const c of dbCombos) {
    it(`#56 R(レビュー1)-5: ${c.label}：ルート・サービス・Repository のファイルがある`, async () => {
      const files = await generated(c);
      const paths = pathsOf(files);
      for (const p of [
        "backend/src/routes/sample-users.ts",
        "backend/src/services/sample-users.service.ts",
        "backend/src/db/sample-user.repository.ts",
      ]) {
        expect(paths, p).toContain(p);
      }
      const route = contentOf(files, "backend/src/routes/sample-users.ts");
      expect(route).toContain("validate(");
      expect(route).toMatch(/\.get\(/);
      expect(route).toMatch(/\.post\(/);
      expect(route).toMatch(/services\/sample-users\.service/);
      expect(contentOf(files, "backend/src/services/sample-users.service.ts")).not.toMatch(
        /from\s+["']hono/,
      );
      const entry = contentOf(files, "backend/src/index.ts");
      expect(entry).toContain("/api/sample-users");
      // 送信元の確認は /api/* に掛かっている（POST も通る）
      expect(contentOf(files, "backend/src/app.ts")).toMatch(
        /"\/api\/\*"[\s\S]*originCheck|originCheck[\s\S]*"\/api\/\*"/,
      );
    });

    it(`#56 R(レビュー1)-5: ${c.label}：/api/health/db は使わない（置き換える）`, async () => {
      const files = await generated(c);
      for (const f of files) {
        expect(f.content, f.path).not.toContain("/api/health/db");
        expect(f.path, f.path).not.toMatch(/database-health/);
      }
    });
  }

  it("#56 R(レビュー1)-5: DB なしのときは、サンプルの利用者のファイルを出さない", async () => {
    const files = await generated(noneCombo);
    for (const f of files) {
      expect(f.path, f.path).not.toMatch(/sample-user/);
      expect(f.content, f.path).not.toContain("/api/sample-users");
    }
  });

  it("#56 R(レビュー1)-5: D1：結合テストで、正しい入力の追加・不正な入力の 422・送信元の違う要求の 403 を確かめる", async () => {
    const files = await generated(d1Combo);
    const path = "backend/src/routes/sample-users.test.ts";
    expect(pathsOf(files)).toContain(path);
    const test = contentOf(files, path);
    expect(test).toContain("cloudflare:workers");
    expect(test).toContain("/api/sample-users");
    expect(test).toContain("Origin");
    expect(test).toMatch(/POST/);
    expect(test).toMatch(/\b2(00|01)\b/); // 追加の成功
    expect(test).toMatch(/\b422\b/); // 不正な入力
    expect(test).toMatch(/\b403\b/); // 送信元の違う要求
    // テストデータは架空の識別子で、後始末をする（C-05）
    expect(test).toContain("testuser_");
    expect(test).toMatch(/DELETE FROM sample_users/);
  });
});

describe("#56 R(レビュー2)-2: 例の機能の重複は、Repository の一意制約の違反を CONFLICT（409）にする", () => {
  // 新しく想定する名前：backend/src/db/sample-user.repository.ts が `DuplicateSampleUserError` を export し、
  // add は一意制約の違反のとき、それを投げる。service は一覧（先頭100件）で重複を確かめず、これを CONFLICT にする
  for (const c of dbCombos.filter((x) => x.auth === "none" && !x.upload)) {
    it(`#56 R(レビュー2)-2: ${c.label}：service は一覧で重複を確かめず、Repository の重複の知らせを CONFLICT にする`, async () => {
      const files = await generated(c);
      const service = contentOf(files, "backend/src/services/sample-users.service.ts");
      const add = /export async function addSampleUser[\s\S]*?\n\}/.exec(service)?.[0] ?? "";
      expect(add, "addSampleUser が見つかりません").not.toBe("");
      expect(add).not.toMatch(/\.list\(/);
      expect(add).toContain("DuplicateSampleUserError");
      expect(add).toContain("CONFLICT");
      const repository = contentOf(files, "backend/src/db/sample-user.repository.ts");
      expect(repository).toMatch(/export class DuplicateSampleUserError/);
      expect(repository).toMatch(/throw new DuplicateSampleUserError/);
    });

    it(`#56 R(レビュー2)-2: ${c.label}：service の単体のテストで、Repository が重複を知らせたら CONFLICT になることを確かめる`, async () => {
      const test = contentOf(
        await generated(c),
        "backend/src/services/sample-users.service.test.ts",
      );
      expect(test).toContain("DuplicateSampleUserError");
      expect(test).toContain("CONFLICT");
    });
  }

  it("#56 R(レビュー2)-2: D1：結合テストに、同じ username の2回目の 409 と、101件より多い既存のデータがあっても 409 のケースがある", async () => {
    const test = contentOf(await generated(d1Combo), "backend/src/routes/sample-users.test.ts");
    expect(test).toMatch(/\b409\b/);
    expect(test).toMatch(/2回目/);
    // 一覧の上限（100件）より多いデータを足してから、重複を確かめる
    expect(test).toMatch(/\b10[1-9]\b|\b1[1-9]\d\b|LIST_LIMIT\s*\+\s*1/);
    const conflictCases = test.match(/\b409\b/g) ?? [];
    expect(conflictCases.length).toBeGreaterThanOrEqual(2);
  });
});

describe("#56 R(レビュー1)-7: README に、Docker の D1 の手順がある（D1 のとき）", () => {
  it("#56 R(レビュー1)-7: D1：Docker の D1 は手元と別のデータで、マイグレーションとシードを docker compose exec で行う手順がある", async () => {
    const text = contentOf(await generated(d1Combo), "README.md");
    expect(text).toContain("docker compose exec -T backend npm run db:migrate:local");
    expect(text).toContain("docker compose exec -T backend npm run db:seed:local");
    const mentionsSeparate = text
      .split("\n")
      .some((line) => line.includes("D1") && /別/.test(line) && /Docker|コンテナ/.test(line));
    expect(mentionsSeparate, "Docker の D1 が手元の D1 とは別のデータだと書いてある行").toBe(true);
    // 手順の順番：マイグレーション → シード
    expect(text.indexOf("db:migrate:local")).toBeLessThan(
      text.indexOf("docker compose exec -T backend npm run db:seed:local"),
    );
  });

  it("#56 R(レビュー1)-7: PostgreSQL・DB なしの README には、D1 の手順を書かない", async () => {
    for (const c of [pgCombo, noneCombo]) {
      const text = contentOf(await generated(c), "README.md");
      expect(text, c.label).not.toContain("db:migrate:local");
    }
  });
});
