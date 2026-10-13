import type { Answers } from "../questions/answers.js";
import type { VersionResult } from "../versions/choose.js";
import { JAVA_TARGET_NAME } from "../versions/ecosystem.js";
import { wantedPackages } from "../versions/targets.js";
import { GenerateError } from "./errors.js";
import type { Profile } from "./profile.js";
import { toToml, tomlString } from "./toml.js";

/** Gradle のビルドファイルを置くフォルダ（backend/） */
export const GRADLE_DIR = "backend";

export interface BuildGradleInput {
  /** 選んだプロファイル（maven のものだけを使う） */
  profiles: Profile[];
  /** configurations などの条件（packages_when）に使う回答 */
  answers: Answers;
  /** 選んだ版。"java" の項目が Java の版、"group:artifact" の項目が依存の版 */
  versions: VersionResult;
  /** settings.gradle.kts の rootProject.name に使う名前 */
  appName: string;
}

export interface GradleOutput {
  /** backend/ に出す生成ファイル（settings.gradle.kts・gradle/libs.versions.toml） */
  files: { path: string; content: string }[];
  /** プロファイルの build.gradle.kts のひな形に差し込む値 */
  values: Record<string, string>;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 座標の既定の別名：artifact 名を小文字にして、. と _ を - にする */
function defaultAlias(coordinate: string): string {
  const artifact = coordinate.slice(coordinate.indexOf(":") + 1);
  return artifact.toLowerCase().replace(/[._]/g, "-");
}

/** Gradle のバージョンカタログが受け付けない名前（予約語、先頭が bundles・versions・plugins、先頭が小文字の英字でない、使えない文字） */
function assertCatalogAlias(alias: string, coordinate: string): void {
  const reserved = ["class", "convention", "extensions"];
  const bad =
    !/^[a-z][a-zA-Z0-9_.-]*$/.test(alias) ||
    reserved.includes(alias) ||
    /^(bundles|versions|plugins)([-_.]|$)/.test(alias);
  if (bad) {
    throw new GenerateError(
      `libs.versions.toml の別名 ${alias}（${coordinate}）は、Gradle のバージョンカタログで使えません（小文字の英字で始め、class・extensions・convention や bundles・versions・plugins で始まる名前は避けて、gradle.aliases で別名を付けてください）`,
    );
  }
}

/** Java の版（大きな版の数字）。toolchain の languageVersion に使う */
function javaMajor(versions: VersionResult): string {
  const entry = versions.entries.find((e) => e.name === JAVA_TARGET_NAME);
  const major = entry === undefined ? undefined : /^\d+/.exec(entry.version)?.[0];
  if (major === undefined) {
    throw new GenerateError("build.gradle.kts に使う Java の版が、選んだ版にありません");
  }
  return major;
}

/** rootProject.name に入れられる名前にする（Kotlin の文字列に入れるため、英数字・. ・_ ・- 以外は - にする） */
function projectName(appName: string): string {
  const name = appName.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  return name === "" ? "app" : name;
}

/** maven のプロファイルが1つもなければ undefined（何も足さない） */
export function buildGradle(input: BuildGradleInput): GradleOutput | undefined {
  const { answers, versions } = input;
  const profiles = input.profiles.filter((p) => p.ecosystem === "maven");
  if (profiles.length === 0) return undefined;

  const adopted = new Map<string, string>();
  for (const entry of versions.entries) adopted.set(entry.name, entry.version);

  // 座標 → 別名（回答に合う座標だけ）。別名が重なったらエラー
  const aliasOf = new Map<string, string>();
  const ownerOf = new Map<string, string>();
  for (const profile of profiles) {
    for (const coordinate of wantedPackages(profile, answers)) {
      if (aliasOf.has(coordinate)) continue;
      const alias = profile.gradle.aliases[coordinate] ?? defaultAlias(coordinate);
      assertCatalogAlias(alias, coordinate);
      // Gradle は -・_・. を同じ区切りとして扱うので、区切りをそろえた名前で重なりを調べる
      const key = alias.replace(/[-_]/g, ".");
      const other = ownerOf.get(key);
      if (other !== undefined && other !== coordinate) {
        throw new GenerateError(
          `libs.versions.toml の別名 ${alias} が、${other} と ${coordinate} で重なっています（gradle.aliases で別名を分けてください）`,
        );
      }
      ownerOf.set(key, coordinate);
      aliasOf.set(coordinate, alias);
    }
  }

  const libraries: { alias: string; module: string; version: string }[] = [];
  for (const [coordinate, alias] of aliasOf) {
    const version = adopted.get(coordinate);
    if (version === undefined) {
      throw new GenerateError(
        `依存 ${coordinate} の版が、選んだ版にありません（libs.versions.toml に入れられません）`,
      );
    }
    libraries.push({ alias, module: coordinate, version });
  }
  libraries.sort((a, b) => compare(a.alias, b.alias));

  // 依存の種類ごとの行。種類は名前の昇順、座標は別名の昇順（同じ入力なら同じ出力）。回答に合わない座標は飛ばす
  const configurations = new Map<string, Set<string>>();
  const checkTasks = new Set<string>();
  for (const profile of profiles) {
    // 別のプロファイルが同じ座標を使っていても、このプロファイルの回答に合わない座標は足さない
    const wanted = new Set(wantedPackages(profile, answers));
    for (const [configuration, coordinates] of Object.entries(profile.gradle.configurations)) {
      for (const coordinate of coordinates) {
        const alias = aliasOf.get(coordinate);
        if (alias === undefined || !wanted.has(coordinate)) continue;
        const set = configurations.get(configuration) ?? new Set<string>();
        set.add(alias);
        configurations.set(configuration, set);
      }
    }
    for (const task of profile.gradle.checkTasks) checkTasks.add(task);
  }
  const dependencies = [...configurations.keys()]
    .sort(compare)
    .flatMap((configuration) =>
      [...(configurations.get(configuration) ?? [])]
        .sort(compare)
        .map((alias) => `    ${configuration}(libs.${alias.replace(/[-_]/g, ".")})`),
    );
  const tasks = [...checkTasks].sort(compare);

  const catalog = [
    "[versions]",
    toToml(libraries.map((l): [string, string] => [l.alias, l.version])).trimEnd(),
    "",
    "[libraries]",
    ...libraries.map(
      (l) =>
        `${l.alias} = { module = ${tomlString(l.module)}, version.ref = ${tomlString(l.alias)} }`,
    ),
    "",
    "[plugins]",
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");

  const settings = [
    "pluginManagement {",
    "    repositories {",
    "        mavenCentral()",
    "    }",
    "}",
    "",
    "dependencyResolutionManagement {",
    "    repositories {",
    "        mavenCentral()",
    "    }",
    "}",
    "",
    `rootProject.name = ${JSON.stringify(projectName(input.appName))}`,
  ].join("\n");

  return {
    files: [
      { path: `${GRADLE_DIR}/settings.gradle.kts`, content: `${settings}\n` },
      { path: `${GRADLE_DIR}/gradle/libs.versions.toml`, content: `${catalog}\n` },
    ],
    values: {
      gradle_dependencies: dependencies.join("\n"),
      gradle_check_tasks:
        tasks.length === 0
          ? ""
          : `tasks.named("check") {\n    dependsOn(${tasks.map((t) => JSON.stringify(t)).join(", ")})\n}`,
      java_version: javaMajor(versions),
    },
  };
}
