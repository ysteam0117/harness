// 想定する型（実装は src/generate/package-json.ts をこれに合わせる）。生成するプロジェクトの package.json
//
//   export interface BuildPackageJsonInput {
//     appName: string;
//     answers: Answers;           // packages_when の条件（database など）に使う
//     profiles: Profile[];        // 選んだプロファイル（resolveProfiles の結果）。Profile に devPackages: string[] が加わる
//     versions: VersionResult;    // #33 の選んだ版。"node" の項目が Node.js の版
//   }
//   export function buildPackageJson(input: BuildPackageJsonInput): Record<string, unknown>;
//     - 先頭のキーの並び：name・version・private・type・engines
//     - name：アプリ名、version："0.0.0"、private：true、type："module"、engines.node：">=<選んだ Node.js の大きな版>"
//     - dependencies・devDependencies：実際に選ばれた（packages ＋ 回答に合う packages_when）パッケージを、
//       dev_packages にあれば devDependencies、なければ dependencies に入れる。版は正確な版（^・~ なし。C-62）。名前の昇順
//     - scripts・overrides 等：mergePackageJson（プロファイルの package_json）の結果。external_tools・optional_packages は加えない
//     - 選ばれたパッケージの版が versions にないときは GenerateError（名前を示す）
//     - 同じ入力なら同じ中身（versions の並びが違っても同じ。JSON にしたときの文字列も同じ）
import { afterAll, describe, expect, it } from "vitest";
import { GenerateError } from "../../src/generate/errors.js";
import { buildPackageJson } from "../../src/generate/package-json.js";
import { loadProfile, resolveProfiles } from "../../src/generate/profile.js";
import { selectProfiles } from "../../src/versions/profile-selection.js";
import type { VersionEntry, VersionResult } from "../../src/versions/choose.js";
import { FIXED_DAY } from "../versions/helpers.js";
import { cleanupTemplates, makeTemplates, realTemplatesDir } from "./helpers.js";
import { completeAnswers, surveyVersions } from "./project-helpers.js";

afterAll(cleanupTemplates);

const entry = (name: string, version: string): VersionEntry => ({
  name,
  version,
  reason: "ハーネス検証済み",
  surveyedOn: FIXED_DAY,
  latestStable: null,
  latestStatus: "failed",
  fetchFailure: "ECONNREFUSED (fake)",
  verified: version,
  newerThanVerified: false,
  majorDiffers: false,
});

const result = (entries: VersionEntry[]): VersionResult => ({ entries, newerThanVerified: false });

const GAMMA = `id: gamma
category: lib
name: Gamma
packages: [gamma-run, gamma-dev]
packages_when:
  - when: { database: postgresql }
    packages: [gamma-pg]
dev_packages: [gamma-dev, gamma-pg]
verified_versions:
  gamma-run: "1.0.0"
  gamma-dev: "2.0.0"
  gamma-pg: "3.0.0"
skill_name: lib-gamma
package_json:
  scripts:
    test: "gamma test"
`;

const gammaDir = () =>
  makeTemplates({
    "profiles/lib/gamma/profile.yaml": GAMMA,
    "profiles/lib/gamma/SKILL.md": "# gamma\n",
  });

const ALL_VERSIONS = [
  entry("node", "24.19.0"),
  entry("gamma-run", "1.0.0"),
  entry("gamma-dev", "2.0.0"),
  entry("gamma-pg", "3.0.0"),
];

describe("#34 R3: package.json の組み立て（小さなプロファイル）", () => {
  it("#34 R3: 基本の項目（name・version・private・type・engines）。キーの並びは固定", async () => {
    const answers = await completeAnswers({ app_name: "testapp-001", database: "d1" });
    const pkg = buildPackageJson({
      appName: "testapp-001",
      answers,
      profiles: [loadProfile(gammaDir(), "lib/gamma")],
      versions: result(ALL_VERSIONS),
    });
    expect(Object.keys(pkg).slice(0, 5)).toEqual(["name", "version", "private", "type", "engines"]);
    expect(pkg).toMatchObject({
      name: "testapp-001",
      version: "0.0.0",
      private: true,
      type: "module",
      engines: { node: ">=24" },
    });
  });

  it("#34 R3: engines は選んだ Node.js の大きな版（22.20.0 なら >=22）", async () => {
    const answers = await completeAnswers({ database: "d1" });
    const pkg = buildPackageJson({
      appName: "testapp-001",
      answers,
      profiles: [loadProfile(gammaDir(), "lib/gamma")],
      versions: result([entry("node", "22.20.0"), ...ALL_VERSIONS.slice(1)]),
    });
    expect(pkg["engines"]).toEqual({ node: ">=22" });
  });

  it("#34 R3: dev_packages にあるものは devDependencies、ないものは dependencies（D1：pg は入らない）", async () => {
    const answers = await completeAnswers({ database: "d1" });
    const pkg = buildPackageJson({
      appName: "testapp-001",
      answers,
      profiles: [loadProfile(gammaDir(), "lib/gamma")],
      versions: result(ALL_VERSIONS),
    });
    expect(pkg["dependencies"]).toEqual({ "gamma-run": "1.0.0" });
    expect(pkg["devDependencies"]).toEqual({ "gamma-dev": "2.0.0" });
    expect(JSON.stringify(pkg)).not.toContain("gamma-pg");
  });

  it("#34 R3: 条件で入るパッケージ（PostgreSQL のとき gamma-pg）も、dev_packages に従って振り分ける", async () => {
    const answers = await completeAnswers({ database: "postgresql", postgres_provider: "neon" });
    const pkg = buildPackageJson({
      appName: "testapp-001",
      answers,
      profiles: [loadProfile(gammaDir(), "lib/gamma")],
      versions: result(ALL_VERSIONS),
    });
    expect(pkg["dependencies"]).toEqual({ "gamma-run": "1.0.0" });
    expect(pkg["devDependencies"]).toEqual({ "gamma-dev": "2.0.0", "gamma-pg": "3.0.0" });
  });

  it("#34 R3: 版は正確な版（^・~ なし）で、versions の採用した版と同じ", async () => {
    const answers = await completeAnswers({ database: "postgresql", postgres_provider: "neon" });
    const pkg = buildPackageJson({
      appName: "testapp-001",
      answers,
      profiles: [loadProfile(gammaDir(), "lib/gamma")],
      versions: result([
        entry("node", "24.19.0"),
        entry("gamma-run", "1.4.2"),
        entry("gamma-dev", "2.0.0"),
        entry("gamma-pg", "3.0.0"),
      ]),
    });
    const all = {
      ...(pkg["dependencies"] as Record<string, string>),
      ...(pkg["devDependencies"] as Record<string, string>),
    };
    expect(all["gamma-run"]).toBe("1.4.2");
    for (const [name, v] of Object.entries(all)) expect(v, name).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("#34 R3: scripts はプロファイルの package_json から（mergePackageJson の結果）", async () => {
    const answers = await completeAnswers({ database: "d1" });
    const pkg = buildPackageJson({
      appName: "testapp-001",
      answers,
      profiles: [loadProfile(gammaDir(), "lib/gamma")],
      versions: result(ALL_VERSIONS),
    });
    expect(pkg["scripts"]).toEqual({ test: "gamma test" });
  });

  it("#34 R3: 同じ入力なら同じ中身（versions の並びが違っても、JSON の文字列が同じ）。名前は昇順", async () => {
    const answers = await completeAnswers({ database: "postgresql", postgres_provider: "neon" });
    const make = (entries: VersionEntry[]) =>
      JSON.stringify(
        buildPackageJson({
          appName: "testapp-001",
          answers,
          profiles: [loadProfile(gammaDir(), "lib/gamma")],
          versions: result(entries),
        }),
      );
    expect(make(ALL_VERSIONS)).toBe(make([...ALL_VERSIONS].reverse()));
    const parsed = JSON.parse(make(ALL_VERSIONS)) as { devDependencies: Record<string, string> };
    const names = Object.keys(parsed.devDependencies);
    expect(names).toEqual([...names].sort());
  });

  it("#34 R3: 選ばれたパッケージの版が versions にないと、名前を示してエラー", async () => {
    const answers = await completeAnswers({ database: "d1" });
    expect(() =>
      buildPackageJson({
        appName: "testapp-001",
        answers,
        profiles: [loadProfile(gammaDir(), "lib/gamma")],
        versions: result([entry("node", "24.19.0"), entry("gamma-run", "1.0.0")]),
      }),
    ).toThrow(GenerateError);
    expect(() =>
      buildPackageJson({
        appName: "testapp-001",
        answers,
        profiles: [loadProfile(gammaDir(), "lib/gamma")],
        versions: result([entry("node", "24.19.0"), entry("gamma-run", "1.0.0")]),
      }),
    ).toThrow(/gamma-dev/);
  });

  it("#34 R3: dev_packages がないプロファイルは、すべて dependencies（devDependencies は空か、なし）", async () => {
    const dir = makeTemplates({
      "profiles/lib/delta/profile.yaml": `id: delta
category: lib
name: Delta
packages: [delta-a]
verified_versions:
  delta-a: "1.0.0"
skill_name: lib-delta
`,
      "profiles/lib/delta/SKILL.md": "# delta\n",
    });
    const pkg = buildPackageJson({
      appName: "testapp-001",
      answers: await completeAnswers({ database: "d1" }),
      profiles: [loadProfile(dir, "lib/delta")],
      versions: result([entry("node", "24.19.0"), entry("delta-a", "1.0.0")]),
    });
    expect(pkg["dependencies"]).toEqual({ "delta-a": "1.0.0" });
    expect(pkg["devDependencies"] ?? {}).toEqual({});
  });
});

describe("#34 R3: package.json の組み立て（実際のプロファイル）", () => {
  const build = async (over: Record<string, unknown>) => {
    const answers = await completeAnswers(over);
    const versions = await surveyVersions(answers);
    const profiles = resolveProfiles(realTemplatesDir, selectProfiles(answers));
    const pkg = buildPackageJson({
      appName: answers.app_name,
      answers,
      profiles,
      versions,
    }) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    return { pkg, versions };
  };

  it("#34 R3: D1：実行に使うものは dependencies、テスト・品質・ビルドの道具は devDependencies（どちらか一方にだけ入る）", async () => {
    const { pkg } = await build({ database: "d1" });
    for (const name of ["hono", "zod", "react", "react-dom", "axios", "drizzle-orm"]) {
      expect(pkg.dependencies, name).toHaveProperty([name]);
    }
    for (const name of [
      "vitest",
      "@playwright/test",
      "typescript",
      "eslint",
      "prettier",
      "wrangler",
      "drizzle-kit",
    ]) {
      expect(pkg.devDependencies, name).toHaveProperty([name]);
    }
    for (const name of Object.keys(pkg.dependencies)) {
      expect(pkg.devDependencies, name).not.toHaveProperty([name]);
    }
    expect(JSON.stringify(pkg)).not.toContain('"pg"');
  });

  it("#34 R3: PostgreSQL：pg は実行に使うので dependencies に入る", async () => {
    const { pkg } = await build({ database: "postgresql", postgres_provider: "neon" });
    expect(pkg.dependencies).toHaveProperty(["pg"]);
    expect(pkg.devDependencies).not.toHaveProperty(["pg"]);
  });

  it("#34 R3: DB なし：drizzle・pg は入らない", async () => {
    const { pkg } = await build({ database: "none" });
    const text = JSON.stringify(pkg);
    expect(text).not.toContain("drizzle");
    expect(text).not.toContain('"pg"');
  });

  it("#34 R3: dependencies と devDependencies の合計は、調べた版（Node.js を除く）と一致し、版が同じ", async () => {
    const { pkg, versions } = await build({ database: "d1" });
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const expected = Object.fromEntries(
      versions.entries.filter((e) => e.name !== "node").map((e) => [e.name, e.version]),
    );
    expect(all).toEqual(expected);
    for (const [name, v] of Object.entries(all)) expect(v, name).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("#34 R3: scripts（check など）と overrides は、プロファイルの package_json から入る", async () => {
    const { pkg } = await build({ database: "d1" });
    expect(pkg.scripts["check"]).toContain("npm run lint");
    expect(pkg.scripts["env:check"]).toBe("node scripts/env-check.mjs");
    expect(pkg).toHaveProperty(["overrides"]);
  });
});
