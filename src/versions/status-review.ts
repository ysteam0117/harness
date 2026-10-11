import { valid } from "semver";
import { usableProfiles } from "../adopt/profiles.js";
import { GenerateError } from "../generate/errors.js";
import { loadProfile } from "../generate/profile.js";
import { findTemplatesDir } from "../generate/templates-dir.js";
import type { RecordedConfig } from "../update/read-config.js";
import type { VersionEntry } from "./choose.js";
import {
  candidatesOf,
  rangeTargets,
  rangeTargetsFor,
  type RangeReview,
  type RangeTarget,
} from "./range-review.js";
import { fetchVersionLists, type RegistryOptions } from "./registry.js";
import { compareWithVerified, pickLatestStable } from "./select.js";
import { buildTargets, NODE_TARGET_NAME, type Target } from "./targets.js";

// harness status の、新しい大きな版と、範囲を緩められる候補（Issue #6 PR-C）。読むだけで、何も書かない。
// 画面に出す理由は、固定の分類だけにする（registry の reason は、例外の本文やパスを含みうる）。

/** 採用した版より、大きな版（メジャー）が新しい、最新の安定版 */
export interface MajorUpdate {
  name: string;
  adopted: string;
  latest: string;
}

export type MajorUpdates =
  | { status: "ok"; updates: MajorUpdate[]; skipped: { name: string; reason: string }[] }
  | { status: "empty" };

/** registry の reason を、固定の分類に変える。元の文字列は返さない */
export function safeReason(reason: string): string {
  if (reason.startsWith("時間切れ")) return "時間切れ";
  const http = /^HTTP (\d{3})(?!\d)/.exec(reason);
  if (http !== null) return `HTTP ${http[1] ?? ""}`;
  if (reason.startsWith("応答を JSON") || reason.startsWith("登録情報の形")) {
    return "応答を読めません";
  }
  return "接続できません";
}

/** 採用した技術の、新しい大きな版を探す。取得できないものは、例外にせず skipped にする */
export async function checkMajorUpdates(
  entries: VersionEntry[],
  fetchFn: typeof fetch,
  opts: RegistryOptions = {},
): Promise<MajorUpdates> {
  if (entries.length === 0) return { status: "empty" };
  const skipped: { name: string; reason: string }[] = [];
  const targets: Target[] = [];
  for (const e of entries) {
    if (valid(e.version) === null) {
      skipped.push({ name: e.name, reason: "版の形ではありません" });
      continue;
    }
    targets.push({
      kind: e.name === NODE_TARGET_NAME ? "node" : "npm",
      name: e.name,
      unverified: false,
      profiles: [],
    });
  }
  const lists = await fetchVersionLists(targets, fetchFn, opts);
  const updates: MajorUpdate[] = [];
  for (const e of entries) {
    const found = lists.get(e.name);
    if (found === undefined) continue;
    if (!found.ok) {
      skipped.push({ name: e.name, reason: safeReason(found.reason) });
      continue;
    }
    const latest = pickLatestStable(found.versions);
    if (latest === undefined) {
      skipped.push({ name: e.name, reason: "安定版がありません" });
      continue;
    }
    const c = compareWithVerified(e.version, latest);
    if (c.kind === "newer" && c.majorDiffers) {
      updates.push({ name: e.name, adopted: e.version, latest });
    }
  }
  return { status: "ok", updates, skipped };
}

export type StatusRangeTargets =
  { status: "ok"; targets: RangeTarget[] } | { status: "unavailable"; reason: string };

/** 記録から、範囲を持つ対象を取り出す。読めないときは、固定の文で unavailable（例外の本文は出さない） */
export function statusRangeTargets(recorded: RecordedConfig): StatusRangeTargets {
  try {
    if (recorded.mode === "adopt") {
      if (recorded.profiles === undefined) {
        return { status: "unavailable", reason: "導入のときのプロファイルの記録がありません" };
      }
      const resolved = usableProfiles(recorded.profiles.applied);
      if (resolved.missing.length > 0) {
        return {
          status: "unavailable",
          reason: "記録されたプロファイルの一部を読めませんでした",
        };
      }
      const dir = findTemplatesDir();
      const profiles = resolved.usable.map((a) => loadProfile(dir, a.profile));
      return {
        status: "ok",
        targets: rangeTargets(profiles, buildTargets(profiles, recorded.answers)),
      };
    }
    return { status: "ok", targets: rangeTargetsFor(recorded.answers) };
  } catch (e) {
    if (e instanceof GenerateError) {
      return {
        status: "unavailable",
        reason: "このハーネスでは、記録された回答のプロファイルを読めません",
      };
    }
    throw e;
  }
}

const UNEXPECTED = "予期しない誤りが起きました";

/** 「採用した技術の新しい大きな版」の節（予期しない例外のときは major が undefined） */
export function formatMajorUpdates(major: MajorUpdates | undefined, adopted: boolean): string[] {
  const head = "採用した技術の新しい大きな版：";
  if (major === undefined) return [`${head}取得できません（${UNEXPECTED}）`];
  if (major.status === "empty") {
    return [
      adopted
        ? `${head}調べる版の記録がありません（harness adopt では版を記録しません）`
        : `${head}調べる版の記録がありません`,
    ];
  }
  const lines: string[] = [];
  if (major.updates.length > 0) {
    lines.push(head);
    for (const u of major.updates)
      lines.push(`  - ${u.name}：採用 ${u.adopted} → 最新 ${u.latest}`);
    if (major.skipped.length > 0) lines.push(`  取得できません（${skippedText(major.skipped)}）`);
  } else if (major.skipped.length > 0) {
    lines.push(`${head}取得できません（${skippedText(major.skipped)}）`);
  } else {
    lines.push(`${head}ありません`);
  }
  return lines;
}

function skippedText(skipped: { name: string; reason: string }[]): string {
  return skipped.map((s) => `${s.name}：${s.reason}`).join("、");
}

/** reviewRanges の skipped の理由（「名前：理由」）を、名前と固定の分類にする */
function skippedOf(review: RangeReview): { name: string; reason: string }[] {
  const out: { name: string; reason: string }[] = [];
  for (const f of review.findings) {
    if (f.status !== "skipped") continue;
    const at = f.reason.indexOf("：");
    out.push(
      at < 0
        ? { name: f.target.name, reason: safeReason(f.reason) }
        : { name: f.reason.slice(0, at), reason: safeReason(f.reason.slice(at + 1)) },
    );
  }
  return out;
}

/** 「ハーネスの使える範囲を緩められる候補」の節。targets が undefined のときは、予期しない例外 */
export function formatRangeCandidates(
  targets: StatusRangeTargets | undefined,
  review: RangeReview | undefined,
): string[] {
  const head = "ハーネスの使える範囲を緩められる候補：";
  if (targets === undefined) return [`${head}取得できません（${UNEXPECTED}）`];
  if (targets.status === "unavailable") return [`${head}取得できません（${targets.reason}）`];
  if (targets.targets.length === 0) return [`${head}範囲の制限はありません`];
  if (review === undefined) return [`${head}取得できません（${UNEXPECTED}）`];
  const candidates = candidatesOf(review);
  const skipped = skippedOf(review);
  if (candidates.length === 0) {
    return [
      skipped.length > 0 ? `${head}取得できません（${skippedText(skipped)}）` : `${head}ありません`,
    ];
  }
  const lines = [head];
  for (const c of candidates) {
    lines.push(
      `  - ${c.target.name}：範囲 ${c.target.range} → 候補 ${c.candidate}（${c.target.cause.package} ${c.causeVersion} が対応。まだ試していません）`,
    );
  }
  if (skipped.length > 0) lines.push(`  取得できません（${skippedText(skipped)}）`);
  return lines;
}
