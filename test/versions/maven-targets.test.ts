// #39 AC-2: エコシステム（npm／maven）。架空のプロファイル（example-jvm）で、読み込み・対象・各所の扱いを確かめる。
import { afterAll, describe, expect, it } from "vitest";
import { GenerateError } from "../../src/generate/errors.js";
import { buildPackageJson } from "../../src/generate/package-json.js";
import { loadProfile } from "../../src/generate/profile.js";
import type { VersionEntry, VersionResult } from "../../src/versions/choose.js";
import { rangeTargets } from "../../src/versions/range-review.js";
import { checkMajorUpdates } from "../../src/versions/status-review.js";
import { buildTargets, targetsFor } from "../../src/versions/targets.js";
import { renderTechStack } from "../../src/versions/tech-stack.js";
import { cleanupTemplates, makeTemplates } from "../generate/helpers.js";
import { completeAnswers } from "../generate/project-helpers.js";
import { baseAnswers } from "../questions/helpers.js";
import { FIXED_DAY } from "./helpers.js";
import { fakeMaven, metadataXml } from "./maven-helpers.js";

afterAll(cleanupTemplates);

const HEAD = (id: string) => `id: ${id}\ncategory: lib\nname: ${id}\nskill_name: lib-${id}\n`;

const JVM = `${HEAD("example-jvm")}ecosystem: maven
languages: [java]
runtimes: [jvm]
packages: ["com.example:demo-lib", "com.example:demo-test"]
verified_versions:
  "com.example:demo-lib": "1.9.0"
  "com.example:demo-test": "2.0.0"
version_ranges:
  java: ">=21 <27"
  "com.example:demo-lib": ">=1.0 <2.0"
`;

function dir(files: Record<string, string>) {
  return makeTemplates(
    Object.fromEntries(
      Object.entries(files).flatMap(([id, yaml]) => [
        [`profiles/lib/${id}/profile.yaml`, yaml],
        [`profiles/lib/${id}/SKILL.md`, `# ${id}\n`],
      ]),
    ),
  );
}

const loadJvm = (yaml = JVM) => loadProfile(dir({ "example-jvm": yaml }), "lib/example-jvm");
const withExtra = (extra: string) => loadJvm(`${JVM}${extra}`);

describe("#39 AC-2: ecosystem の読み込み", () => {
  it("maven のプロファイルを読む（languages・runtimes・ecosystem が残る）", () => {
    const p = loadJvm();
    expect(p).toMatchObject({
      ecosystem: "maven",
      languages: ["java"],
      runtimes: ["jvm"],
      packages: ["com.example:demo-lib", "com.example:demo-test"],
    });
  });

  it("ecosystem を書かないプロファイルは npm（既存の yaml は変わらない）", () => {
    const p = loadProfile(
      dir({ plain: `${HEAD("plain")}packages: [fake-lib]\nunverified: [fake-lib]\n` }),
      "lib/plain",
    );
    expect(p.ecosystem).toBe("npm");
    expect(p.runtimes).toEqual([]);
  });

  it("知らない ecosystem・languages はエラー", () => {
    expect(() => loadProfile(dir({ x: `${HEAD("x")}ecosystem: pip\n` }), "lib/x")).toThrow(
      GenerateError,
    );
    expect(() => loadProfile(dir({ x: `${HEAD("x")}languages: [cobol]\n` }), "lib/x")).toThrow(
      GenerateError,
    );
  });

  it("maven で、座標でないパッケージ名はエラー", () => {
    for (const name of ["demo-lib", "a..b:lib", "com.example:..", "com.example:a/b"]) {
      const yaml = `${HEAD("x")}ecosystem: maven\npackages: ["${name}"]\nunverified: ["${name}"]\n`;
      expect(() => loadProfile(dir({ x: yaml }), "lib/x")).toThrow(GenerateError);
    }
  });

  it("maven で、npm のための項目（dev_packages・package_json・wrangler・range_causes など）はエラー", () => {
    const extras = [
      'dev_packages: ["com.example:demo-test"]\n',
      "package_json: { scripts: { a: b } }\n",
      "package_json_when: []\n",
      "wrangler: { name: a }\n",
      "wrangler_when: []\n",
      'range_causes:\n  "com.example:demo-lib": { package: "com.example:demo-lib", kind: self }\n',
    ];
    for (const extra of extras) expect(() => withExtra(extra)).toThrow(GenerateError);
  });

  it("maven の範囲は「>=X <Y」だけ。検証済みが範囲に合わなければエラー。java は packages になくても書ける", () => {
    const bad = (range: string) => loadJvm(JVM.replace('">=1.0 <2.0"', `"${range}"`));
    for (const range of ["^1", ">=1.0", ">=2.0 <1.0", "[1.0,2.0)"]) {
      expect(() => bad(range)).toThrow(GenerateError);
    }
    expect(() => bad(">=1.0 <1.5")).toThrow(GenerateError); // 検証済み 1.9.0 が範囲の外
    expect(() => loadJvm(JVM.replace("  java:", "  unknown-thing:"))).toThrow(GenerateError);
  });

  it("maven の検証済みの版が試験版ならエラー", () => {
    expect(() => loadJvm(JVM.replace('"1.9.0"', '"2.0.0-RC1"'))).toThrow(GenerateError);
  });
});

describe("#39 AC-2: 調べる対象（buildTargets）", () => {
  it("maven のプロファイルがあるとき、Node.js の次に Java、続いて依存。Java の検証済みは data/runtimes.yaml の 25", () => {
    const targets = buildTargets([loadJvm()], baseAnswers());
    expect(targets.map((t) => [t.kind, t.name])).toEqual([
      ["node", "node"],
      ["java", "java"],
      ["maven", "com.example:demo-lib"],
      ["maven", "com.example:demo-test"],
    ]);
    expect(targets[1]).toMatchObject({
      verified: "25",
      range: ">=21 <27",
      profiles: ["lib/example-jvm"],
    });
    expect(targets[2]).toMatchObject({ verified: "1.9.0", range: ">=1.0 <2.0" });
  });

  it("maven のプロファイルがなければ、Java の対象は出ない（実際の構成は Node.js から始まり、java を含まない）", () => {
    const real = targetsFor(baseAnswers());
    expect(real[0]?.kind).toBe("node");
    expect(real.some((t) => t.kind === "java" || t.kind === "maven")).toBe(false);
    expect(real.every((t) => t.kind === "node" || t.kind === "npm")).toBe(true);
  });

  it("複数の maven のプロファイルの範囲は交わりにする。交わりが空ならエラー", () => {
    const other = (range: string) =>
      `${HEAD("other")}ecosystem: maven\npackages: ["com.example:other-lib"]\nunverified: ["com.example:other-lib"]\nversion_ranges:\n  java: "${range}"\n`;
    const make = (range: string) => {
      const d = dir({ "example-jvm": JVM, other: other(range) });
      return [loadProfile(d, "lib/example-jvm"), loadProfile(d, "lib/other")];
    };
    const java = buildTargets(make(">=17 <26"), baseAnswers()).find((t) => t.kind === "java");
    expect(java?.range).toBe(">=21 <26");
    expect(() => buildTargets(make(">=17 <21"), baseAnswers())).toThrow(GenerateError);
  });

  it("同じ名前が別のエコシステムに出たらエラー", () => {
    const d = dir({
      "example-jvm": JVM,
      npmside: `${HEAD("npmside")}packages: ["com.example:demo-lib"]\nunverified: ["com.example:demo-lib"]\n`,
    });
    // npm のプロファイルは名前の形を検査しないため、読み込みは通り、対象を作るところで止まる
    const profiles = [loadProfile(d, "lib/example-jvm"), loadProfile(d, "lib/npmside")];
    expect(() => buildTargets(profiles, baseAnswers())).toThrow(GenerateError);
  });

  it("maven の依存の検証済みがなく unverified にもなければエラー", () => {
    const yaml = `${HEAD("x")}ecosystem: maven\npackages: ["com.example:demo-lib"]\n`;
    const p = loadProfile(dir({ x: yaml }), "lib/x");
    expect(() => buildTargets([p], baseAnswers())).toThrow(GenerateError);
  });
});

const entry = (name: string, version: string): VersionEntry => ({
  name,
  version,
  reason: "ハーネス検証済み",
  surveyedOn: FIXED_DAY,
  latestStable: null,
  latestStatus: "failed",
  verified: version,
  newerThanVerified: false,
  majorDiffers: false,
});

describe("#39 AC-2: 各所の扱い", () => {
  it("範囲の見直し（range-review）は、maven・java の対象を飛ばす", () => {
    const profiles = [loadJvm()];
    expect(rangeTargets(profiles, buildTargets(profiles, baseAnswers()))).toEqual([]);
  });

  it("package.json は npm のものだけ。maven の依存は入らない", async () => {
    const answers = await completeAnswers({ app_name: "testapp-001", database: "d1" });
    const result: VersionResult = {
      entries: [entry("node", "24.19.0"), entry("com.example:demo-lib", "1.9.0")],
      newerThanVerified: false,
    };
    const pkg = buildPackageJson({
      appName: "testapp-001",
      answers,
      profiles: [loadJvm()],
      versions: result,
    });
    expect(pkg["dependencies"]).toBeUndefined();
    expect(pkg["devDependencies"]).toBeUndefined();
  });

  it("tech-stack.md の説明文は、maven のプロファイルがあるときだけ変わる", () => {
    const result: VersionResult = { entries: [entry("node", "24.19.0")], newerThanVerified: false };
    const plain = renderTechStack(result, [{ key: "a/b", name: "B", compatibilityNotes: [] }]);
    expect(plain).toContain("バージョンは、npm と Node.js の登録情報を調べて決めています。");
    const maven = renderTechStack(result, [loadJvm()]);
    expect(maven).toContain("Maven Central");
    expect(maven).toContain("Adoptium");
  });

  it("harness status：Maven の依存と Java の、新しい大きな版を探す", async () => {
    const f = fakeMaven({
      maven: {
        "com.example:demo-lib": metadataXml("com.example", "demo-lib", [
          "1.9.0",
          "2.0.0",
          "3.0.0-RC1",
        ]),
      },
      java: { available_lts_releases: [21, 25, 29] },
    });
    const out = await checkMajorUpdates(
      [entry("java", "25"), entry("com.example:demo-lib", "1.9.0")],
      f.fn,
    );
    expect(out).toEqual({
      status: "ok",
      updates: [
        { name: "java", adopted: "25", latest: "29" },
        { name: "com.example:demo-lib", adopted: "1.9.0", latest: "2.0.0" },
      ],
      skipped: [],
    });
  });
});
