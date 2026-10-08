import { readFileSync } from "node:fs";
import path from "node:path";
import { GenerateError } from "../generate/errors.js";
import { normalizeNewlines, renderTemplate } from "../generate/template.js";
import { REPORT_TEMPLATE, gitleaksImage } from "./secret-scan.js";

// harness adopt が追加する CI（.github/workflows/harness-check.yml、Issue #18）。
// 秘密情報の確認（#17 と同じ固定の gitleaks のイメージ・同じ4項目のレポート）を常に、npm audit は Node.js のアプリがあるときだけ。
// ひな形は templates/adopt/。Node.js のアプリの job は、別のひな形の断片を値として差し込む（ひな形の中に分岐を作らない）。
// Node.js のアプリがあるときは、基準線（Lint・型・書式の違反の件数が増えていないか、Issue #21）の job と、そのスクリプトも出す。

export const HARNESS_CHECK_PATH = ".github/workflows/harness-check.yml";
/** 基準線の確認のスクリプト（Node.js のアプリがあるとき。確認の場所によらず置く） */
export const BASELINE_SCRIPT_PATH = ".harness/scripts/baseline-check.mjs";

const MAIN = "adopt/harness-check.yml";
const NPM_AUDIT = "adopt/harness-check-npm-audit.yml";
const BASELINE_JOB = "adopt/harness-check-baseline.yml";
const BASELINE_SCRIPT = "adopt/baseline-check.mjs";

function readTemplate(templatesDir: string, rel: string): string {
  try {
    return normalizeNewlines(readFileSync(path.join(templatesDir, ...rel.split("/")), "utf8"));
  } catch (e) {
    throw new GenerateError(`必須のひな形 ${rel} を読めません`, { cause: e });
  }
}

/** 制御文字（端末の操作・行の偽装に使えるもの）を含むか */
const hasControl = (d: string): boolean =>
  [...d].some((c) => {
    const n = c.codePointAt(0) ?? 0;
    return n <= 0x1f || (n >= 0x7f && n <= 0x9f) || n === 0x2028 || n === 0x2029;
  });

/** 表示用：制御文字などを逃がす（引用符を除いた JSON の文字列） */
const escaped = (d: string): string => JSON.stringify(d).slice(1, -1);

/** npm audit の対象にできない理由。できるなら undefined */
function unusableReason(d: string): string | undefined {
  if (hasControl(d)) return "改行などの制御文字を含むため";
  if (d.includes("${{")) return "GitHub Actions の式（${{）を含むため";
  if (d === "" || d.startsWith("/") || /^[A-Za-z]:/.test(d) || d.startsWith("\\")) {
    return "ルートの外を指す（絶対パス）ため";
  }
  if (d.split("/").some((seg) => seg === ".." || seg === "")) {
    return "ルートの外を指す（..・空の名前）ため";
  }
  return undefined;
}

/**
 * npm audit の対象にできないフォルダ（理由つき。名前は逃がしてある）。
 * 除くのは、絶対パス・..・${{（GitHub の式の注入）・制御文字だけ。日本語・括弧・スペースなどは、
 * matrix の JSON（JSON.stringify で引用）と環境変数 AUDIT_DIR で渡すので、シェルの注入にならず、使える
 */
export function skippedAuditDirs(dirs: readonly string[]): { dir: string; reason: string }[] {
  return [...new Set(dirs)].flatMap((d) => {
    const reason = unusableReason(d);
    return reason === undefined ? [] : [{ dir: escaped(d), reason }];
  });
}

/** 報告に使う文（対象にできないフォルダ） */
export function describeSkippedDir(x: { dir: string; reason: string }): string {
  return `npm audit の対象にできないフォルダ：${x.dir}（${x.reason}）`;
}

/** 基準線・npm audit の対象にできるフォルダ（重複なし・並べ替え済み） */
export function safeDirs(dirs: readonly string[]): string[] {
  return [...new Set(dirs.filter((d) => unusableReason(d) === undefined))].sort();
}

export interface BaselineScriptInput {
  templatesDir: string;
  /** 対象のフォルダ。使えない名前（skippedAuditDirs）は除く */
  dirs: readonly string[];
  /** 記録する、ハーネスの版 */
  harnessVersion: string;
}

/** 基準線の確認のスクリプトの中身（LF）。フォルダの一覧と版は、JSON として埋め込む */
export function buildBaselineScript(input: BaselineScriptInput): string {
  const { templatesDir } = input;
  return renderTemplate(
    readTemplate(templatesDir, BASELINE_SCRIPT),
    {
      baseline_dirs: JSON.stringify(safeDirs(input.dirs)),
      harness_version: JSON.stringify(input.harnessVersion),
    },
    { templatesDir, fileName: BASELINE_SCRIPT },
  );
}

export interface HarnessCheckInput {
  templatesDir: string;
  /** Node.js のアプリのフォルダ（ルートからの相対パス。ルートは "."）。npm audit の対象。使えない名前（skippedAuditDirs）は除く */
  nodeDirs: readonly string[];
}

/** harness-check.yml の中身（LF、末尾の改行は1つ） */
export function buildHarnessCheck(input: HarnessCheckInput): string {
  const { templatesDir } = input;
  const dirs = safeDirs(input.nodeDirs);
  const npmAuditJob =
    dirs.length > 0
      ? renderTemplate(
          readTemplate(templatesDir, NPM_AUDIT),
          { audit_dirs: JSON.stringify(dirs) },
          { templatesDir, fileName: NPM_AUDIT },
        ).replace(/\n+$/, "")
      : "";
  const baselineJob =
    dirs.length > 0
      ? renderTemplate(
          readTemplate(templatesDir, BASELINE_JOB),
          {
            // フォルダ名は JSON の文字列（YAML の二重引用符の文字列としても同じ）で渡す。run の文字列には入れない
            install_steps: dirs
              .map(
                (d) => `      - name: ${JSON.stringify(`依存を入れる（${d}）`)}
        working-directory: ${JSON.stringify(d)}
        run: npm ci --ignore-scripts`,
              )
              .join("\n"),
          },
          { templatesDir, fileName: BASELINE_JOB },
        ).replace(/\n+$/, "")
      : "";
  const text = renderTemplate(
    readTemplate(templatesDir, MAIN),
    {
      gitleaks_image: gitleaksImage(templatesDir),
      report_template: REPORT_TEMPLATE,
      npm_audit_job: npmAuditJob,
      baseline_job: baselineJob,
    },
    { templatesDir, fileName: MAIN },
  );
  return `${text.replace(/\n+$/, "")}\n`;
}
