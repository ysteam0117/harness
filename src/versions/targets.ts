import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { minVersion, Range, satisfies, valid } from "semver";
import { parse as parseYaml } from "yaml";
import { GenerateError } from "../generate/errors.js";
import { resolveProfiles, type Profile } from "../generate/profile.js";
import { findTemplatesDir } from "../generate/templates-dir.js";
import type { Answers } from "../questions/answers.js";
import { JAVA_TARGET_NAME, type Ecosystem } from "./ecosystem.js";
import {
  intersectMavenRanges,
  parseMavenRange,
  parseMavenVersion,
  satisfiesMavenRange,
} from "./maven-version.js";
import { selectProfiles } from "./profile-selection.js";

/** バージョンを調べる対象（Node.js・npm のパッケージ・Java・Maven の依存） */
export interface Target {
  kind: "npm" | "node" | "maven" | "java";
  /** npm のパッケージ名。Node.js は "node"。Maven の依存は "group:artifact"。Java は "java" */
  name: string;
  /** 検証済みの版。unverified のときは無い */
  verified?: string;
  /** 範囲（複数のプロファイルの範囲は交わり）。npm・node は semver、maven・java は「>=X <Y」。無ければ範囲なし */
  range?: string;
  /** 検証済みのないパッケージ */
  unverified: boolean;
  /** このパッケージを持つプロファイルの key（Node.js は []。Java は、その範囲を書いたプロファイル） */
  profiles: string[];
}

/** 対象が使う版の規則（node は npm、java は maven と同じ扱い） */
export function ecosystemOf(kind: Target["kind"]): Ecosystem {
  return kind === "maven" || kind === "java" ? "maven" : "npm";
}

export const NODE_TARGET_NAME = "node";

function readRuntimes(): Record<string, unknown> {
  const file = fileURLToPath(new URL("../../data/runtimes.yaml", import.meta.url));
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(file, "utf8"));
  } catch (e) {
    throw new GenerateError(`data/runtimes.yaml を読めません：${file}（${(e as Error).message}）`, {
      cause: e,
    });
  }
  return (doc ?? {}) as Record<string, unknown>;
}

/** data/runtimes.yaml の node.verified を読む */
function loadNodeVerified(): string {
  const node = readRuntimes()["node"] as { verified?: unknown; policy?: unknown } | undefined;
  if (typeof node?.verified !== "string" || valid(node.verified) === null) {
    throw new GenerateError("data/runtimes.yaml：node.verified に、検証済みの版を書いてください");
  }
  if (node.policy !== "lts") {
    throw new GenerateError("data/runtimes.yaml：node.policy は lts だけ書けます");
  }
  return node.verified;
}

/** data/runtimes.yaml の java.verified（Java の大きな版。例 "25"）を読む */
function loadJavaVerified(): string {
  const java = readRuntimes()["java"] as { verified?: unknown; policy?: unknown } | undefined;
  if (
    typeof java?.verified !== "string" ||
    !/^[1-9]\d*$/.test(java.verified) ||
    parseMavenVersion(java.verified) === undefined
  ) {
    throw new GenerateError(
      "data/runtimes.yaml：java.verified に、検証済みの大きな版（例：25）を書いてください",
    );
  }
  if (java.policy !== "lts") {
    throw new GenerateError("data/runtimes.yaml：java.policy は lts だけ書けます");
  }
  return java.verified;
}

/** 2つの範囲の交わり（両方に合う版だけが合う範囲）。「||」で分けた組ごとの積にする */
function intersectRanges(a: string, b: string): string {
  const sets = (r: string): string[][] =>
    new Range(r).set.map((comparators) => comparators.map((c) => c.value).filter((v) => v !== ""));
  const joined = sets(a).flatMap((x) => sets(b).map((y) => [...x, ...y].join(" ")));
  return joined.join(" || ");
}

export function wantedPackages(profile: Profile, answers: Partial<Answers>): string[] {
  const record = answers as Readonly<Record<string, unknown>>;
  const names = [...profile.packages];
  for (const entry of profile.packagesWhen) {
    if (Object.entries(entry.when).every(([id, value]) => record[id] === value)) {
      names.push(...entry.packages);
    }
  }
  return names;
}

/** 選んだプロファイルから、調べる対象の一覧を作る。先頭は Node.js（maven のプロファイルがあれば、次に Java） */
export function buildTargets(profiles: Profile[], answers: Partial<Answers>): Target[] {
  const targets: Target[] = [
    {
      kind: "node",
      name: NODE_TARGET_NAME,
      verified: loadNodeVerified(),
      unverified: false,
      profiles: [],
    },
  ];
  const byName = new Map<string, Target>();
  const listedUnverified = new Set<string>();

  // Java は、maven のプロファイルがあるときだけ（Node.js の次に置く）
  const mavenProfiles = profiles.filter((p) => p.ecosystem === "maven");
  if (mavenProfiles.length > 0) {
    const java: Target = {
      kind: "java",
      name: JAVA_TARGET_NAME,
      verified: loadJavaVerified(),
      unverified: false,
      profiles: [],
    };
    for (const profile of mavenProfiles) {
      const range = profile.versionRanges[JAVA_TARGET_NAME];
      if (range === undefined) continue;
      java.profiles.push(profile.key);
      if (java.range === undefined) {
        java.range = range;
        continue;
      }
      const merged = intersectMavenRanges(java.range, range);
      if (merged === undefined) {
        throw new GenerateError(
          `Java の範囲が、プロファイル同士で食い違い、合う版がありません（${java.range} と ${range}）`,
        );
      }
      java.range = merged;
    }
    if (java.range !== undefined && !satisfiesMavenRange(java.verified ?? "", java.range)) {
      throw new GenerateError(
        `Java の検証済みの版 ${java.verified ?? ""} が、範囲 ${java.range} に合いません`,
      );
    }
    targets.push(java);
  }

  for (const profile of profiles) {
    const kind = profile.ecosystem === "maven" ? "maven" : "npm";
    for (const name of wantedPackages(profile, answers)) {
      let target = byName.get(name);
      if (target && target.kind !== kind) {
        throw new GenerateError(
          `パッケージ ${name} が、別のエコシステム（npm と maven）のプロファイルに、どちらにも書かれています`,
        );
      }
      if (!target) {
        if (name === JAVA_TARGET_NAME) {
          throw new GenerateError(`パッケージ名 ${name} は、Java の版を示す名前のため、使えません`);
        }
        target = { kind, name, unverified: false, profiles: [] };
        byName.set(name, target);
        targets.push(target);
      }
      if (!target.profiles.includes(profile.key)) target.profiles.push(profile.key);

      const verified = profile.verifiedVersions[name];
      if (verified !== undefined) {
        if (target.verified !== undefined && target.verified !== verified) {
          throw new GenerateError(
            `パッケージ ${name} の検証済みの版が、プロファイル同士で食い違っています（${target.verified} と ${verified}）`,
          );
        }
        target.verified = verified;
      }
      if (profile.unverified.includes(name)) listedUnverified.add(name);

      const range = profile.versionRanges[name];
      if (range !== undefined) {
        if (kind === "maven") {
          const merged =
            target.range === undefined ? range : intersectMavenRanges(target.range, range);
          if (merged === undefined || parseMavenRange(merged) === undefined) {
            throw new GenerateError(
              `パッケージ ${name} の範囲が、プロファイル同士で食い違い、合う版がありません（${target.range ?? range}）`,
            );
          }
          target.range = merged;
        } else {
          target.range = target.range === undefined ? range : intersectRanges(target.range, range);
          if (minVersion(target.range) === null) {
            throw new GenerateError(
              `パッケージ ${name} の範囲が、プロファイル同士で食い違い、合う版がありません（${target.range}）`,
            );
          }
        }
      }
    }
  }

  for (const target of byName.values()) {
    if (target.verified === undefined) {
      if (!listedUnverified.has(target.name)) {
        throw new GenerateError(
          `パッケージ ${target.name} に検証済みの版がありません（プロファイル ${target.profiles.join("・")} の verified_versions に書くか、unverified に書いてください）`,
        );
      }
      target.unverified = true;
    } else if (
      target.range !== undefined &&
      !(target.kind === "maven"
        ? satisfiesMavenRange(target.verified, target.range)
        : satisfies(target.verified, target.range))
    ) {
      throw new GenerateError(
        `パッケージ ${target.name} の検証済みの版 ${target.verified} が、範囲 ${target.range} に合いません`,
      );
    }
  }
  return targets;
}

/** 回答 → 使うプロファイル → 調べる対象 */
export function targetsFor(
  answers: Partial<Answers>,
  templatesDir: string = findTemplatesDir(),
): Target[] {
  const profiles = resolveProfiles(templatesDir, selectProfiles(answers));
  return buildTargets(profiles, answers);
}
