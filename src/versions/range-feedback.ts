import { harnessVersion } from "../generate/config.js";
import { STEP_LABEL, suspectTable } from "../verify/messages.js";
import { candidatesOf, formatRangeReview, type RangeReview } from "./range-review.js";
import {
  SKIP_REASON_TEXT,
  formatTrialResults,
  replacedTable,
  trialTable,
} from "./range-trial-messages.js";
import type { TrialResult } from "./range-trial.js";
import { alignTable } from "./table.js";

/**
 * ハーネスの改善の提案（C-78）の下書き。見出しは .github/ISSUE_TEMPLATE/harness-feedback.md に合わせる。
 * 画面に表示するだけで、ファイルへの出力や起票はしない。候補がなければ undefined。
 * アプリ名・パス・秘密を含めない（パッケージ名・版・プロファイルの key だけ）。
 */
export function renderRangeFeedbackDraft(
  review: RangeReview,
  trials?: TrialResult[],
): string | undefined {
  const candidates = candidatesOf(review);
  if (candidates.length === 0) return undefined;
  const keys = [...new Set(candidates.flatMap((c) => c.target.profiles))];
  const list = trials ?? [];
  const tried = list.filter((t) => t.outcome.kind === "passed" || t.outcome.kind === "failed");
  const hasResults = tried.length > 0;
  const passed = list.filter((t) => t.outcome.kind === "passed");
  const failed = list.filter((t) => t.outcome.kind === "failed");
  const untried = untriedNote(trials);

  const candidateTable = alignTable(
    ["パッケージ", "範囲", "候補", "原因の最新の安定版", "原因の対応範囲"],
    candidates.map((c) => [
      c.target.name,
      c.target.range,
      c.candidate,
      `${c.target.cause.package} ${c.causeVersion}`,
      c.peerRange,
    ]),
  ).map((l) => `    ${l}`);

  const event = hasResults
    ? [
        "プロファイルの version_ranges の範囲の外の版を、別の一時フォルダで試しました（npm install と npm run check。対象と原因のパッケージだけを置き換え、ほかは通常と同じ版）。",
        "",
        ...trialTable(list).map((l) => `    ${l}`),
        "",
        ...replacedTable(list).map((l) => `    ${l}`),
        ...failureDetails(failed),
      ]
    : [
        `プロファイルの version_ranges の範囲の外に、原因のパッケージが対応している安定版があります。${untried}（登録情報の peerDependencies だけによる候補）です。`,
        "",
        ...candidateTable,
      ];

  const impact = hasResults
    ? [
        ...(passed.length > 0
          ? [
              `${names(passed)}：この組み合わせでは npm install と npm run check が通った。範囲を広げられる見込みがある（試した環境の分だけ。ほかの組み合わせは未確認）。`,
            ]
          : []),
        ...(failed.length > 0
          ? [
              `${names(failed)}：原因の peerDependencies は対応を示しているが、実際に試すと失敗した。登録情報だけでは、範囲を広げてよいとは言えない。`,
            ]
          : []),
        ...(tried.length < list.length
          ? ["試せなかった候補は、未試行のまま（結果の表を参照）。"]
          : []),
      ]
    : ["範囲が古いままだと、新しい版を使えない。ただし、候補の版で動くかは試していない。"];

  const proposal = hasResults
    ? [
        ...passed.map(
          (t) =>
            `- ${t.finding.target.name}：version_ranges（今は ${t.finding.target.range}）を、${t.finding.candidate} を含む範囲に広げ、verified_versions を更新する案。`,
        ),
        ...failed.map(
          (t) =>
            `- ${t.finding.target.name}：範囲は今のまま。失敗した手順・script と、原因の候補のパッケージを確かめる。`,
        ),
        ...(tried.length < list.length ? ["- 試せなかった候補は、条件を整えて試し直す。"] : []),
      ]
    : [
        "候補の版で npm run check が通るかを試し、通れば範囲を広げて verified_versions を更新する。",
      ];

  return [
    "## 事象",
    "",
    ...event,
    "",
    "## 種類",
    "",
    "- [ ] ルール同士が食い違っている",
    "- [ ] ルールに従った結果、手戻りや不具合が起きた",
    "- [x] ルールが足りない",
    "- [ ] その他",
    "",
    "## 関係するルール・ファイル",
    "",
    ...keys.map((k) => `- templates/profiles/${k}/profile.yaml の version_ranges・range_causes`),
    "",
    "## 起きた場面",
    "",
    hasResults
      ? "harness create の、範囲の外の版の試し（--try-wider-ranges、F-19）"
      : "harness create / adopt の、範囲の見直し（F-19）",
    "",
    "## 影響",
    "",
    ...impact,
    "",
    "## 改善の案",
    "",
    ...proposal,
    "",
    "## 急ぎかどうか",
    "",
    "- [ ] 急ぎ（作業を進められない、または不具合につながる）",
    "- [x] 通常",
    "",
    "## ハーネスのバージョン",
    "",
    harnessVersion(),
  ].join("\n");
}

function names(results: TrialResult[]): string {
  return results.map((t) => `${t.finding.target.name} ${t.finding.candidate}`).join("、");
}

/** 試せなかった理由。固定の分類の文面だけを使う（例外の本文・パス・アプリ名は入れない） */
function untriedNote(trials: TrialResult[] | undefined): string {
  if (trials === undefined || trials.length === 0) return "未試行";
  const reasons = new Set<string>();
  for (const t of trials) {
    if (t.outcome.kind === "skipped") reasons.add(SKIP_REASON_TEXT[t.outcome.reason]);
    if (t.outcome.kind === "interrupted") reasons.add("中断した");
  }
  return reasons.size > 0 ? `未試行（${[...reasons].join("、")}）` : "未試行";
}

/** 失敗の詳細：手順・script・原因の候補（出力の終わりは入れない） */
function failureDetails(failed: TrialResult[]): string[] {
  const lines: string[] = [];
  for (const t of failed) {
    const o = t.outcome;
    if (o.kind !== "failed") continue;
    lines.push(
      "",
      `${t.finding.target.name} ${t.finding.candidate} の失敗：${STEP_LABEL[o.failedStep]}${o.timedOut ? "（時間切れ）" : ""}`,
    );
    if (o.failedScripts.length > 0)
      lines.push(`失敗した品質チェック：${o.failedScripts.join("、")}`);
    if (o.suspects.length > 0) {
      lines.push("原因の候補のパッケージ：", ...suspectTable(o.suspects).map((l) => `    ${l}`));
    }
  }
  return lines;
}

/** 範囲の見直しの結果と、改善の提案の下書きを、画面に表示する（表示するだけ。ファイルへの出力・起票はしない） */
export function presentRangeReview(
  review: RangeReview,
  note: (text: string, title: string) => void,
): void {
  const text = formatRangeReview(review);
  if (text !== undefined) note(text, "範囲の見直し");
  const draft = renderRangeFeedbackDraft(review);
  if (draft !== undefined) note(draft, "ハーネスの改善の提案（下書き）");
}

/** 試した結果の表と、結果つきの改善の提案の下書きを、画面に表示する（表示するだけ） */
export function presentTrialFeedback(
  review: RangeReview,
  trials: TrialResult[],
  note: (text: string, title: string) => void,
): void {
  note(formatTrialResults(trials), "範囲の外の版の試し");
  const draft = renderRangeFeedbackDraft(review, trials);
  if (draft !== undefined) note(draft, "ハーネスの改善の提案（下書き・試した結果つき）");
}
