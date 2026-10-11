import { STEP_LABEL, suspectTable } from "../verify/messages.js";
import type {
  TrialCleanupFailure,
  TrialOutcome,
  TrialResult,
  TrialSkipReason,
} from "./range-trial.js";
import { alignTable } from "./table.js";

export const TRY_RANGES_CONFIRM_ID = "try_wider_ranges";

/** 試すかの質問（対話するとき。既定は「いいえ」） */
export const TRY_RANGES_QUESTION =
  "ハーネスの範囲の外の版を、別の一時フォルダで試しますか（生成したプロジェクトは変えません。候補ごとに npm install と npm run check を実行します。候補ごとに数分かかります）";

export const NO_CANDIDATE_TO_TRY =
  "試す候補はありません（範囲の外に、原因が対応している版が見つかっていません）。";

export const TRIAL_NO_DOCKER =
  "Docker を使えなかったため、範囲の外の版の試しを飛ばしました（npm は呼んでいません）。Docker を起動してから、やり直してください";

export const TRIAL_INTERRUPTED =
  "中断しました。残りの候補は試していません（試しの一時フォルダと検証用の DB は、後始末をしています）";

export const TRIAL_CANCELLED = "試しは行いませんでした（生成は終わっています）。";

export const TRIAL_UNCHANGED = "生成したプロジェクトは変えていません。";

/** 飛ばした理由の、固定の文面（例外の本文は入れない） */
export const SKIP_REASON_TEXT: Record<TrialSkipReason, string> = {
  "docker-unavailable": "Docker を使えなかった",
  "missing-cause-entry": "選んだ版の一覧に、対象または原因のパッケージがなかった",
  "build-failed": "試し用のプロジェクトを組み立てられなかった",
  "write-failed": "試し用のフォルダに書き込めなかった",
  "unexpected-error": "動作確認を続けられなかった",
  "db-stop-failed-earlier": "前の候補で検証用の DB を止められなかったため、試さなかった",
};

/** 試した結果の短い言葉（表の「結果」） */
export function outcomeLabel(outcome: TrialOutcome): string {
  switch (outcome.kind) {
    case "passed":
      return "通った";
    case "failed":
      return `失敗（${STEP_LABEL[outcome.failedStep]}${outcome.timedOut ? "・時間切れ" : ""}）`;
    case "skipped":
      return `飛ばした（${SKIP_REASON_TEXT[outcome.reason]}）`;
    case "interrupted":
      return "中断";
  }
}

/** 結果の表。下書きの文面でも使う（パッケージ名・版・手順名だけ） */
export function trialTable(results: TrialResult[]): string[] {
  return alignTable(
    ["パッケージ", "範囲", "試した版", "原因", "結果"],
    results.map((r) => [
      r.finding.target.name,
      r.finding.target.range,
      r.finding.candidate,
      `${r.finding.target.cause.package} ${r.finding.causeVersion}`,
      outcomeLabel(r.outcome),
    ]),
  );
}

/** 置き換えた版の表（通常に採用した版 → 試した版）。置き換えがなければ空 */
export function replacedTable(results: TrialResult[]): string[] {
  const rows = results.flatMap((r) =>
    r.replaced.map((x) => [r.finding.target.name, x.name, x.adopted, x.trial]),
  );
  if (rows.length === 0) return [];
  return alignTable(["候補", "置き換えたパッケージ", "通常の採用", "試した版"], rows);
}

/** 後始末で手が要るものの案内。パスを含むので、画面と stderr だけに出す（下書きには入れない） */
export function formatCleanupFailure(f: TrialCleanupFailure): string {
  if (f.kind === "tmp-remove") {
    return `一時フォルダを消せませんでした。手で削除してください：${f.path}`;
  }
  return `試し用の検証用 DB を停止できませんでした。${f.dir} で ${f.command} を実行してから、フォルダ（${f.tmpDir}）を削除してください（生成したプロジェクトの場所では実行しないでください。本体の DB が止まります）`;
}

/** 画面に出す、試した結果。失敗は原因の候補と出力の終わりを添える */
export function formatTrialResults(results: TrialResult[]): string {
  const lines: string[] = [];
  const skippedAll = results.every((r) => r.outcome.kind === "skipped");
  if (
    skippedAll &&
    results.every((r) => r.outcome.kind === "skipped" && r.outcome.reason === "docker-unavailable")
  ) {
    lines.push(TRIAL_NO_DOCKER);
  }
  lines.push(...trialTable(results));
  const replaced = replacedTable(results);
  if (replaced.length > 0)
    lines.push("", "試しで置き換えた版（ほかは、通常と同じ版）", ...replaced);
  for (const r of results) {
    if (r.outcome.kind !== "failed") continue;
    const o = r.outcome;
    lines.push("", `失敗：${r.finding.target.name} ${r.finding.candidate}`);
    lines.push(`  手順：${STEP_LABEL[o.failedStep]}${o.timedOut ? "（時間切れ）" : ""}`);
    if (o.failedScripts.length > 0)
      lines.push(`  失敗した品質チェック：${o.failedScripts.join("、")}`);
    if (o.suspects.length > 0) {
      lines.push("  原因の候補のパッケージ：", ...suspectTable(o.suspects).map((l) => `    ${l}`));
    }
    if (o.outputSuppressed) {
      lines.push("  短い秘密の値を含むおそれがあるため、出力は表示しません");
    } else if (o.outputTail !== "") {
      lines.push("  出力の終わり（秘密の値は [REDACTED] に置き換えています）：", o.outputTail);
    }
  }
  if (results.some((r) => r.outcome.kind === "interrupted")) lines.push("", TRIAL_INTERRUPTED);
  const failures = results.flatMap((r) => r.cleanupFailures);
  if (failures.length > 0) lines.push("", ...failures.map(formatCleanupFailure));
  lines.push("", TRIAL_UNCHANGED);
  return lines.join("\n");
}
