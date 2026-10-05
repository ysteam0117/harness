// #73 認証：共通のセッションと認可（auth/session）の生成。認証ありで出るファイル・認証なしで出ないこと（AC-2）・依存を足さないこと。
// 生成したプロジェクトの中のテスト（AC-1）は、生成物の npm run check と smoke:generated が実際に動かして確かめる。
import { describe, expect, it } from "vitest";
import { buildProject, type ProjectFile } from "../../src/generate/project.js";
import { contentOf, pathsOf, projectInput } from "./project-helpers.js";

async function generate(over: Record<string, unknown>): Promise<ProjectFile[]> {
  return buildProject(await projectInput(over)).files;
}

type Combo = { auth: "app" | "oidc" | "both"; database: "d1" | "postgresql" };

const COMBOS: Combo[] = (["app", "oidc", "both"] as const).flatMap((auth) =>
  (["d1", "postgresql"] as const).map((database) => ({ auth, database })),
);

const over = (c: Combo): Record<string, unknown> => ({
  auth: c.auth,
  idp: c.auth === "app" ? undefined : "google",
  database: c.database,
  ...(c.database === "postgresql" ? { postgres_provider: "neon" } : {}),
});

const NONE = { auth: "none", idp: undefined, database: "d1" };

/** 認証ありの出力に、DB の種類に関係なく出るもの */
const COMMON_FILES = [
  "backend/db/auth-schema.ts",
  "backend/db/migrations/0001_auth.sql",
  "backend/db/migrations/meta/0001_snapshot.json",
  "backend/db/migrations/meta/_journal.json",
  "backend/src/lib/session.ts",
  "backend/src/lib/session.test.ts",
  "backend/src/lib/auth-config.ts",
  "backend/src/lib/auth-config.test.ts",
  "backend/src/lib/auth-middleware.ts",
  "backend/src/lib/auth-middleware.test.ts",
  "backend/src/services/session.service.ts",
  "backend/src/services/session.service.test.ts",
  "backend/src/db/session.repository.ts",
  "backend/src/routes/auth-session.ts",
  "backend/src/routes/auth-session.test.ts",
  "backend/test/fake-session-repository.ts",
  "backend/test/auth-test-app.ts",
  "frontend/src/features/auth/api/auth.ts",
  "frontend/src/features/auth/useMe.ts",
  "frontend/src/features/auth/AuthGuard.tsx",
  "frontend/src/features/auth/AuthGuard.test.tsx",
  "frontend/src/features/auth/LogoutButton.tsx",
  "frontend/src/features/auth/LogoutButton.test.tsx",
  "frontend/src/features/auth/AccountInfo.tsx",
  "frontend/src/pages/LoginRequiredPage.tsx",
  "frontend/src/pages/AccountPage.tsx",
  "e2e/auth-session.spec.ts",
  ".claude/skills/auth-session/SKILL.md",
];

/** D1 のときだけ出す（本物の D1 に対する結合のテスト。PostgreSQL は pg を workerd のテストで読めないため、smoke が実際の DB で確かめる） */
const D1_ONLY_FILES = [
  "backend/src/db/session.repository.test.ts",
  "backend/src/routes/auth-session.d1.test.ts",
];

describe("#73 認証ありで、共通のセッション・認可のファイルが出る", () => {
  it.each(COMBOS)("#73 AC-1: auth=$auth・db=$database で出る", async (c) => {
    const paths = pathsOf(await generate(over(c)));
    for (const file of COMMON_FILES) expect(paths, file).toContain(file);
    for (const file of D1_ONLY_FILES) {
      if (c.database === "d1") expect(paths, file).toContain(file);
      else expect(paths, file).not.toContain(file);
    }
  });

  it.each(COMBOS)("#73: auth=$auth・db=$database は、出力先の重なりがない", async (c) => {
    const paths = pathsOf(await generate(over(c)));
    expect(new Set(paths.map((p) => p.toLowerCase())).size).toBe(paths.length);
  });
});

describe("#73 AC-2: 認証が none のときは、何も生成しない", () => {
  it("#73 AC-2: auth の files・Skill・認証のスキーマ・マイグレーションが出ない", async () => {
    const paths = pathsOf(await generate(NONE));
    for (const file of [...COMMON_FILES, ...D1_ONLY_FILES]) {
      // 認証なしでも出る共通のファイル（meta/_journal.json）は、中身が変わらないことを下で確かめる
      if (file === "backend/db/migrations/meta/_journal.json") continue;
      expect(paths, file).not.toContain(file);
    }
    expect(paths.filter((p) => /auth/i.test(p))).toEqual([]);
  });

  it("#73 AC-2: 認証なしの index.ts・App.tsx・drizzle.config.ts・cleanup.sql は、認証の記述を含まない", async () => {
    const files = await generate(NONE);
    expect(contentOf(files, "backend/src/index.ts")).not.toMatch(/auth|session/i);
    expect(contentOf(files, "frontend/src/App.tsx")).not.toMatch(/auth|login/i);
    expect(contentOf(files, "drizzle.config.ts")).not.toContain("auth-schema");
    expect(contentOf(files, "backend/db/seeds/cleanup.sql")).not.toMatch(/FROM (users|sessions)\b/);
    const journal = JSON.parse(contentOf(files, "backend/db/migrations/meta/_journal.json")) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.map((e) => e.tag)).toEqual(["0000_init"]);
  });
});

describe("#73 DB：認証の表とマイグレーション（D1・PostgreSQL 共通の構成）", () => {
  const TABLES = [
    "users",
    "user_identities",
    "sessions",
    "password_reset_tokens",
    "login_attempts",
    "oidc_states",
  ];

  it.each(["d1", "postgresql"] as const)(
    "#73: %s は、6つの表を作る 0001_auth.sql と、0000・0001 を含む journal・snapshot を出す",
    async (database) => {
      const files = await generate(over({ auth: "oidc", database }));
      const sql = contentOf(files, "backend/db/migrations/0001_auth.sql");
      for (const table of TABLES) expect(sql, table).toMatch(new RegExp(`CREATE TABLE .${table}.`));
      // セッションは識別子のハッシュだけを持つ（生の識別子の列はない）
      expect(sql).toMatch(/id_hash/);
      expect(sql).not.toMatch(/session_id|raw_id/);
      const journal = JSON.parse(contentOf(files, "backend/db/migrations/meta/_journal.json")) as {
        entries: { idx: number; tag: string }[];
      };
      expect(journal.entries.map((e) => e.tag)).toEqual(["0000_init", "0001_auth"]);
      const snapshot = JSON.parse(
        contentOf(files, "backend/db/migrations/meta/0001_snapshot.json"),
      ) as { tables: Record<string, unknown> };
      // PostgreSQL の snapshot は、表の名前に public. が付く
      const names = Object.keys(snapshot.tables).map((t) => t.replace(/^public./, ""));
      expect(names.sort()).toEqual([...TABLES, "sample_users"].sort());
      // 0000 は共通のまま
      expect(pathsOf(files)).toContain("backend/db/migrations/0000_init.sql");
      expect(pathsOf(files)).toContain("backend/db/migrations/meta/0000_snapshot.json");
    },
  );

  it.each(["d1", "postgresql"] as const)(
    "#73: %s の drizzle.config.ts は、アプリの表と認証の表の両方をスキーマにする",
    async (database) => {
      const config = contentOf(
        await generate(over({ auth: "app", database })),
        "drizzle.config.ts",
      );
      expect(config).toContain("./backend/db/schema.ts");
      expect(config).toContain("./backend/db/auth-schema.ts");
    },
  );

  it.each(["d1", "postgresql"] as const)(
    "#73: %s のスキーマは、外部キーが users に向かい、削除で連鎖する。日時は Date で読み書きする",
    async (database) => {
      const schema = contentOf(
        await generate(over({ auth: "app", database })),
        "backend/db/auth-schema.ts",
      );
      expect(
        schema.match(/references\(\(\) => users\.id, \{ onDelete: "cascade" \}\)/g),
      ).toHaveLength(3);
      expect(schema).toMatch(/primaryKey\(\{ columns: \[table\.issuer, table\.subject\] \}\)/);
      expect(schema).toContain('idHash: text("id_hash").primaryKey()');
    },
  );

  it.each(["d1", "postgresql"] as const)(
    "#73: %s の cleanup.sql は、users・sessions などの testuser_・e2euser_ の行だけを消し、残りの件数を確かめる",
    async (database) => {
      const cleanup = contentOf(
        await generate(over({ auth: "oidc", database })),
        "backend/db/seeds/cleanup.sql",
      );
      for (const table of ["sessions", "password_reset_tokens", "user_identities", "users"]) {
        expect(cleanup, table).toMatch(new RegExp(`DELETE FROM ${table} `));
      }
      expect(cleanup).toContain("testuser!_%");
      expect(cleanup).toContain("e2euser!_%");
      // 識別子で絞らない全件の削除はない（WHERE のない DELETE）
      expect(cleanup).not.toMatch(/DELETE FROM \w+\s*;/);
      expect(cleanup).toMatch(/SELECT COUNT\(\*\) AS remaining_users FROM users/);
      expect(cleanup).toMatch(/SELECT COUNT\(\*\) AS remaining FROM sample_users/);
    },
  );

  it("#73: seed.sql は認証の有無で変わらない（認証の表のテストデータは、テストの中で作る）", async () => {
    const none = contentOf(await generate(NONE), "backend/db/seeds/seed.sql");
    const auth = contentOf(
      await generate(over({ auth: "app", database: "d1" })),
      "backend/db/seeds/seed.sql",
    );
    expect(auth).toBe(none);
  });
});

describe("#73 バックエンドの組み立て", () => {
  it("#73 R1: index.ts は authRoutes を routes の先頭に置き、sample-users はその後ろ（許可リストで公開）", async () => {
    const index = contentOf(await generate(over(COMBOS[0] as Combo)), "backend/src/index.ts");
    expect(index.indexOf("...authRoutes(withSessions)")).toBeGreaterThan(-1);
    expect(index.indexOf("...authRoutes(withSessions)")).toBeLessThan(
      index.indexOf("sampleUserRoutes("),
    );
  });

  it("#73 R1: 許可リストは、sample-users を理由つきで公開する（保護しない）", async () => {
    const mw = contentOf(
      await generate(over(COMBOS[0] as Combo)),
      "backend/src/lib/auth-middleware.ts",
    );
    expect(mw).toContain('path: "/api/health"');
    expect(mw).toContain('path: "/api/sample-users"');
    expect(mw).toContain("動作確認の見本。実際の業務の API は requireAuth で保護する");
  });

  it("#73 R3: SESSION_SECRET は認証ありの auth-config.ts だけが読む。共通の config.ts は変わらない", async () => {
    const files = await generate(over(COMBOS[0] as Combo));
    expect(contentOf(files, "backend/src/lib/auth-config.ts")).toContain("SESSION_SECRET");
    expect(contentOf(files, "backend/src/config.ts")).not.toContain("SESSION_SECRET");
    const none = await generate(NONE);
    expect(contentOf(files, "backend/src/config.ts")).toBe(
      contentOf(none, "backend/src/config.ts"),
    );
  });

  it("#73 R4・R5: 保護する API の 401 にも Cache-Control: no-store を付ける（例外のときも付く形）", async () => {
    const mw = contentOf(
      await generate(over(COMBOS[0] as Combo)),
      "backend/src/lib/auth-middleware.ts",
    );
    expect(mw).toMatch(/finally \{\s*c\.header\("Cache-Control", "no-store"\);/);
  });

  it("#73: 層の向き（C-03）。routes は db を、services は Hono を読み込まない", async () => {
    const files = await generate(over(COMBOS[0] as Combo));
    const importsOf = (p: string) =>
      [...contentOf(files, p).matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1] as string);
    expect(
      importsOf("backend/src/routes/auth-session.ts").filter((s) => s.includes("/db/")),
    ).toEqual([]);
    expect(
      importsOf("backend/src/services/session.service.ts").filter((s) => s.startsWith("hono")),
    ).toEqual([]);
  });
});

describe("#73 依存と秘密情報", () => {
  it("#73: 新しい npm の依存を足さない（認証ありの dependencies・devDependencies は、認証なしと同じ）", async () => {
    const pkg = async (o: Record<string, unknown>) =>
      JSON.parse(contentOf(await generate(o), "package.json")) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
    const none = await pkg(NONE);
    for (const c of COMBOS.filter((x) => x.database === "d1")) {
      const auth = await pkg(over(c));
      expect(Object.keys(auth.dependencies).sort()).toEqual(Object.keys(none.dependencies).sort());
      expect(Object.keys(auth.devDependencies).sort()).toEqual(
        Object.keys(none.devDependencies).sort(),
      );
    }
  });

  it("#73: 生成した認証のファイルに、秘密情報の実値・実在しうるメールアドレスがない。テストの利用者は架空の接頭辞", async () => {
    const files = await generate(over(COMBOS[0] as Combo));
    const authFiles = files.filter((f) => COMMON_FILES.concat(D1_ONLY_FILES).includes(f.path));
    expect(authFiles.length).toBeGreaterThan(20);
    for (const f of authFiles) {
      // SESSION_SECRET に文字列のリテラルを代入していない（テストは、実行のたびに生成する値を使う）
      expect(f.content, f.path).not.toMatch(/SESSION_SECRET["']?\s*[:=]\s*["'`][^"'`]+["'`]/);
      for (const m of f.content.matchAll(/[\w.+-]+@([\w-]+\.)+[A-Za-z]{2,}/g)) {
        expect(m[0], `${f.path} のメールアドレス`).toMatch(/^(testuser|e2euser)_\w+@example\.com$/);
      }
    }
    expect(contentOf(files, ".env.example")).toMatch(/^SESSION_SECRET=$/m);
  });
});

describe("#73 Skill（auth-session）", () => {
  it("#73: セッション・認可・ログアウトの範囲・トークン方式を使わない理由・使わない表を書く", async () => {
    const skill = contentOf(
      await generate(over(COMBOS[0] as Combo)),
      ".claude/skills/auth-session/SKILL.md",
    );
    for (const phrase of [
      "HMAC-SHA-256",
      "__Host-session",
      "7 日",
      "24 時間",
      "PUBLIC_API_PATHS",
      "既定で拒否",
      "IdP",
      "JWT",
      "C-16",
      "C-17",
      "使わない表は消してよい",
    ]) {
      expect(skill, phrase).toContain(phrase);
    }
    expect(skill).not.toContain("後続の Issue");
  });
});
