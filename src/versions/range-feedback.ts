import { harnessVersion } from "../generate/config.js";
import { candidatesOf, formatRangeReview, type RangeReview } from "./range-review.js";
import { alignTable } from "./table.js";

/**
 * ハーネスの改善の提案（C-78）の下書き。見出しは .github/ISSUE_TEMPLATE/harness-feedback.md に合わせる。
 * 画面に表示するだけで、ファイルへの出力や起票はしない。候補がなければ undefined。
 * アプリ名・パス・秘密を含めない（パッケージ名・版・プロファイルの key だけ）。
 */
export function renderRangeFeedbackDraft(review: RangeReview): string | undefined {
  const candidates = candidatesOf(review);
  if (candidates.length === 0) return undefined;
  const keys = [...new Set(candidates.flatMap((c) => c.target.profiles))];
  return [
    "## 事象",
    "",
    "プロファイルの version_ranges の範囲の外に、原因のパッケージが対応している安定版があります。未試行（登録情報の peerDependencies だけによる候補）です。",
    "",
    ...alignTable(
      ["パッケージ", "範囲", "候補", "原因の最新の安定版", "原因の対応範囲"],
      candidates.map((c) => [
        c.target.name,
        c.target.range,
        c.candidate,
        `${c.target.cause.package} ${c.causeVersion}`,
        c.peerRange,
      ]),
    ).map((l) => `    ${l}`),
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
    "harness create / adopt の、範囲の見直し（F-19）",
    "",
    "## 影響",
    "",
    "範囲が古いままだと、新しい版を使えない。ただし、候補の版で動くかは試していない。",
    "",
    "## 改善の案",
    "",
    "候補の版で npm run check が通るかを試し、通れば範囲を広げて verified_versions を更新する。",
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
