import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { minVersion, Range, satisfies, valid } from "semver";
import { parse as parseYaml } from "yaml";
import { GenerateError } from "../generate/errors.js";
import { resolveProfiles, type Profile } from "../generate/profile.js";
import { findTemplatesDir } from "../generate/templates-dir.js";
import type { Answers } from "../questions/answers.js";
import { selectProfiles } from "./profile-selection.js";

/** バージョンを調べる対象（Node.js か、npm のパッケージ） */
export interface Target {
  kind: "npm" | "node";
  /** npm のパッケージ名。Node.js は "node" */
  name: string;
  /** 検証済みの版。unverified のときは無い */
  verified?: string;
  /** semver の範囲（複数のプロファイルの範囲は交わり）。無ければ範囲なし */
  range?: string;
  /** 検証済みのないパッケージ */
  unverified: boolean;
  /** このパッケージを持つプロファイルの key（Node.js は []） */
  profiles: string[];
}

export const NODE_TARGET_NAME = "node";

/** data/runtimes.yaml の node.verified を読む */
function loadNodeVerified(): string {
  const file = fileURLToPath(new URL("../../data/runtimes.yaml", import.meta.url));
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(file, "utf8"));
  } catch (e) {
    throw new GenerateError(`data/runtimes.yaml を読めません：${file}（${(e as Error).message}）`, {
      cause: e,
    });
  }
  const node = (doc as { node?: { verified?: unknown; policy?: unknown } } | null)?.node;
  if (typeof node?.verified !== "string" || valid(node.verified) === null) {
    throw new GenerateError("data/runtimes.yaml：node.verified に、検証済みの版を書いてください");
  }
  if (node.policy !== "lts") {
    throw new GenerateError("data/runtimes.yaml：node.policy は lts だけ書けます");
  }
  return node.verified;
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

/** 選んだプロファイルから、調べる対象の一覧を作る。先頭は Node.js */
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

  for (const profile of profiles) {
    for (const name of wantedPackages(profile, answers)) {
      let target = byName.get(name);
      if (!target) {
        target = { kind: "npm", name, unverified: false, profiles: [] };
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
        target.range = target.range === undefined ? range : intersectRanges(target.range, range);
        if (minVersion(target.range) === null) {
          throw new GenerateError(
            `パッケージ ${name} の範囲が、プロファイル同士で食い違い、合う版がありません（${target.range}）`,
          );
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
    } else if (target.range !== undefined && !satisfies(target.verified, target.range)) {
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
