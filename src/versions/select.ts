import { coerce, compare, parse, prerelease, satisfies } from "semver";

/** 安定版（試験版でない）の中で、範囲（あれば）に合う最大の版。なければ undefined。semver として読めない文字列は無視する */
export function pickLatestStable(versions: string[], range?: string): string | undefined {
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
export function compareWithVerified(verified: string, candidate: string): Comparison {
  const order = compare(verified, candidate);
  const v = parse(verified) ?? coerce(verified);
  const c = parse(candidate) ?? coerce(candidate);
  return {
    kind: order === 0 ? "same" : order < 0 ? "newer" : "older",
    majorDiffers: v !== null && c !== null && v.major !== c.major,
  };
}
