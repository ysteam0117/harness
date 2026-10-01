// 想定する型（実装は src/generate/profile.ts・errors.ts をこれに合わせる）
//
//   export type Profile = {
//     key: string;                 // "<分類>/<id>"（例："backend-framework/hono"）
//     id: string;
//     category: string;
//     name: string;
//     skillName: string;           // 出力するSkillのフォルダ名（profile.yaml の skill_name）
//     dir: string;                 // プロファイルのフォルダの絶対パス
//     languages: string[];         // 書いてなければ []
//     requires: string[];          // 書いてなければ []（"<分類>/<id>" の形）
//     includes: string[];          // 書いてなければ []（"<分類>/_shared" の形）
//     optionalPackages: string[];  // 書いてなければ []。読み込むだけで、依存には加えない
//     files: { source: string; destination: string }[];
//                                  // source：プロファイルの中の相対パス（"files/logger.ts"）
//                                  // destination：出力先の相対パス（"backend/src/lib/logger/logger.ts"）
//                                  // profile.yaml に書いた順
//     packageJson: Record<string, unknown>;  // package_json（書いてなければ {}）
//   };
//   export function loadProfile(templatesDir: string, key: string): Profile;
//   export function resolveProfiles(templatesDir: string, selected: string[]): Profile[];
//        // 選んだ順に Profile を返す。requires の不足は、足りないものをすべて示してエラー。自動で足さない
//   export function mergePackageJson(profiles: Profile[]): Record<string, unknown>;
//   すべて、誤りは GenerateError（日本語のメッセージ）を投げる
import { afterAll, describe, expect, it } from "vitest";
import { GenerateError } from "../../src/generate/errors.js";
import {
  loadProfile,
  mergePackageJson,
  resolveProfiles,
  type Profile,
} from "../../src/generate/profile.js";
import { cleanupTemplates, fixturesDir, makeTemplates, realTemplatesDir } from "./helpers.js";

afterAll(cleanupTemplates);

const REAL_PROFILES = [
  "backend-framework/hono",
  "data-access/drizzle",
  "frontend-build/vite-react-router",
  "frontend-state/tanstack-query-rhf-zod",
  "http-client/axios",
  "logger/structured-logger",
  "quality/typescript-standard",
  "test-framework/vitest-playwright",
];

const ALPHA_YAML = `id: alpha
category: lib
name: Alpha
skill_name: lib-alpha
files:
  files/a.ts: out/a.ts
`;

/** alpha だけの小さなひな形。extra で足す・上書きする。 */
function alphaTemplates(yaml: string, extra: Record<string, string> = {}): string {
  return makeTemplates({
    "profiles/lib/alpha/profile.yaml": yaml,
    "profiles/lib/alpha/files/a.ts": "export const a = 1;\n",
    "profiles/lib/alpha/SKILL.md": "# alpha\n",
    "profiles/lib/_shared/SKILL.md": "共通\n",
    ...extra,
  });
}

describe("#31 AC-4: プロファイルの読み込み", () => {
  it("#31 AC-4: 実際の8つのプロファイルがすべて読める", () => {
    for (const key of REAL_PROFILES) {
      const profile = loadProfile(realTemplatesDir, key);
      expect(profile.key).toBe(key);
      expect(`${profile.category}/${profile.id}`).toBe(key);
      expect(profile.name.length).toBeGreaterThan(0);
      expect(profile.skillName.length).toBeGreaterThan(0);
    }
  });

  it("#31 AC-4: 実際の Hono の項目（skill_name・requires・files）が読める", () => {
    const hono = loadProfile(realTemplatesDir, "backend-framework/hono");
    expect(hono.skillName).toBe("backend-hono");
    expect(hono.requires).toEqual(["logger/structured-logger"]);
    expect(hono.files).toContainEqual({
      source: "files/error-handler.ts",
      destination: "backend/src/lib/error-handler.ts",
    });
    expect(hono.files).toHaveLength(5);
  });

  it("#31 AC-4: includes・optional_packages・package_json が読める（$zod はそのまま残す）", () => {
    const drizzle = loadProfile(realTemplatesDir, "data-access/drizzle");
    expect(drizzle.includes).toEqual(["data-access/_shared"]);
    const state = loadProfile(realTemplatesDir, "frontend-state/tanstack-query-rhf-zod");
    expect(state.optionalPackages).toEqual(["zustand"]);
    expect(state.packageJson).toEqual({ overrides: { "@typeschema/zod": { zod: "$zod" } } });
  });

  it("#31 AC-4: 書いていない項目は空の配列・空のオブジェクトになる", () => {
    const logger = loadProfile(realTemplatesDir, "logger/structured-logger");
    expect(logger.requires).toEqual([]);
    expect(logger.includes).toEqual([]);
    expect(logger.optionalPackages).toEqual([]);
    expect(logger.packageJson).toEqual({});
  });

  it("#31 AC-4: 実際のプロファイルの files の出力先は、相対パスで .. を含まない", () => {
    for (const key of REAL_PROFILES) {
      const profile = loadProfile(realTemplatesDir, key);
      for (const f of profile.files) {
        expect(f.destination.startsWith("/")).toBe(false);
        expect(f.destination.split("/")).not.toContain("..");
      }
    }
  });

  it("#31 AC-4: 小さなひな形（fixtures）のプロファイルが読める", () => {
    const alpha = loadProfile(fixturesDir, "lib/alpha");
    expect(alpha.skillName).toBe("lib-alpha");
    expect(alpha.files.map((f) => f.destination)).toEqual(["out/src/a.ts", "out/src/b.ts"]);
    expect(alpha.packageJson).toEqual({
      scripts: { alpha: "alpha run" },
      overrides: { "@scope/pkg": { zod: "$zod" } },
    });
  });
});

describe("#31 AC-4: プロファイルの検証（エラー）", () => {
  it("#31 AC-4: files の元のファイルがなければエラーにする（ファイル名を示す）", () => {
    const dir = alphaTemplates(
      ALPHA_YAML.replace("files/a.ts: out/a.ts", "files/missing.ts: out/a.ts"),
    );
    expect(() => loadProfile(dir, "lib/alpha")).toThrow(GenerateError);
    expect(() => loadProfile(dir, "lib/alpha")).toThrow(/files\/missing\.ts/);
  });

  it("#31 AC-4: 知らない項目はエラーにする（項目名を示す）", () => {
    const dir = alphaTemplates(`${ALPHA_YAML}requirs: [lib/beta]\n`);
    expect(() => loadProfile(dir, "lib/alpha")).toThrow(GenerateError);
    expect(() => loadProfile(dir, "lib/alpha")).toThrow(/requirs/);
  });

  it("#31 AC-4: id がフォルダの名前と一致しなければエラーにする", () => {
    const dir = alphaTemplates(ALPHA_YAML.replace("id: alpha", "id: alfa"));
    expect(() => loadProfile(dir, "lib/alpha")).toThrow(GenerateError);
  });

  it("#31 AC-4: category がフォルダの名前と一致しなければエラーにする", () => {
    const dir = alphaTemplates(ALPHA_YAML.replace("category: lib", "category: other"));
    expect(() => loadProfile(dir, "lib/alpha")).toThrow(GenerateError);
  });

  it.each(["id", "category", "name", "skill_name"])(
    "#31 AC-4: 必須の項目 %s がなければエラーにする",
    (field) => {
      const yaml = ALPHA_YAML.split("\n")
        .filter((line) => !line.startsWith(`${field}:`))
        .join("\n");
      expect(() => loadProfile(alphaTemplates(yaml), "lib/alpha")).toThrow(GenerateError);
    },
  );

  it.each(["/abs/a.ts", "../outside/a.ts", "out/../../a.ts", "C:/abs/a.ts"])(
    "#31 AC-4: files の出力先 %s（絶対パス・..）はエラーにする",
    (dest) => {
      const dir = alphaTemplates(ALPHA_YAML.replace("out/a.ts", `"${dest}"`));
      expect(() => loadProfile(dir, "lib/alpha")).toThrow(GenerateError);
    },
  );

  it("#31 AC-4: files の元のパスがプロファイルの外（..）を指すとエラーにする", () => {
    const dir = alphaTemplates(
      ALPHA_YAML.replace("files/a.ts: out/a.ts", '"../../_shared/SKILL.md": out/a.ts'),
    );
    expect(() => loadProfile(dir, "lib/alpha")).toThrow(GenerateError);
  });

  it("#31 AC-4: includes の先（<分類>/_shared）がなければエラーにする", () => {
    const yaml = `${ALPHA_YAML}includes:\n  - lib/_shared\n`;
    const dir = makeTemplates({
      "profiles/lib/alpha/profile.yaml": yaml,
      "profiles/lib/alpha/files/a.ts": "x\n",
      "profiles/lib/alpha/SKILL.md": "# alpha\n",
    });
    expect(() => loadProfile(dir, "lib/alpha")).toThrow(GenerateError);
    expect(() => loadProfile(dir, "lib/alpha")).toThrow(/lib\/_shared/);
  });

  it("#31 AC-4: profile.yaml がなければエラーにする", () => {
    expect(() => loadProfile(fixturesDir, "lib/nothing")).toThrow(GenerateError);
  });

  it("#31 AC-4: profile.yaml が YAML として壊れていればエラーにする", () => {
    const dir = alphaTemplates("id: [alpha\n  : :\n");
    expect(() => loadProfile(dir, "lib/alpha")).toThrow(GenerateError);
  });

  it("#31 AC-4: キーの形（<分類>/<id>）が誤っていればエラーにする", () => {
    for (const key of ["alpha", "../lib/alpha", "lib/alpha/extra", ""]) {
      expect(() => loadProfile(fixturesDir, key)).toThrow(GenerateError);
    }
  });
});

describe("#31 AC-4: resolveProfiles（requires の確認）", () => {
  it("#31 AC-4: requires がそろっていれば、選んだ順に返す（自動で足さない）", () => {
    const profiles = resolveProfiles(fixturesDir, ["lib/beta", "lib/alpha"]);
    expect(profiles.map((p) => p.key)).toEqual(["lib/beta", "lib/alpha"]);
  });

  it("#31 AC-4: requires の不足はエラーにし、不足しているものを自動では足さない", () => {
    expect(() => resolveProfiles(fixturesDir, ["lib/beta"])).toThrow(GenerateError);
    expect(() => resolveProfiles(fixturesDir, ["lib/beta"])).toThrow(/lib\/alpha/);
  });

  it("#31 AC-4: 実際の Hono だけを選ぶと、ロガーの不足を示してエラーになる", () => {
    expect(() => resolveProfiles(realTemplatesDir, ["backend-framework/hono"])).toThrow(
      /logger\/structured-logger/,
    );
  });

  it("#31 AC-4: Hono とロガーを選べば読める", () => {
    const profiles = resolveProfiles(realTemplatesDir, [
      "backend-framework/hono",
      "logger/structured-logger",
    ]);
    expect(profiles).toHaveLength(2);
  });

  it("#31 AC-4: requires が複数足りなければ、足りないものをすべて示す", () => {
    const dir = makeTemplates({
      "profiles/lib/main/profile.yaml": `id: main
category: lib
name: Main
skill_name: lib-main
requires: [lib/x1, lib/x2, lib/x3]
`,
      "profiles/lib/main/SKILL.md": "# main\n",
      "profiles/lib/x2/profile.yaml": `id: x2
category: lib
name: X2
skill_name: lib-x2
`,
      "profiles/lib/x2/SKILL.md": "# x2\n",
    });
    let message = "";
    try {
      resolveProfiles(dir, ["lib/main", "lib/x2"]);
    } catch (e) {
      expect(e).toBeInstanceOf(GenerateError);
      message = (e as Error).message;
    }
    expect(message).toContain("lib/x1");
    expect(message).toContain("lib/x3");
    expect(message).not.toContain("lib/x2");
  });

  it("#31 AC-4: 同じプロファイルを2回選ぶとエラーにする", () => {
    expect(() => resolveProfiles(fixturesDir, ["lib/alpha", "lib/alpha"])).toThrow(GenerateError);
  });

  it("#31 AC-4: 2つのプロファイルの files の出力先が重なったらエラーにする", () => {
    const dir = makeTemplates({
      "profiles/lib/p1/profile.yaml": `id: p1
category: lib
name: P1
skill_name: lib-p1
files:
  files/x.ts: same/out.ts
`,
      "profiles/lib/p1/files/x.ts": "1\n",
      "profiles/lib/p1/SKILL.md": "# p1\n",
      "profiles/lib/p2/profile.yaml": `id: p2
category: lib
name: P2
skill_name: lib-p2
files:
  files/y.ts: same/out.ts
`,
      "profiles/lib/p2/files/y.ts": "2\n",
      "profiles/lib/p2/SKILL.md": "# p2\n",
    });
    expect(() => resolveProfiles(dir, ["lib/p1", "lib/p2"])).toThrow(GenerateError);
    expect(() => resolveProfiles(dir, ["lib/p1", "lib/p2"])).toThrow(/same\/out\.ts/);
  });

  it("#31 AC-4: skill_name が重なったらエラーにする", () => {
    const mk = (id: string): Record<string, string> => ({
      [`profiles/lib/${id}/profile.yaml`]: `id: ${id}
category: lib
name: ${id}
skill_name: same-skill
`,
      [`profiles/lib/${id}/SKILL.md`]: `# ${id}\n`,
    });
    const dir = makeTemplates({ ...mk("p1"), ...mk("p2") });
    expect(() => resolveProfiles(dir, ["lib/p1", "lib/p2"])).toThrow(GenerateError);
    expect(() => resolveProfiles(dir, ["lib/p1", "lib/p2"])).toThrow(/same-skill/);
  });

  it("#31 AC-4: 実際の8つのプロファイルを同時に選んでも、重なりなく解決できる", () => {
    const profiles = resolveProfiles(realTemplatesDir, REAL_PROFILES);
    expect(profiles).toHaveLength(8);
  });
});

describe("#31 AC-4: mergePackageJson", () => {
  const base = loadProfile(fixturesDir, "lib/alpha");
  const withPackageJson = (packageJson: Record<string, unknown>): Profile => ({
    ...base,
    packageJson,
  });

  it("#31 AC-4: package_json を深くまとめる（$zod のような値はそのまま残す）", () => {
    const merged = mergePackageJson([
      withPackageJson({ scripts: { a: "x" }, overrides: { "@s/p": { zod: "$zod" } } }),
      withPackageJson({ scripts: { b: "y" }, overrides: { "@s/q": { zod: "$zod" } } }),
    ]);
    expect(merged).toEqual({
      scripts: { a: "x", b: "y" },
      overrides: { "@s/p": { zod: "$zod" }, "@s/q": { zod: "$zod" } },
    });
  });

  it("#31 AC-4: 同じ項目に違う値があればエラーにする（項目の場所を示す）", () => {
    const conflict = (): Record<string, unknown> =>
      mergePackageJson([
        withPackageJson({ scripts: { check: "one" } }),
        withPackageJson({ scripts: { check: "two" } }),
      ]);
    expect(conflict).toThrow(GenerateError);
    expect(conflict).toThrow(/check/);
  });

  it("#31 AC-4: 同じ項目に同じ値ならエラーにしない", () => {
    expect(
      mergePackageJson([
        withPackageJson({ scripts: { check: "one" } }),
        withPackageJson({ scripts: { check: "one" } }),
      ]),
    ).toEqual({ scripts: { check: "one" } });
  });

  it("#31 AC-4: package_json がないプロファイルだけなら空のオブジェクトを返す", () => {
    expect(mergePackageJson([withPackageJson({})])).toEqual({});
    expect(mergePackageJson([])).toEqual({});
  });

  it("#31 AC-4: 値の型が違う（文字列とオブジェクト）場合もエラーにする", () => {
    expect(() =>
      mergePackageJson([
        withPackageJson({ scripts: "text" }),
        withPackageJson({ scripts: { a: "x" } }),
      ]),
    ).toThrow(GenerateError);
  });

  it("#31 AC-4: 渡したプロファイルの packageJson を書き換えない", () => {
    const a = withPackageJson({ scripts: { a: "x" } });
    const b = withPackageJson({ scripts: { b: "y" } });
    mergePackageJson([a, b]);
    expect(a.packageJson).toEqual({ scripts: { a: "x" } });
    expect(b.packageJson).toEqual({ scripts: { b: "y" } });
  });

  it("#31 AC-4: 実際のプロファイル（quality と frontend-state）の package_json をまとめられる", () => {
    const merged = mergePackageJson(
      resolveProfiles(realTemplatesDir, [
        "quality/typescript-standard",
        "frontend-state/tanstack-query-rhf-zod",
      ]),
    ) as { scripts: Record<string, string>; overrides: Record<string, unknown> };
    expect(merged.scripts["check"]).toContain("npm run lint");
    expect(merged.overrides["@typeschema/zod"]).toEqual({ zod: "$zod" });
  });
});
