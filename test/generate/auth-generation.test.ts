// #72 認証の生成の仕組み：環境変数・要件定義書の未決定事項・認証なしの出力が変わらないこと（AC-2）
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildProject, type ProjectFile } from "../../src/generate/project.js";
import { fingerprint } from "../../src/generate/config.js";
import { contentOf, pathsOf, projectInput } from "./project-helpers.js";

async function generate(over: Record<string, unknown>): Promise<ProjectFile[]> {
  return buildProject(await projectInput(over)).files;
}

const AUTH = {
  none: { auth: "none", idp: undefined },
  app: { auth: "app", idp: undefined },
  oidc: { auth: "oidc", idp: "google" },
  both: { auth: "both", idp: "google" },
} as const;

const envNames = (files: ProjectFile[]): string[] =>
  contentOf(files, ".env.example")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => l.slice(0, l.indexOf("=")));

const NEW_ENV = ["OIDC_ISSUER", "OIDC_REDIRECT_URI", "APP_BASE_URL"];

describe("#72 環境変数：OIDC_ISSUER・OIDC_REDIRECT_URI・APP_BASE_URL（oidc・both のとき）", () => {
  it.each(["oidc", "both"] as const)(
    "#72 AC-1: %s では .env.example と secrets.md に出る",
    async (a) => {
      const files = await generate({ ...AUTH[a], database: "d1" });
      const secrets = contentOf(files, "docs/secrets.md");
      for (const name of NEW_ENV) {
        expect(envNames(files), name).toContain(name);
        expect(secrets, name).toContain(`\`${name}\``);
      }
    },
  );

  it.each(["none", "app"] as const)("#72 AC-1: %s では出ない", async (a) => {
    const files = await generate({ ...AUTH[a], database: "d1" });
    const secrets = contentOf(files, "docs/secrets.md");
    for (const name of NEW_ENV) {
      expect(envNames(files), name).not.toContain(name);
      expect(secrets, name).not.toContain(name);
    }
  });

  it("#72 AC-1: .env.example の値は空かプレースホルダだけ（実際の値を書かない）", async () => {
    const files = await generate({ ...AUTH.oidc, database: "d1" });
    for (const name of NEW_ENV) {
      const line = contentOf(files, ".env.example")
        .split("\n")
        .find((l) => l.startsWith(`${name}=`));
      expect(line, name).toMatch(/^[A-Z_]+=(|changeme|<[^>]*>)$/);
    }
  });
});

describe("#72 要件定義書の未決定事項（独自認証のときだけ4行）", () => {
  const ROWS = [
    "Workers のプラン",
    "パスワードのハッシュ化のライブラリと強さ",
    "パスワード再設定などのメールの送信サービス",
    "ログイン試行の制限の値",
  ];

  it.each(["app", "both"] as const)(
    "#72 AC-1: %s では4行が表の中に入り、決める時期は要件定義",
    async (a) => {
      const text = contentOf(
        await generate({ ...AUTH[a], database: "d1" }),
        "docs/requirements.md",
      );
      const section = text.slice(text.indexOf("## 7. 未決定事項"));
      const rows = section.split("\n").filter((l) => /^\| \d+ \|/.test(l));
      expect(rows).toHaveLength(4);
      ROWS.forEach((r, i) => {
        expect(rows[i]).toContain(r);
        expect(rows[i]).toMatch(/\| 要件定義 \|$/);
      });
      expect(section).toContain("@noble/hashes");
      expect(section).toContain("10ms");
      expect(section).toMatch(/5回で1分から倍々、上限15分/);
      // 表が途切れない（見出しの行・区切りの行・4行が、続けて並ぶ）
      expect(section).toMatch(/\| # \| 内容 \| 決める時期 \|\n\| --- \| --- \| --- \|\n\| 1 \|/);
    },
  );

  it.each(["oidc", "none"] as const)("#72 AC-1: %s では行がなく、空行も増えない", async (a) => {
    const text = contentOf(await generate({ ...AUTH[a], database: "d1" }), "docs/requirements.md");
    const section = text.slice(text.indexOf("## 7. 未決定事項"));
    expect(section.split("\n").filter((l) => /^\| \d+ \|/.test(l))).toHaveLength(0);
    expect(section).toBe("## 7. 未決定事項\n\n| # | 内容 | 決める時期 |\n| --- | --- | --- |\n");
    expect(text).not.toContain("{{");
  });
});

describe("#72 AC-2: 認証が none の生成結果は、変更の前と同じ", () => {
  const baseline = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures/auth-none-baseline.json",
  );

  const COMBOS: Record<string, Record<string, unknown>> = {
    none_none: { database: "none" },
    none_d1: { database: "d1" },
    none_pg: { database: "postgresql", postgres_provider: "neon" },
  };

  it.each(Object.keys(COMBOS))(
    "#72 AC-2: %s のファイルの一覧と中身の指紋が、変更前の記録と一致する",
    async (key) => {
      const expected = JSON.parse(readFileSync(baseline, "utf8")) as Record<string, string[]>;
      const files = await generate({ ...AUTH.none, ...COMBOS[key] });
      expect(files.map((f) => `${f.path} ${fingerprint(f.content)}`)).toEqual(expected[key]);
    },
  );

  it("#72 AC-2: none では、認証のプロファイルの Skill が出ない。認証ありでは出る", async () => {
    const none = pathsOf(await generate({ ...AUTH.none, database: "d1" }));
    expect(none.filter((p) => /skills\/auth-/.test(p))).toEqual([]);
    const app = pathsOf(await generate({ ...AUTH.app, database: "d1" }));
    expect(app.filter((p) => /skills\/auth-/.test(p)).length).toBeGreaterThan(0);
  });
});
