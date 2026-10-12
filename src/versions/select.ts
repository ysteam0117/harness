import { coerce, compare, parse, prerelease, satisfies } from "semver";
import type { Ecosystem } from "./ecosystem.js";
import {
  compareMavenVersions,
  mavenMajorDiffers,
  parseMavenVersion,
  pickLatestStableMaven,
} from "./maven-version.js";

/** 安定版（試験版でない）の中で、範囲（あれば）に合う最大の版。なければ undefined。読めない文字列は無視する。maven は Maven の版の規則で選ぶ */
export function pickLatestStable(
  versions: string[],
  range?: string,
  ecosystem: Ecosystem = "npm",
): string | undefined {
  if (ecosystem === "maven") return pickLatestStableMaven(versions, range);
  let best: string | undefined;
  for (const v of versions) {
    if (parse(v) === null) continue;
    if (prerelease(v) !== null) continue;
    if (range !== undefined && !satisfies(v, range)) continue;
    if (best === undefined || compare(v, best) > 0) best = v;
  }
  return best;
}

export interface Comparison {
  kind: "same" | "newer" | "older";
  /** 大きな版（メジャー）が違うか */
  majorDiffers: boolean;
}

/** 検証済みの版と候補の版を比べる */
export function compareWithVerified(
  verified: string,
  candidate: string,
  ecosystem: Ecosystem = "npm",
): Comparison {
  if (ecosystem === "maven") {
    // 読めない版は、同じとして扱う（比べられない）
    if (parseMavenVersion(verified) === undefined || parseMavenVersion(candidate) === undefined) {
      return { kind: "same", majorDiffers: false };
    }
    const order = compareMavenVersions(verified, candidate);
    return {
      kind: order === 0 ? "same" : order < 0 ? "newer" : "older",
      majorDiffers: mavenMajorDiffers(verified, candidate),
    };
  }
  const order = compare(verified, candidate);
  const v = parse(verified) ?? coerce(verified);
  const c = parse(candidate) ?? coerce(candidate);
  return {
    kind: order === 0 ? "same" : order < 0 ? "newer" : "older",
    majorDiffers: v !== null && c !== null && v.major !== c.major,
  };
}
