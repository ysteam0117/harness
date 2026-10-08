// 導入先と共通仕様（C-xx）の差の一覧（F-29 の手順5、Issue #20）。
// CLI は、機械的に分かる項目だけ判定する。コードを読まないと分からない大半は「未確認」にし、導入のあと、AI が Skill「既存のプロジェクトへの導入」で根拠つきで埋める。
// 共通仕様の一覧と判定の方法は data/adoption-checks.yaml（C-38：ルールはデータで持つ）。判定と文書の組み立ては、ディスクを読まない純粋な関数。
// 文書に書くのは、ファイルのパスと技術の名前だけ（値・ファイルの中身は書かない）。
import { isPlainObject, readDataYaml } from "../generate/data.js";
import { GenerateError } from "../generate/errors.js";
import { HARNESS_CHECK_PATH } from "./ci.js";
import { CLASS_ORDER, type DetectClass, type DetectedStack } from "./detect.js";

export type Verdict = "met" | "partial" | "unmet" | "na" | "unconfirmed";

export const VERDICT_LABEL: Record<Verdict, string> = {
  met: "満たしている",
  partial: "一部",
  unmet: "満たしていない",
  na: "対象外",
  unconfirmed: "未確認",
};

const VERDICT_ORDER: readonly Verdict[] = ["met", "partial", "unmet", "na", "unconfirmed"];

const VERDICT_MEANING: Record<Verdict, string> = {
  met: "ハーネスの導入や、機械的に分かる事実で、基準を満たしています",
  partial:
    "手がかりはありますが、基準のすべては満たしていない（または、設定の中身までは確かめていない）項目です",
  unmet: "機械的に調べて、基準を満たす手がかりが見つかりませんでした",
  na: "回答（質問A〜G）から、このアプリには当てはまらない条件つきの項目です（回答が「未定」の項目は、安全側として対象外にしません）",
  unconfirmed: "コードや文書を読まないと分からない項目です。導入のあと、AI が根拠つきで埋めます",
};

export type CheckMethod = "harness_files" | "ci" | "stack" | "answers" | "scan" | "manual";
const METHODS: readonly CheckMethod[] = [
  "harness_files",
  "ci",
  "stack",
  "answers",
  "scan",
  "manual",
];

export interface AdoptionCheck {
  /** "C-05" の形 */
  id: string;
  title: string;
  method: CheckMethod;
  /** 回答からの判定（judge）で有効なときだけ対象にするルール。無効なら「対象外」 */
  rule?: string;
  /** harness_files：導入物のパス */
  files?: string[];
  /** stack：判定した技術の条件（どちらかに合えばよい） */
  stack?: { class?: DetectClass; technology?: string };
  /** scan：秘密情報の確認が通ったときの判定（既定は met） */
  clean?: "met" | "partial";
}

const FILE = "adoption-checks.yaml";

function bad(where: string, form: string): never {
  throw new GenerateError(`data/${FILE} の ${where} が誤っています（${form}）`);
}

let cachedChecks: AdoptionCheck[] | undefined;

/** data/adoption-checks.yaml を読んで検証する */
export function loadAdoptionChecks(): AdoptionCheck[] {
  if (cachedChecks !== undefined) return cachedChecks;
  const raw = readDataYaml(FILE);
  const table = isPlainObject(raw) ? raw["checks"] : undefined;
  if (!isPlainObject(table)) return bad("checks", "連想配列で書いてください");
  const checks: AdoptionCheck[] = [];
  for (const [id, value] of Object.entries(table)) {
    const where = `checks.${id}`;
    if (!/^C-\d+$/.test(id)) bad(where, "番号は C-12 の形で書いてください");
    if (!isPlainObject(value)) return bad(where, "連想配列で書いてください");
    const title = value["title"];
    if (typeof title !== "string" || title === "") bad(`${where}.title`, "文字列で書いてください");
    const method = value["method"];
    if (!METHODS.includes(method as CheckMethod)) {
      bad(`${where}.method`, `${METHODS.join("・")} のどれかで書いてください`);
    }
    const check: AdoptionCheck = { id, title: title as string, method: method as CheckMethod };
    if (value["rule"] !== undefined) {
      if (typeof value["rule"] !== "string" || !/^C-\d+$/.test(value["rule"])) {
        bad(`${where}.rule`, "C-12 の形で書いてください");
      }
      check.rule = value["rule"] as string;
    }
    if (check.method === "answers" && check.rule === undefined) {
      bad(`${where}.rule`, "method が answers のときは必要です");
    }
    if (value["files"] !== undefined) {
      const files = value["files"];
      if (!Array.isArray(files) || !files.every((f) => typeof f === "string" && f !== "")) {
        bad(`${where}.files`, "文字列の一覧で書いてください");
      }
      check.files = files as string[];
    }
    if (check.method === "harness_files" && (check.files?.length ?? 0) === 0) {
      bad(`${where}.files`, "method が harness_files のときは必要です");
    }
    if (value["stack"] !== undefined) {
      const s = value["stack"];
      if (!isPlainObject(s)) return bad(`${where}.stack`, "連想配列で書いてください");
      const stack: { class?: DetectClass; technology?: string } = {};
      if (s["class"] !== undefined) {
        if (!(CLASS_ORDER as readonly unknown[]).includes(s["class"])) {
          bad(`${where}.stack.class`, `${CLASS_ORDER.join("・")} のどれかで書いてください`);
        }
        stack.class = s["class"] as DetectClass;
      }
      if (s["technology"] !== undefined) {
        if (typeof s["technology"] !== "string" || s["technology"] === "") {
          bad(`${where}.stack.technology`, "文字列で書いてください");
        }
        stack.technology = s["technology"] as string;
      }
      check.stack = stack;
    }
    if (
      check.method === "stack" &&
      check.stack?.class === undefined &&
      check.stack?.technology === undefined
    ) {
      bad(`${where}.stack`, "method が stack のときは class か technology が必要です");
    }
    if (value["clean"] !== undefined) {
      if (value["clean"] !== "met" && value["clean"] !== "partial") {
        bad(`${where}.clean`, "met か partial で書いてください");
      }
      check.clean = value["clean"];
    }
    checks.push(check);
  }
  cachedChecks = checks;
  return checks;
}

/** 導入のあとの、ファイルごとの結果（パスの一覧） */
export interface AdoptedPaths {
  added: readonly string[];
  merged: readonly string[];
  replaced: readonly string[];
  kept: readonly string[];
  same: readonly string[];
}

export interface AssessInput {
  /** 既定は data/adoption-checks.yaml */
  checks?: readonly AdoptionCheck[];
  /** 回答からの判定（judge）が有効にした共通仕様の番号 */
  enabledRules: readonly string[];
  /** 最終的に書く（書かない）ファイルの結果 */
  files: AdoptedPaths;
  stack: DetectedStack;
  scan: { status: "passed" | "skipped" };
}

export interface CheckResult {
  id: string;
  title: string;
  verdict: Verdict;
  /** 根拠（ファイルのパス・技術の名前だけ） */
  basis: string;
}

export interface Assessment {
  results: CheckResult[];
  counts: Record<Verdict, number>;
}

type Judged = Pick<CheckResult, "verdict" | "basis">;

const UNCONFIRMED_BASIS = "コードや文書を読んで確かめる";

function filesVerdict(check: AdoptionCheck, files: AdoptedPaths): Judged {
  const states: { path: string; label: string; ok: boolean }[] = [];
  const kinds: [readonly string[], string, boolean][] = [
    [files.added, "足した", true],
    [files.merged, "印で囲んで統合した", true],
    [files.replaced, "置き換えた", true],
    [files.same, "同じ内容", true],
    [files.kept, "既存を残した", false],
  ];
  for (const path of check.files ?? []) {
    for (const [list, label, ok] of kinds) {
      if (list.includes(path)) states.push({ path, label, ok });
    }
  }
  if (states.length === 0) return { verdict: "unconfirmed", basis: UNCONFIRMED_BASIS };
  const basis = states.map((s) => `${s.path}（${s.label}）`).join("、");
  return { verdict: states.every((s) => s.ok) ? "met" : "partial", basis };
}

function ciVerdict(files: AdoptedPaths, stack: DetectedStack): Judged {
  const introduced = [files.added, files.replaced, files.same].some((l) =>
    l.includes(HARNESS_CHECK_PATH),
  );
  const found = stack.apps.flatMap((a) => a.items).filter((i) => i.class === "ci");
  const parts: string[] = [];
  if (introduced) parts.push(`${HARNESS_CHECK_PATH}（導入）`);
  for (const i of found) parts.push(`${i.technology}（${i.evidence.join("、")}）`);
  if (parts.length === 0) {
    return { verdict: "unmet", basis: "CI のワークフローが見つかりませんでした" };
  }
  return { verdict: "partial", basis: `${parts.join("、")}。実行している内容は未確認` };
}

function stackVerdict(check: AdoptionCheck, stack: DetectedStack): Judged {
  const want = check.stack ?? {};
  const items = stack.apps
    .flatMap((a) => a.items)
    .filter(
      (i) =>
        (want.class !== undefined && i.class === want.class) ||
        (want.technology !== undefined && i.technology === want.technology),
    );
  if (items.length === 0) {
    return { verdict: "unmet", basis: "ファイルからは判定できませんでした" };
  }
  const names = [...new Set(items.map((i) => i.technology))].join("、");
  const evidence = [...new Set(items.flatMap((i) => i.evidence))].join("、");
  return { verdict: "partial", basis: `${names}を判定（${evidence}）。設定の差は未確認` };
}

/** 共通仕様ごとに判定する（純粋な関数） */
export function assessAdoption(input: AssessInput): Assessment {
  const checks = input.checks ?? loadAdoptionChecks();
  const results = checks.map((check): CheckResult => {
    const base = { id: check.id, title: check.title };
    if (check.rule !== undefined && !input.enabledRules.includes(check.rule)) {
      return { ...base, verdict: "na", basis: "回答から、このアプリには当てはまりません" };
    }
    switch (check.method) {
      case "harness_files":
        return { ...base, ...filesVerdict(check, input.files) };
      case "ci":
        return { ...base, ...ciVerdict(input.files, input.stack) };
      case "stack":
        return { ...base, ...stackVerdict(check, input.stack) };
      case "scan":
        return input.scan.status === "passed"
          ? {
              ...base,
              verdict: check.clean ?? "met",
              basis: "秘密情報の確認（gitleaks）が通りました",
            }
          : { ...base, verdict: "unconfirmed", basis: "秘密情報の確認を省きました" };
      case "answers":
      case "manual":
        return { ...base, verdict: "unconfirmed", basis: UNCONFIRMED_BASIS };
    }
  });
  const counts: Record<Verdict, number> = { met: 0, partial: 0, unmet: 0, na: 0, unconfirmed: 0 };
  for (const r of results) counts[r.verdict] += 1;
  return { results, counts };
}

/** 件数の要約（1行ずつ） */
export function summaryLines(a: Assessment): string[] {
  return VERDICT_ORDER.map((v) => `${VERDICT_LABEL[v]}：${String(a.counts[v])} 件`);
}

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** docs/harness-adoption.md の本文（LF）。同じ入力なら同じ結果 */
export function renderAdoptionDoc(a: Assessment, opts: { appName: string; day: string }): string {
  const lines: string[] = [];
  lines.push("# ハーネスの導入の差の一覧", "");
  lines.push(
    `${opts.appName} と共通仕様（C-xx）との差を、導入した日（${opts.day}）の時点でまとめたものです。\`harness adopt\` が作った導入の記録で、\`harness update\` は書き換えません。`,
    "",
  );
  lines.push(
    "CLI が判定したのは、ファイルから機械的に分かる項目だけです。コードや文書を読まないと分からない項目は「未確認」にしています。",
    "",
  );
  lines.push("## 判定の凡例", "", "| 判定 | 意味 |", "| --- | --- |");
  for (const v of VERDICT_ORDER) lines.push(`| ${VERDICT_LABEL[v]} | ${VERDICT_MEANING[v]} |`);
  lines.push("");
  lines.push("## 件数", "");
  for (const line of summaryLines(a)) lines.push(`- ${line}`);
  lines.push("");
  lines.push("## 一覧", "", "| 共通仕様 | 内容 | 判定 | 根拠 |", "| --- | --- | --- | --- |");
  for (const r of a.results) {
    lines.push(`| ${r.id} | ${cell(r.title)} | ${VERDICT_LABEL[r.verdict]} | ${cell(r.basis)} |`);
  }
  lines.push("");
  lines.push("## 未確認の項目の埋め方", "");
  lines.push(
    "ハーネスの `templates/skills/adopt-existing/SKILL.md`（Skill「既存のプロジェクトへの導入」）の「導入のあとに、未確認の項目を埋める」に従って、AI に頼みます。AI は、コードと文書を読み、「未確認」の項目を、読んだファイルを根拠にして、上の表の「満たしている／一部／満たしていない／対象外」に書き直します。判断できない項目は「未確認」のままにします。表には、ファイルのパスと名前だけを書き、値やファイルの中身は書きません。",
    "",
  );
  lines.push("## 次の手順", "");
  lines.push(
    "表のうち「満たしていない」「一部」の項目を、優先度を付けて Issue にします（F-29 の手順7）。一度にすべては直しません。",
    "",
  );
  return lines.join("\n");
}
