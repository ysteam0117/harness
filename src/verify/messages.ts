import { alignTable } from "../versions/table.js";
import type { VersionEntry } from "../versions/choose.js";
import type { Suspect, VerifyResult, VerifyStep } from "./verify.js";

/** 動作確認の質問（対話するとき。既定は「いいえ」） */
export const VERIFY_QUESTION =
  "今すぐ動作を確かめますか（npm install と npm run check を実行します。数分かかります）";

export const VERIFY_CONFIRM_ID = "verify_after_generate";

const STEP_LABEL: Record<VerifyStep, string> = {
  env: "環境ファイル（.env.development・.env.test）の用意",
  install: "npm install",
  "db-up": "検証用の PostgreSQL（Docker）の起動",
  check: "npm run check",
};

export function cancelledAfterGenerate(dir: string): string {
  return `生成は終わっています（${dir}）。動作の確認は行いませんでした。`;
}

export function interruptedMessage(dir: string): string {
  return `中断しました。生成は終わっています（${dir}）。動作の確認は終わっていません。`;
}

export const INTERRUPT_NOTICE = "中断の要求を受けました。実行中の処理を止めて、後始末をしています…";

export const INTERRUPT_AGAIN_NOTICE = "後始末をしています。終わるまで、お待ちください。";

function envLines(created: string[], existing: string[]): string[] {
  const lines: string[] = [];
  if (created.length > 0) {
    lines.push(
      `${created.join("・")} を、架空の値で作りました（Git には入りません。値は表示しません。自分の環境の値は、あとで書き換えてください）`,
    );
  }
  if (existing.length > 0) {
    lines.push(`${existing.join("・")} は、すでにあるため、変えずに使いました`);
  }
  return lines;
}

function cleanupLines(failures: string[]): string[] {
  return failures.length > 0 ? ["", ...failures] : [];
}

/** 通ったときの表示。未検証の新しい版で通ったときは、C-78 の提案を添える */
export function passedMessage(
  result: Extract<VerifyResult, { status: "passed" }>,
  entries: readonly VersionEntry[],
): string {
  const lines = [
    "npm install と npm run check が通りました。docs/tech-stack.md に、動作確認の記録を足しました。",
    ...envLines(result.envCreated, result.envExisting),
  ];
  const newer = entries.filter((e) => e.newerThanVerified);
  if (newer.length > 0) {
    lines.push(
      "",
      "検証済みより新しい版で、動作を確認できました。",
      ...alignTable(
        ["パッケージ", "採用", "検証済み"],
        newer.map((e) => [e.name, e.version, e.verified ?? "なし"]),
      ),
      "ハーネスの改善の提案（C-78）として、プロファイルの verified_versions の更新を提案してください（ここでは、何も送りません）",
    );
  }
  return [...lines, ...cleanupLines(result.cleanupFailures)].join("\n");
}

function suspectTable(suspects: Suspect[]): string[] {
  return alignTable(
    ["パッケージ", "採用", "検証済み", "差"],
    suspects.map((s) => [
      s.named ? `${s.name}（出力に名前が出ています）` : s.name,
      s.version,
      s.verified ?? "なし",
      s.majorDiffers ? "大" : s.newerThanVerified ? "小" : "-",
    ]),
  );
}

/** 失敗したときの表示。生成したファイルは残っていること、失敗した手順・script・原因の候補・戻し方を示す */
export function failedMessage(
  result: Extract<VerifyResult, { status: "failed" }>,
  dir: string,
): string {
  const lines = [
    `動作確認で失敗しました：${STEP_LABEL[result.failedStep]}${result.timedOut ? "（時間切れ）" : ""}`,
    `生成したファイルは残しています（${dir}）。記録（docs/tech-stack.md の動作確認）は足していません。`,
  ];
  if (result.failedScripts.length > 0) {
    lines.push(`失敗した品質チェック：${result.failedScripts.join("、")}`);
  }
  lines.push(...envLines(result.envCreated, result.envExisting));
  if (result.failedStep === "env") {
    lines.push(".env.example を読めなかったため、環境ファイルを作れませんでした");
  } else if (result.suspects.length > 0) {
    lines.push("", "原因の候補のパッケージ：", ...suspectTable(result.suspects));
  } else {
    lines.push("", "原因の候補のパッケージは、特定できませんでした");
  }
  if (result.outputSuppressed) {
    lines.push(
      "",
      "短い秘密の値を含むおそれがあるため、出力は表示しません。生成した場所で npm run check を実行して確かめてください",
    );
  } else if (result.outputTail !== "") {
    lines.push("", "出力の終わり（秘密の値は [REDACTED] に置き換えています）：", result.outputTail);
  }
  lines.push(
    "",
    "検証済みの版に戻す方法",
    "  1. package.json の、上のパッケージの版を、検証済みの版に書き換える",
    "  2. npm install を実行し、続けて npm run check を実行する",
    "  作り直すなら、回答の version_policy を verified（検証済み）にして、harness create をやり直す",
    ...cleanupLines(result.cleanupFailures),
  );
  return lines.join("\n");
}

export function skippedMessage(reason: string): string {
  return reason;
}

/** 生成の後の「次の手順」。確かめた結果に合わせる */
export function nextSteps(dir: string, result?: VerifyResult): string {
  const head = [`生成した場所：${dir}`, "", "次の手順", "1. 生成した場所に移動して、README を読む"];
  const tail = ["", "（Git の初期化・リモートリポジトリの作成は、まだ行っていません）"];
  if (result?.status === "passed") {
    return [
      ...head,
      "2. npm install と npm run check は、確かめ済みです。作った環境ファイルの値は、自分の環境に合わせて書き換える",
      ...tail,
    ].join("\n");
  }
  if (result?.status === "failed") {
    return [
      ...head,
      "2. 上の失敗の案内を読み、直してから、npm install と npm run check をやり直す",
      ...tail,
    ].join("\n");
  }
  return [...head, "2. npm install で、依存するパッケージを入れる", ...tail].join("\n");
}
