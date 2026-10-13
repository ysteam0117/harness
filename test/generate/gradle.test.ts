// #39 PR-B：Gradle のビルドファイルの生成。架空のプロファイル（test/generate/fixtures/jvm-profiles/jvm/example-jvm）を使う。
// 本物のネットワークにはつながない。
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildGradle } from "../../src/generate/gradle.js";
import { buildProject } from "../../src/generate/project.js";
import { loadProfile, resolveProfiles } from "../../src/generate/profile.js";
import type { VersionEntry, VersionResult } from "../../src/versions/choose.js";
import { selectProfiles } from "../../src/versions/profile-selection.js";
import { FIXED_DAY, FIXED_NOW } from "../versions/helpers.js";
import {
  cleanupProjectTmp,
  completeAnswers,
  contentOf,
  copyRealTemplates,
  pathsOf,
  surveyVersions,
} from "./project-helpers.js";

const FIXTURE = path.resolve("test/generate/fixtures/jvm-profiles/jvm/example-jvm");
const KEY = "jvm/example-jvm";

afterEach(cleanupProjectTmp);

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

const JVM_ENTRIES = [
  entry("java", "25"),
  entry("com.example:demo-lib", "1.2.3"),
  entry("com.example:Demo_Util", "2.0"),
  entry("com.example:demo-test", "3.1.0"),
  entry("com.example:demo-extra", "0.9.0"),
];

/** 実際のひな形に、架空の JVM のプロファイルを足した一時のひな形 */
function templatesWithJvm(edit?: (yaml: string) => string): string {
  const dir = copyRealTemplates();
  const dest = path.join(dir, "profiles", "jvm", "example-jvm");
  cpSync(FIXTURE, dest, { recursive: true });
  if (edit !== undefined) {
    const file = path.join(dest, "profile.yaml");
    writeFileSync(file, edit(readFileSync(file, "utf8")));
  }
  return dir;
}

const result = (entries: VersionEntry[]): VersionResult => ({ entries, newerThanVerified: false });

describe("buildGradle", () => {
  it("maven のプロファイルがなければ、何も足さない", async () => {
    const answers = await completeAnswers();
    const profiles = resolveProfiles(templatesWithJvm(), selectProfiles(answers));
    expect(
      buildGradle({ profiles, answers, versions: await surveyVersions(answers), appName: "x" }),
    ).toBeUndefined();
  });

  it("settings.gradle.kts と libs.versions.toml を出し、値を渡す", async () => {
    const answers = await completeAnswers({ database: "none" });
    const profiles = resolveProfiles(templatesWithJvm(), [KEY]);
    const out = buildGradle({
      profiles,
      answers,
      versions: result(JVM_ENTRIES),
      appName: "demo app",
    });
    expect(out).toBeDefined();
    const files = out?.files ?? [];
    expect(pathsOf(files)).toEqual([
      "backend/settings.gradle.kts",
      "backend/gradle/libs.versions.toml",
    ]);
    const settings = contentOf(files, "backend/settings.gradle.kts");
    expect(settings).toContain("pluginManagement {");
    expect(settings).toContain("dependencyResolutionManagement {");
    expect(settings.match(/mavenCentral\(\)/g)).toHaveLength(2);
    expect(settings).toContain('rootProject.name = "demo-app"');
    expect(contentOf(files, "backend/gradle/libs.versions.toml")).toBe(
      [
        "[versions]",
        'demo-lib = "1.2.3"',
        'demo-testing = "3.1.0"',
        'demo-util = "2.0"',
        "",
        "[libraries]",
        'demo-lib = { module = "com.example:demo-lib", version.ref = "demo-lib" }',
        'demo-testing = { module = "com.example:demo-test", version.ref = "demo-testing" }',
        'demo-util = { module = "com.example:Demo_Util", version.ref = "demo-util" }',
        "",
        "[plugins]",
        "",
      ].join("\n"),
    );
    expect(out?.values).toEqual({
      gradle_plugins: "",
      gradle_dependencies:
        "    implementation(libs.demo.lib)\n    implementation(libs.demo.util)\n    testImplementation(libs.demo.testing)",
      gradle_check_tasks: 'tasks.named("check") {\n    dependsOn("spotlessCheck", "test")\n}',
      java_version: "25",
    });
  });

  it("回答に合う packages_when の座標だけを入れる", async () => {
    const answers = await completeAnswers({ database: "d1" });
    const profiles = resolveProfiles(templatesWithJvm(), [KEY]);
    const out = buildGradle({ profiles, answers, versions: result(JVM_ENTRIES), appName: "a" });
    expect(contentOf(out?.files ?? [], "backend/gradle/libs.versions.toml")).toContain(
      'demo-extra = { module = "com.example:demo-extra"',
    );
    expect(out?.values["gradle_dependencies"]).toContain("libs.demo.extra");
  });

  it("同じ入力なら、同じ出力になる", async () => {
    const answers = await completeAnswers();
    const profiles = resolveProfiles(templatesWithJvm(), [KEY]);
    const run = () =>
      buildGradle({ profiles, answers, versions: result(JVM_ENTRIES), appName: "a" });
    expect(run()).toEqual(run());
  });

  it("選んだ版に無い座標は、エラーにする", async () => {
    const answers = await completeAnswers({ database: "none" });
    const profiles = resolveProfiles(templatesWithJvm(), [KEY]);
    const versions = result(JVM_ENTRIES.filter((e) => e.name !== "com.example:demo-lib"));
    expect(() => buildGradle({ profiles, answers, versions, appName: "a" })).toThrow(
      /com\.example:demo-lib の版が、選んだ版にありません/,
    );
  });

  it("Java の版が、選んだ版に無ければエラーにする", async () => {
    const answers = await completeAnswers({ database: "none" });
    const profiles = resolveProfiles(templatesWithJvm(), [KEY]);
    const versions = result(JVM_ENTRIES.filter((e) => e.name !== "java"));
    expect(() => buildGradle({ profiles, answers, versions, appName: "a" })).toThrow(
      /Java の版が、選んだ版にありません/,
    );
  });

  it("別名が重なったら、エラーにする", async () => {
    const answers = await completeAnswers({ database: "none" });
    const dir = templatesWithJvm((yaml) =>
      yaml.replace("demo-test: demo-testing", "demo-test: demo-lib"),
    );
    const profiles = resolveProfiles(dir, [KEY]);
    expect(() =>
      buildGradle({ profiles, answers, versions: result(JVM_ENTRIES), appName: "a" }),
    ).toThrow(/別名 demo-lib が、.* で重なっています/);
  });

  it("区切り（-・_・.）だけが違う別名も、Gradle では同じ名前になるので、エラーにする", async () => {
    const answers = await completeAnswers({ database: "none" });
    const dir = templatesWithJvm((yaml) =>
      yaml.replace("demo-test: demo-testing", "demo-test: demo_lib"),
    );
    const profiles = resolveProfiles(dir, [KEY]);
    expect(() =>
      buildGradle({ profiles, answers, versions: result(JVM_ENTRIES), appName: "a" }),
    ).toThrow(/別名 demo_lib が、.* で重なっています/);
  });

  it("Gradle のカタログで使えない別名（予約語・先頭が数字・versions で始まる）は、既定でも明示でもエラーにする", async () => {
    const answers = await completeAnswers({ database: "none" });
    const run = (from: string, to: string) =>
      buildGradle({
        profiles: resolveProfiles(
          templatesWithJvm((y) => y.replace(from, to)),
          [KEY],
        ),
        answers,
        versions: result(JVM_ENTRIES),
        appName: "a",
      });
    expect(() => run("demo-test: demo-testing", "demo-test: class")).toThrow(/別名 class/);
    expect(() => run("demo-test: demo-testing", "demo-test: versions-demo")).toThrow(
      /別名 versions-demo/,
    );
    expect(() => run("demo-test: demo-testing", "demo-test: 1demo")).toThrow(/1demo/);
    // 既定の別名（artifact 名から作る）が使えない名前になる座標
    const renamed = resolveProfiles(
      templatesWithJvm((y) =>
        y
          .replace("com.example:demo-test: demo-testing", "com.example:demo-lib: demo-lib")
          .replaceAll("com.example:demo-test", "com.example:123lib"),
      ),
      [KEY],
    );
    const entries = JVM_ENTRIES.map((e) =>
      e.name === "com.example:demo-test" ? { ...e, name: "com.example:123lib" } : e,
    );
    expect(() =>
      buildGradle({ profiles: renamed, answers, versions: result(entries), appName: "a" }),
    ).toThrow(/別名 123lib/);
  });

  it("別のプロファイルが同じ座標を使っていても、回答に合わない条件つきの座標は、そのプロファイルの種類に足さない", async () => {
    const answers = await completeAnswers({ database: "none" });
    const [base] = resolveProfiles(templatesWithJvm(), [KEY]);
    if (base === undefined) throw new Error("プロファイルがありません");
    const other = {
      ...base,
      id: "other-jvm",
      packages: ["com.example:demo-extra"],
      packagesWhen: [],
      gradle: {
        ...base.gradle,
        aliases: {},
        configurations: { testImplementation: ["com.example:demo-extra"] },
      },
    };
    const out = buildGradle({
      profiles: [base, other],
      answers,
      versions: result(JVM_ENTRIES),
      appName: "a",
    });
    const build = out?.values.gradle_dependencies ?? "";
    // base の条件つきの implementation には出ない。other の testImplementation にだけ出る
    expect(build).not.toContain("implementation(libs.demo.extra)\n    testImplementation");
    expect(build.split("\n").filter((l) => l.includes("demo.extra"))).toEqual([
      "    testImplementation(libs.demo.extra)",
    ]);
  });
});

describe("profile.yaml の gradle", () => {
  it("読み込める", () => {
    const profile = loadProfile(templatesWithJvm(), KEY);
    expect(profile.gradle.checkTasks).toEqual(["spotlessCheck", "test"]);
    expect(profile.gradle.aliases).toEqual({ "com.example:demo-test": "demo-testing" });
  });

  it("ecosystem が npm のプロファイルに書いたら、エラーにする", () => {
    const dir = templatesWithJvm((yaml) => yaml.replace("ecosystem: maven\n", ""));
    expect(() => loadProfile(dir, KEY)).toThrow(/gradle は、ecosystem が maven のときだけ/);
  });

  it("packages にない座標・知らない項目・誤った別名は、エラーにする", () => {
    const bad = (from: string, to: string) =>
      loadProfile(
        templatesWithJvm((y) => y.replace(from, to)),
        KEY,
      );
    expect(() => bad("com.example:demo-test: demo-testing", "com.example:none: x")).toThrow(
      /gradle\.aliases の com\.example:none/,
    );
    expect(() => bad("  check_tasks: [spotlessCheck, test]", "  other: 1")).toThrow(
      /gradle に、知らない項目 other/,
    );
    expect(() => bad("demo-testing", "Bad Alias")).toThrow(/別名 "Bad Alias"/);
    expect(() => bad("[spotlessCheck, test]", "[bad task]")).toThrow(/check_tasks/);
  });
});

describe("buildProject の Gradle", () => {
  async function project(withJvm: boolean, edit?: (yaml: string) => string) {
    const answers = await completeAnswers();
    const base = await surveyVersions(answers);
    const templatesDir = templatesWithJvm(edit);
    return buildProject({
      answers,
      acceptedWarnings: [],
      versions: withJvm ? result([...base.entries, ...JVM_ENTRIES]) : base,
      now: FIXED_NOW,
      templatesDir,
      profileKeys: withJvm ? [...selectProfiles(answers), KEY] : selectProfiles(answers),
    }).files;
  }

  it("3つのファイルを出し、build.gradle.kts に値を差し込む", async () => {
    const files = await project(true);
    expect(pathsOf(files)).toEqual(
      expect.arrayContaining([
        "backend/build.gradle.kts",
        "backend/settings.gradle.kts",
        "backend/gradle/libs.versions.toml",
      ]),
    );
    const build = contentOf(files, "backend/build.gradle.kts");
    expect(build).toContain("JavaLanguageVersion.of(25)");
    expect(build).toContain("    implementation(libs.demo.lib)");
    expect(build).toContain('dependsOn("spotlessCheck", "test")');
    expect(build).not.toContain("{{");
  });

  it("3つのファイルは、プロジェクトのもの（package.json と同じ）で、管理するファイル（F-27）に載らない", async () => {
    const files = await project(true);
    for (const p of [
      "backend/build.gradle.kts",
      "backend/settings.gradle.kts",
      "backend/gradle/libs.versions.toml",
    ]) {
      expect(files.find((f) => f.path === p)?.managed, p).toBe(false);
      expect(contentOf(files, ".harness/config.yaml"), p).not.toContain(p);
    }
  });

  it("Gradle Wrapper は出さない", async () => {
    const files = await project(true);
    expect(pathsOf(files).filter((p) => /gradlew|gradle-wrapper/.test(p))).toEqual([]);
  });

  it("README に Gradle の使い方（wrapper → check の順・実行する場所）を足す", async () => {
    const readme = contentOf(await project(true), "README.md");
    const section = readme.slice(readme.indexOf("## Gradle の使い方"));
    expect(section).toContain("`backend/` で `gradle wrapper` を1回実行");
    expect(section.indexOf("gradle wrapper")).toBeLessThan(section.indexOf("./gradlew check"));
    expect(section).toContain("gradlew.bat");
    expect(readme.indexOf("## Gradle の使い方")).toBeLessThan(
      readme.indexOf("## リポジトリの用意"),
    );
  });

  it("maven のプロファイルがなければ、README も出力も変わらない", async () => {
    const files = await project(false);
    expect(contentOf(files, "README.md")).not.toContain("Gradle");
    expect(
      pathsOf(files).filter((p) => p.endsWith(".gradle.kts") || p.endsWith("libs.versions.toml")),
    ).toEqual([]);
  });

  it("プロファイルの files に build.gradle.kts がなければ、エラーにする", async () => {
    await expect(
      project(true, (y) => y.replace("files/build.gradle.kts: backend/build.gradle.kts", "{}")),
    ).rejects.toThrow(/build\.gradle\.kts がありません|files は/);
  });
});

// #40：gradle.plugins（プラグインのマーカー → [plugins]）と gradle.managed（版を BOM が決める依存）
const PLUGIN_MARKER = "com.example.demo:com.example.demo.gradle.plugin";
const MANAGED = "com.example:demo-managed";

/** example-jvm に、プラグイン（com.example.demo）と、版を BOM が決める依存を足す */
const withPluginAndManaged = (yaml: string): string =>
  yaml
    .replace("packages:\n", `packages:\n  - ${PLUGIN_MARKER}\n`)
    .replace("verified_versions:\n", `verified_versions:\n  ${PLUGIN_MARKER}: "4.1.1"\n`)
    .replace(
      "  aliases:\n",
      `  plugins:\n    com.example.demo: ${PLUGIN_MARKER}\n  managed: [${MANAGED}]\n  aliases:\n    ${PLUGIN_MARKER}: demo-plugin\n`,
    )
    .replace("    implementation:\n", `    implementation:\n      - ${MANAGED}\n`);

const PLUGIN_ENTRIES = [...JVM_ENTRIES, entry(PLUGIN_MARKER, "4.1.1")];

describe("gradle.plugins・gradle.managed（#40）", () => {
  it("プラグインを [plugins] に、BOM が決める依存を version なしで [libraries] に出す", async () => {
    const answers = await completeAnswers({ database: "none" });
    const profiles = resolveProfiles(templatesWithJvm(withPluginAndManaged), [KEY]);
    const out = buildGradle({ profiles, answers, versions: result(PLUGIN_ENTRIES), appName: "a" });
    const toml = contentOf(out?.files ?? [], "backend/gradle/libs.versions.toml");
    expect(toml).toBe(
      [
        "[versions]",
        'demo-lib = "1.2.3"',
        'demo-plugin = "4.1.1"',
        'demo-testing = "3.1.0"',
        'demo-util = "2.0"',
        "",
        "[libraries]",
        'demo-lib = { module = "com.example:demo-lib", version.ref = "demo-lib" }',
        'demo-managed = { module = "com.example:demo-managed" }',
        'demo-testing = { module = "com.example:demo-test", version.ref = "demo-testing" }',
        'demo-util = { module = "com.example:Demo_Util", version.ref = "demo-util" }',
        "",
        "[plugins]",
        'demo-plugin = { id = "com.example.demo", version.ref = "demo-plugin" }',
        "",
      ].join("\n"),
    );
    // プラグインのマーカーは [libraries] に入れない
    expect(toml).not.toContain("gradle.plugin");
    expect(out?.values["gradle_plugins"]).toBe("    alias(libs.plugins.demo.plugin)");
    expect(out?.values["gradle_dependencies"]).toContain("    implementation(libs.demo.managed)");
  });

  it("プラグインの別名を書かなければ、id の . を - にした名前にする", async () => {
    const answers = await completeAnswers({ database: "none" });
    const dir = templatesWithJvm((y) =>
      withPluginAndManaged(y).replace(`    ${PLUGIN_MARKER}: demo-plugin\n`, ""),
    );
    const out = buildGradle({
      profiles: resolveProfiles(dir, [KEY]),
      answers,
      versions: result(PLUGIN_ENTRIES),
      appName: "a",
    });
    expect(out?.values["gradle_plugins"]).toBe("    alias(libs.plugins.com.example.demo)");
    expect(contentOf(out?.files ?? [], "backend/gradle/libs.versions.toml")).toContain(
      'com-example-demo = { id = "com.example.demo", version.ref = "com-example-demo" }',
    );
  });

  it("マーカーの版が、選んだ版に無ければエラーにする。managed は版を調べない（選んだ版に無くてもよい）", async () => {
    const answers = await completeAnswers({ database: "none" });
    const profiles = resolveProfiles(templatesWithJvm(withPluginAndManaged), [KEY]);
    expect(() =>
      buildGradle({ profiles, answers, versions: result(JVM_ENTRIES), appName: "a" }),
    ).toThrow(/com\.example\.demo\.gradle\.plugin の版が、選んだ版にありません/);
    expect(() =>
      buildGradle({ profiles, answers, versions: result(PLUGIN_ENTRIES), appName: "a" }),
    ).not.toThrow();
  });

  it("別名が、プラグインとライブラリで重なったら、エラーにする", async () => {
    const answers = await completeAnswers({ database: "none" });
    const dir = templatesWithJvm((y) =>
      withPluginAndManaged(y).replace(
        `${PLUGIN_MARKER}: demo-plugin`,
        `${PLUGIN_MARKER}: demo-lib`,
      ),
    );
    expect(() =>
      buildGradle({
        profiles: resolveProfiles(dir, [KEY]),
        answers,
        versions: result(PLUGIN_ENTRIES),
        appName: "a",
      }),
    ).toThrow(/別名 demo-lib が、.* で重なっています/);
  });

  it("読み込める（plugins・managed）", () => {
    const profile = loadProfile(templatesWithJvm(withPluginAndManaged), KEY);
    expect(profile.gradle.plugins).toEqual({ "com.example.demo": PLUGIN_MARKER });
    expect(profile.gradle.managed).toEqual([MANAGED]);
  });

  it("managed と packages の両方に書いたら、エラーにする", () => {
    const dir = templatesWithJvm((y) =>
      withPluginAndManaged(y).replace(`managed: [${MANAGED}]`, "managed: [com.example:demo-lib]"),
    );
    expect(() => loadProfile(dir, KEY)).toThrow(
      /gradle\.managed の com\.example:demo-lib が、packages（または packages_when）にも書かれています/,
    );
  });

  it("managed が group:artifact の形でなければ、エラーにする", () => {
    const dir = templatesWithJvm((y) =>
      withPluginAndManaged(y).replace(`managed: [${MANAGED}]`, "managed: [not-a-coordinate]"),
    );
    expect(() => loadProfile(dir, KEY)).toThrow(/gradle\.managed は「group:artifact」の形/);
  });

  it("プラグインのマーカーを configurations に書いたら、エラーにする", () => {
    const dir = templatesWithJvm((y) =>
      withPluginAndManaged(y).replace(
        "    implementation:\n",
        `    implementation:\n      - ${PLUGIN_MARKER}\n`,
      ),
    );
    expect(() => loadProfile(dir, KEY)).toThrow(/プラグインのマーカーです/);
  });

  it("plugins のマーカーが packages に無ければ、エラーにする", () => {
    const dir = templatesWithJvm((y) =>
      withPluginAndManaged(y).replace(`packages:\n  - ${PLUGIN_MARKER}\n`, "packages:\n"),
    );
    expect(() => loadProfile(dir, KEY)).toThrow(/gradle\.plugins の com\.example\.demo のマーカー/);
  });

  it("plugins の id の形が誤っていたら、エラーにする", () => {
    const dir = templatesWithJvm((y) =>
      withPluginAndManaged(y).replace("    com.example.demo: ", '    "bad id": '),
    );
    expect(() => loadProfile(dir, KEY)).toThrow(/gradle\.plugins の id "bad id"/);
  });

  it("managed を aliases に書ける。どこにも無い座標は、エラーにする", () => {
    const ok = templatesWithJvm((y) =>
      withPluginAndManaged(y).replace("  aliases:\n", `  aliases:\n    ${MANAGED}: managed-lib\n`),
    );
    expect(loadProfile(ok, KEY).gradle.aliases[MANAGED]).toBe("managed-lib");
    const bad = templatesWithJvm((y) =>
      withPluginAndManaged(y).replace("  aliases:\n", "  aliases:\n    com.example:none: x\n"),
    );
    expect(() => loadProfile(bad, KEY)).toThrow(/gradle\.aliases の com\.example:none/);
  });

  it("ecosystem が npm のプロファイルに gradle.plugins を書いたら、エラーにする", () => {
    const dir = templatesWithJvm((y) => withPluginAndManaged(y).replace("ecosystem: maven\n", ""));
    expect(() => loadProfile(dir, KEY)).toThrow(/gradle は、ecosystem が maven のときだけ/);
  });
});
