import { compare, major, satisfies, validRange } from "semver";
import { type Profile, type RangeCause, resolveProfiles } from "../generate/profile.js";
import { findTemplatesDir } from "../generate/templates-dir.js";
import type { Answers } from "../questions/answers.js";
import { selectProfiles } from "./profile-selection.js";
import { fetchPackageInfo, type PackageInfoResult } from "./registry.js";
import { pickLatestStable } from "./select.js";
import { alignTable } from "./table.js";
import { buildTargets, type Target } from "./targets.js";

/** ハーネスの範囲（version_ranges）を持つ対象と、その原因 */
export interface RangeTarget {
  name: string;
  /** ハーネスの範囲（複数のプロファイルの範囲は交わり） */
  range: string;
  cause: RangeCause;
  /** 範囲を決めているプロファイルの key */
  profiles: string[];
}

export type CandidateFinding = {
  status: "candidate";
  target: RangeTarget;
  /** 原因のパッケージの最新の安定版と、その peerDependencies の範囲 */
  causeVersion: string;
  peerRange: string;
  /** 範囲に合う最大の版（なければ undefined） */
  inRange: string | undefined;
  /** 範囲の外で、原因が対応している最新の安定版 */
  candidate: string;
};

export type RangeFinding =
  | CandidateFinding
  | { status: "none"; target: RangeTarget; reason: string }
  | { status: "skipped"; target: RangeTarget; reason: string };

export interface RangeReview {
  findings: RangeFinding[];
}

/** 範囲を持つ対象を、原因つきで取り出す（範囲の原因は、プロファイルの読み込みの検証で必ずある） */
export function rangeTargets(profiles: Profile[], targets: Target[]): RangeTarget[] {
  const out: RangeTarget[] = [];
  for (const target of targets) {
    if (target.range === undefined) continue;
    const owners = profiles.filter(
      (p) => target.profiles.includes(p.key) && target.name in p.versionRanges,
    );
    const cause = owners.map((p) => p.rangeCauses[target.name]).find((c) => c !== undefined);
    if (cause === undefined) continue;
    out.push({
      name: target.name,
      range: target.range,
      cause,
      profiles: owners.map((p) => p.key),
    });
  }
  return out;
}

/** 回答 → 使うプロファイル → 範囲を持つ対象 */
export function rangeTargetsFor(
  answers: Partial<Answers>,
  templatesDir: string = findTemplatesDir(),
): RangeTarget[] {
  const profiles = resolveProfiles(templatesDir, selectProfiles(answers));
  return rangeTargets(profiles, buildTargets(profiles, answers));
}

/**
 * 原因の最新の安定版が対応する範囲 P のうち、ハーネスの範囲 R の外にある、最新の安定版を探す。
 * R に合う最大の版より新しいものだけを数える。試験版は除く。
 */
export function findCandidate(
  versions: string[],
  range: string,
  peerRange: string,
): { inRange: string | undefined; candidate: string | undefined } {
  const inRange = pickLatestStable(versions, range);
  const supported = versions.filter(
    (v) =>
      satisfies(v, peerRange) &&
      !satisfies(v, range) &&
      (inRange === undefined || compare(v, inRange) > 0),
  );
  return { inRange, candidate: pickLatestStable(supported) };
}

/**
 * 範囲の見直し。範囲の原因のパッケージの最新の安定版の peerDependencies を読み、範囲の外に、原因が対応している版があるかを調べる。
 * 取得できないものは、例外にせず skipped と理由にする（呼び出し側の終了コードは変えない）。読むだけで、何も書かない。
 */
export async function reviewRanges(
  targets: RangeTarget[],
  fetchFn: typeof fetch,
  opts: { timeoutMs?: number } = {},
): Promise<RangeReview> {
  const cache = new Map<string, Promise<PackageInfoResult>>();
  const info = (name: string): Promise<PackageInfoResult> => {
    let found = cache.get(name);
    if (found === undefined) {
      found = fetchPackageInfo(name, fetchFn, opts);
      cache.set(name, found);
    }
    return found;
  };

  const review = async (target: RangeTarget): Promise<RangeFinding> => {
    if (target.cause.kind === "self") {
      return { status: "none", target, reason: "自身の下限のため、確認しません" };
    }
    const [own, cause] = await Promise.all([info(target.name), info(target.cause.package)]);
    if (!own.ok) return { status: "skipped", target, reason: `${target.name}：${own.reason}` };
    if (!cause.ok) {
      return { status: "skipped", target, reason: `${target.cause.package}：${cause.reason}` };
    }
    const causeVersion = pickLatestStable(cause.versions);
    if (causeVersion === undefined) {
      return { status: "none", target, reason: `${target.cause.package} に安定版がありません` };
    }
    const peerRange = cause.peers[causeVersion]?.[target.name];
    if (peerRange === undefined || validRange(peerRange) === null) {
      return {
        status: "none",
        target,
        reason: `${target.cause.package} ${causeVersion} の登録情報に、${target.name} の peerDependencies がありません`,
      };
    }
    const { inRange, candidate } = findCandidate(own.versions, target.range, peerRange);
    if (candidate === undefined) {
      return { status: "none", target, reason: "範囲の外に、原因が対応している安定版はありません" };
    }
    return { status: "candidate", target, causeVersion, peerRange, inRange, candidate };
  };

  return { findings: await Promise.all(targets.map(review)) };
}

/** 候補のあるもの */
export function candidatesOf(review: RangeReview): CandidateFinding[] {
  return review.findings.filter((f): f is CandidateFinding => f.status === "candidate");
}

/** 画面に出す、範囲の見直しの文面。見直す対象がなければ undefined */
export function formatRangeReview(review: RangeReview): string | undefined {
  if (review.findings.length === 0) return undefined;
  const lines: string[] = [];
  const candidates = candidatesOf(review);
  if (candidates.length > 0) {
    lines.push(
      "ハーネスの範囲の外に、原因のパッケージが対応している版がありました。",
      ...alignTable(
        ["パッケージ", "範囲", "候補", "原因"],
        candidates.map((c) => [
          c.target.name,
          c.target.range,
          c.candidate,
          `${c.target.cause.package} ${c.causeVersion}`,
        ]),
      ),
    );
    for (const c of candidates) {
      lines.push(
        "",
        `${c.target.name} ${String(major(c.candidate))} 系にも対応：${c.target.cause.package} ${c.causeVersion} の peerDependencies は ${c.target.name} ${c.peerRange} です。ハーネスの範囲 ${c.target.range} を広げられる可能性があります（まだ試していません）。`,
      );
    }
  }
  const reasons = review.findings.flatMap((f) => (f.status === "skipped" ? [f.reason] : []));
  if (reasons.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`範囲の見直しは、登録情報を取得できなかったため飛ばしました：${reasons.join("、")}`);
  }
  if (lines.length === 0) {
    lines.push("範囲の外に、原因のパッケージが対応している新しい版は見つかりませんでした。");
  }
  return lines.join("\n");
}
