// #42 AC-1：セキュリティのテストの道具（Semgrep・gitleaks・OSV-Scanner・Dependabot・Schemathesis）の生成。メモリ上（buildProject）だけで確かめる。
// 実際の実行（Docker・npm install・check）は、手動の確認（AC-2・AC-3）と smoke:generated が行う。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { buildProject, isManagedPath, type ProjectFile } from "../../src/generate/project.js";
import { loadProfile } from "../../src/generate/profile.js";
import { contentOf, pathsOf, projectInput } from "./project-helpers.js";
import { realTemplatesDir } from "./helpers.js";

async function generate(over: Record<string, unknown> = {}): Promise<ProjectFile[]> {
  return buildProject(await projectInput(over)).files;
}

const NONE = { database: "none", auth: "none", idp: undefined };
const D1 = { database: "d1", auth: "none", idp: undefined };
const PG = { database: "postgresql", postgres_provider: "neon", auth: "none", idp: undefined };
const D1_AUTH = { database: "d1", auth: "app", idp: undefined };
const PG_AUTH = {
  database: "postgresql",
  postgres_provider: "neon",
  auth: "oidc",
  idp: "google",
};
const LOCAL = {
  repository: "local",
  visibility: "private",
  check_location: "local",
  database: "none",
  auth: "none",
  idp: undefined,
};

const ALL: [string, Record<string, unknown>][] = [
  ["DB なし・認証なし", NONE],
  ["D1・認証なし", D1],
  ["PostgreSQL・認証なし", PG],
  ["D1・認証あり", D1_AUTH],
  ["PostgreSQL・認証あり", PG_AUTH],
];

const profile = loadProfile(realTemplatesDir, "quality/typescript-standard");

const scriptsOf = (files: ProjectFile[]): Record<string, string> =>
  (JSON.parse(contentOf(files, "package.json")) as { scripts: Record<string, string> }).scripts;

describe.each(ALL)("#42 AC-1：%s", (_name, over) => {
  it("check は check:app と security をつなぐ。check:app は Docker を使わない（これまでの check の中身）", async () => {
    const scripts = scriptsOf(await generate(over));
    expect(scripts["check"]).toBe("npm run check:app && npm run security");
    const app = scripts["check:app"] ?? "";
    for (const step of [
      "test:safety",
      "lint",
      "typecheck",
      "format:check",
      "deps:check",
      "dup:check",
      "npm test",
      "audit:prod",
    ]) {
      expect(app, step).toContain(step);
    }
    expect(app).not.toContain("security");
    expect(scripts["security"]).toBe("node scripts/security-check.mjs");
    expect(scripts["security:semgrep"]).toBe("node scripts/security-check.mjs semgrep");
    expect(scripts["security:secrets"]).toBe("node scripts/security-check.mjs secrets");
    expect(scripts["security:osv"]).toBe("node scripts/security-check.mjs osv");
    // npm audit は残す
    expect(scripts["audit:prod"]).toContain("npm audit --omit=dev");
  });

  it("実行のスクリプト・gitleaks の設定・Semgrep のルール・仕様書・手順書が出る", async () => {
    const paths = pathsOf(await generate(over));
    for (const p of [
      "scripts/security-check.mjs",
      ".gitleaks.toml",
      ".semgrep/NOTICE.md",
      "docs/api/openapi.json",
      "docs/testing/security.md",
      "docs/testing/schemathesis.md",
      "backend/src/openapi.test.ts",
    ]) {
      expect(paths, p).toContain(p);
    }
    expect(paths.filter((p) => /^\.semgrep\/.+\.yaml$/.test(p)).length).toBeGreaterThanOrEqual(5);
  });

  it("scripts/security-check.mjs に、固定したイメージ（tag とダイジェスト）が差し込まれ、値の名前が残らない", async () => {
    const script = contentOf(await generate(over), "scripts/security-check.mjs");
    expect(script).not.toMatch(/\{\{[a-z_]+\}\}/);
    for (const tool of ["semgrep", "gitleaks", "osv_scanner"]) {
      const entry = profile.containerImages[tool];
      expect(entry, tool).toBeDefined();
      expect(script).toContain(`${entry?.image}:${entry?.tag}@${entry?.digest}`);
    }
  });

  it("Semgrep のルールは、先頭のコメントに出どころ・版・ライセンスを書き、重大度 ERROR を含む", async () => {
    const files = await generate(over);
    const rules = files.filter((f) => /^\.semgrep\/.+\.yaml$/.test(f.path));
    for (const rule of rules) {
      const head = rule.content.split("\n").slice(0, 5).join("\n");
      expect(head, rule.path).toContain("出どころ：semgrep/semgrep-rules");
      expect(head, rule.path).toMatch(/コミット [0-9a-f]{40}/);
      expect(head, rule.path).toContain("ライセンス");
      expect(rule.content, rule.path).toContain("severity: ERROR");
    }
    expect(contentOf(files, ".semgrep/NOTICE.md")).toContain("Commons Clause");
  });

  it("管理の分類：実行・設定・ルールはハーネスが管理し、仕様書・手順書はプロジェクトのもの", async () => {
    const files = await generate(over);
    const byPath = new Map(files.map((f) => [f.path, f.managed]));
    expect(byPath.get("scripts/security-check.mjs")).toBe(true);
    expect(byPath.get(".gitleaks.toml")).toBe(true);
    for (const f of files.filter((x) => x.path.startsWith(".semgrep/"))) {
      expect(f.managed, f.path).toBe(true);
    }
    expect(byPath.get("docs/api/openapi.json")).toBe(false);
    expect(byPath.get("docs/testing/security.md")).toBe(false);
    expect(byPath.get("docs/testing/schemathesis.md")).toBe(false);
    expect(byPath.get("backend/src/openapi.test.ts")).toBe(false);
  });

  it(".prettierignore は .semgrep（取ってきたルールの書式を保つ）を除く", async () => {
    expect(contentOf(await generate(over), ".prettierignore")).toMatch(/^\.semgrep$/m);
  });
});

describe("#42 isManagedPath", () => {
  it.each([
    ["scripts/security-check.mjs", true],
    [".gitleaks.toml", true],
    [".semgrep/NOTICE.md", true],
    [".semgrep/javascript-browser-security-insecure-innerhtml.yaml", true],
    [".github/dependabot.yml", true],
    ["docs/api/openapi.json", false],
    ["docs/testing/security.md", false],
    ["scripts/security-notes.mjs", false],
  ])("%s → %s", (p, managed) => {
    expect(isManagedPath(p)).toBe(managed);
  });
});

describe("#42 Dependabot（GitHub のときだけ）", () => {
  it("GitHub：npm・github-actions・docker-compose を weekly で更新し、npm の本番の依存はまとめる", async () => {
    const text = contentOf(await generate(D1), ".github/dependabot.yml");
    expect(text).toContain("version: 2");
    for (const eco of ["npm", "github-actions", "docker-compose"]) {
      expect(text).toContain(`package-ecosystem: ${eco}`);
    }
    expect(text.match(/interval: weekly/g)).toHaveLength(3);
    expect(text).toContain("dependency-type: production");
    expect(text).not.toContain("もとになった共通仕様");
  });

  it("GitHub を使わない（local）と、出ない", async () => {
    expect(pathsOf(await generate(LOCAL))).not.toContain(".github/dependabot.yml");
  });
});

describe("#42 .gitleaks.toml", () => {
  it("標準のルールを使い、例外は FAKE_SECRET_FOR_TEST の値と、コミットされないファイルのパスだけ", async () => {
    const toml = parseToml(contentOf(await generate(D1), ".gitleaks.toml")) as {
      extend: { useDefault: boolean };
      allowlist: { regexes: string[]; paths: string[] };
    };
    expect(toml.extend.useDefault).toBe(true);
    expect(toml.allowlist.regexes).toEqual(["FAKE_SECRET_FOR_TEST"]);
    const excluded = (file: string): boolean =>
      toml.allowlist.paths.some((pattern) => new RegExp(pattern).test(file));
    for (const file of [
      ".env",
      ".env.development",
      ".env.test",
      "x/.env.production",
      ".dev.vars",
      "/src/.env.development",
      "/src/.harness/config.yaml",
      "/src/node_modules/hono/package.json",
    ]) {
      expect(excluded(file), file).toBe(true);
    }
    // 項目の例だけの .env.example と、コードは検査する
    for (const file of [
      ".env.example",
      "/src/.env.example",
      "backend/src/app.ts",
      "docs/secrets.md",
      "src/env.ts",
    ]) {
      expect(excluded(file), file).toBe(false);
    }
  });
});

describe("#42 R4：API の仕様書は、実際に組み込まれるルートだけを書く", () => {
  const expected = (c: { db: boolean; auth: boolean }): string[] =>
    [
      "GET /api/health",
      ...(c.db ? ["GET /api/sample-users", "POST /api/sample-users"] : []),
      ...(c.auth ? ["GET /api/auth/me", "POST /api/auth/logout"] : []),
    ].sort();

  const cases: [string, Record<string, unknown>, { db: boolean; auth: boolean }][] = [
    ["DB なし・認証なし", NONE, { db: false, auth: false }],
    ["D1・認証なし", D1, { db: true, auth: false }],
    ["PostgreSQL・認証なし", PG, { db: true, auth: false }],
    ["D1・認証あり", D1_AUTH, { db: true, auth: true }],
    ["PostgreSQL・認証あり", PG_AUTH, { db: true, auth: true }],
  ];

  it.each(cases)("%s：仕様書の操作＝組み込まれるルート", async (_name, over, shape) => {
    const files = await generate(over);
    const spec = JSON.parse(contentOf(files, "docs/api/openapi.json")) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
    };
    expect(spec.openapi).toBe("3.1.0");
    const operations = Object.entries(spec.paths)
      .flatMap(([p, item]) => Object.keys(item).map((m) => `${m.toUpperCase()} ${p}`))
      .sort();
    expect(operations).toEqual(expected(shape));

    // 実際のルートのファイルと、突き合わせのテストの組み立ても、同じ条件で出る
    const paths = pathsOf(files);
    expect(paths.includes("backend/src/routes/sample-users.ts")).toBe(shape.db);
    expect(paths.includes("backend/src/routes/auth-session.ts")).toBe(shape.auth);
    const test = contentOf(files, "backend/src/openapi.test.ts");
    expect(test.includes("sampleUserRoutes")).toBe(shape.db);
    expect(test.includes("authRoutes")).toBe(shape.auth);
    expect(test).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  it("仕様書のスキーマは、zod の検証と同じ制約（1〜50字・英数字と _）で、状態を変える操作は 403 を書く", async () => {
    const spec = JSON.parse(contentOf(await generate(D1_AUTH), "docs/api/openapi.json")) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, Record<string, unknown>> };
    };
    const input = spec.components.schemas["SampleUserInput"] as {
      properties: { username: { minLength: number; maxLength: number; pattern: string } };
    };
    expect(input.properties.username).toMatchObject({
      minLength: 1,
      maxLength: 50,
      pattern: "^[A-Za-z0-9_]+$",
    });
    const sample = readFileSync(
      path.join(
        realTemplatesDir,
        "profiles",
        "data-access",
        "drizzle",
        "files",
        "sample-users.route.ts",
      ),
      "utf8",
    );
    expect(sample).toContain(".min(1)");
    expect(sample).toContain(".max(50)");
    expect(sample).toContain("/^[A-Za-z0-9_]+$/");
    for (const [p, item] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (method === "get") continue;
        expect(Object.keys(operation.responses), `${method} ${p}`).toContain("403");
      }
    }
    expect(Object.keys(spec.paths["/api/auth/me"]?.["get"]?.responses ?? {})).toContain("401");
    expect(Object.keys(spec.paths["/api/auth/logout"]?.["post"]?.responses ?? {})).toContain("401");
  });
});

describe("#42 文書", () => {
  it("docs/testing/security.md：実行・判定・抑止の決まり・Docker の導入・通信・ダミーの秘密情報・検出の確かめ方", async () => {
    const doc = contentOf(await generate(D1), "docs/testing/security.md");
    for (const word of [
      "npm run security",
      "Docker",
      "nosemgrep",
      "FAKE_SECRET_FOR_TEST",
      "7.0",
      "docker info",
      "通信",
      "検出が働いていることを確かめる方法",
      "ghp_",
      "Docker Desktop",
      "ライセンス",
    ]) {
      expect(doc, word).toContain(word);
    }
    expect(doc).not.toMatch(/\{\{[a-z_]+\}\}/);
    // 固定したイメージの版とダイジェストを書く
    const semgrep = profile.containerImages["semgrep"];
    expect(doc).toContain(semgrep?.digest ?? "?");
    expect(doc).toContain(semgrep?.checkedOn ?? "?");
  });

  it("docs/testing/schemathesis.md：手順・OS ごとの接続先・Origin・本番に向けない・check に入れない", async () => {
    const doc = contentOf(await generate(D1), "docs/testing/schemathesis.md");
    const image = profile.containerImages["schemathesis"];
    expect(doc).toContain(`${image?.image}:${image?.tag}@${image?.digest}`);
    for (const word of [
      "npm run dev",
      "host.docker.internal",
      "--network host",
      "docs/api/openapi.json",
      '-H "Origin: ',
      "403",
      "401",
      "本番",
      "npm run check",
    ]) {
      expect(doc, word).toContain(word);
    }
    expect(doc).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  it("docs/testing/README.md の一覧に、セキュリティのテストと Schemathesis が載る", async () => {
    const doc = contentOf(await generate(D1), "docs/testing/README.md");
    expect(doc).toContain("[security.md](security.md)");
    expect(doc).toContain("[schemathesis.md](schemathesis.md)");
  });

  it("README のひな形：Docker が必須（D1 も）で、導入とライセンスの注意、check と check:app の書き分け", async () => {
    for (const over of [D1, NONE, PG]) {
      const readme = contentOf(await generate(over), "README.md");
      expect(readme).toContain("Docker");
      expect(readme).toContain("Docker Desktop");
      expect(readme).toContain("npm run check:app");
      expect(readme).toContain("docs/testing/security.md");
    }
  });

  it("Skill：quality-tools は check:app と security、security は API を足したら仕様書も書く、testing は Schemathesis", async () => {
    const files = await generate(D1);
    const quality = contentOf(files, ".claude/skills/quality-tools/SKILL.md");
    expect(quality).toContain("npm run check:app");
    expect(quality).toContain("Semgrep");
    expect(quality).toContain("nosemgrep");
    expect(quality).toContain("理由");
    const security = contentOf(files, ".claude/skills/security/SKILL.md");
    expect(security).toContain("docs/api/openapi.json");
    expect(security).toContain("仕様書");
    const testing = contentOf(files, ".claude/skills/testing/SKILL.md");
    expect(testing).toContain("Schemathesis");
    expect(testing).toContain("docs/testing/schemathesis.md");
  });
});

describe("#42 Schemathesis が見つけた不具合：壊れた JSON の本文が 500 になっていた", () => {
  it("error-handler.ts は、Hono の 400（HTTPException）を、検証のエラー（422・VALIDATION_ERROR）にする", async () => {
    const files = await generate(D1);
    const handler = contentOf(files, "backend/src/lib/error-handler.ts");
    expect(handler).toContain("HTTPException");
    expect(handler).toContain("422");
    expect(handler).toContain("VALIDATION_ERROR");
    // 再発を防ぐテストも出る
    const test = contentOf(files, "backend/src/lib/error-handler.test.ts");
    expect(test).toContain("壊れた JSON");
    expect(test).toContain("422");
  });
});
