import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CancelledError } from "../questions/prompter.js";
import { GenerateError } from "../generate/errors.js";
import { containerImageValues, loadProfile } from "../generate/profile.js";
import { findTemplatesDir } from "../generate/templates-dir.js";

// harness adopt の秘密情報の確認（F-29 の手順1、#17）。
// 既存のアプリの履歴と作業フォルダを、gitleaks（Docker。#42 と同じ固定のイメージ）で確かめる。
// 値は、どこにも出さない：--redact を付け、レポートからは「場所・行・コミット・種類」の4つだけを写す。
// 実行の出力（stdout・stderr）は残さない。失敗の文には、決まった文だけを使い、実行の出力・例外の文を入れない。

/** 技術プロファイルの中の、gitleaks のイメージの置き場所（値の出どころは profile.yaml の container_images） */
const PROFILE_KEY = "quality/typescript-standard";
const IMAGE_VALUE = "gitleaks_image";
const TOOL_TIMEOUT_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 60 * 1000;
const REPORT_FILE = "report.json";
const SHOWN_LIMIT = 50;

/** 見つかった1件。値は含めない */
export interface Leak {
  /** リポジトリの根からの相対パス（制御文字は逃がしてある） */
  file: string;
  line: number;
  /** ルールの名前（[A-Za-z0-9_.-] 以外は ?） */
  rule: string;
  /** コミットの先頭7桁（履歴で見つかったものだけ） */
  commit?: string;
}

/** 確認した範囲：history+worktree は Git の履歴と作業フォルダ、worktree は作業フォルダのみ（Git でないとき） */
export type ScanScope = "history+worktree" | "worktree";

export type SecretScanResult =
  | { kind: "clean"; scope: ScanScope; gitleaksConfig?: boolean }
  | { kind: "leaks"; scope: ScanScope; history: Leak[]; worktree: Leak[] }
  | { kind: "docker-missing" }
  | { kind: "unreadable"; count: number }
  | { kind: "failed"; message: string };

/** 失敗の文（決まった文だけ。実行の出力・例外の文は入れない） */
export const SCAN_FAILED = {
  start: "秘密情報の確認を完了できませんでした（gitleaks を起動できませんでした）",
  timeout: "秘密情報の確認を完了できませんでした（時間切れでした）",
  exit: "秘密情報の確認を完了できませんでした（gitleaks が失敗しました）",
  report: "秘密情報の確認を完了できませんでした（gitleaks の結果を読めませんでした）",
  image: "秘密情報の確認を完了できませんでした（gitleaks のイメージの指定を読めませんでした）",
  readable:
    "秘密情報の確認を完了できませんでした（読めないファイル・フォルダの調べに失敗しました）",
  git: "秘密情報の確認を完了できませんでした（Git のリポジトリかどうかを確かめられませんでした。所有権・アクセス権の問題の可能性があります）",
} as const;

/** 後始末の失敗の文（決まった文だけ） */
export const SCAN_WARNING = {
  container:
    "警告: gitleaks のコンテナを消せなかった可能性があります。docker ps -a で harness-secret-scan- で始まるコンテナを確かめ、あれば docker rm -f で消してください。",
  tempDir:
    "警告: レポートの一時フォルダを消せませんでした。次のフォルダを確かめて、消してください：",
} as const;

export interface RunResult {
  /** 終了コード。起動できなかった・中断・時間切れのときは null */
  exitCode: number | null;
  failedToStart: boolean;
  timedOut: boolean;
  aborted: boolean;
  /** 標準出力（captureStdout を指定したときだけ。docker の実行では使わない・出さない） */
  stdout: string;
  /** 標準エラー（captureStderr を指定したときだけ。判定に使うだけで、出さない） */
  stderr: string;
}

export interface RunOptions {
  signal: AbortSignal;
  timeoutMs: number;
  captureStdout?: boolean;
  captureStderr?: boolean;
  /** 追加の環境変数 */
  env?: Record<string, string>;
}

/** 子プロセスの実行役（差し替え用）。標準エラー・docker の標準出力は残さない */
export type Runner = (command: string, args: string[], options: RunOptions) => Promise<RunResult>;

/**
 * gitleaks のレポートのテンプレート（--report-format template）。許可した4項目（RuleID・File・StartLine・Commit）だけを JSON で出す。
 * --redact は Message（コミットメッセージ）などを伏せないため、レポートの生成の時点で、値の入りうる項目を出さない。
 * 空なら []。文字列は Sprig の mustToJson で JSON としてエンコードする（Go の %q は ESC を  と出し、JSON として読めない）。
 */
export const REPORT_TEMPLATE =
  '[{{ range $i, $f := . }}{{ if $i }},{{ end }}{"RuleID":{{ mustToJson $f.RuleID }},"File":{{ mustToJson $f.File }},"StartLine":{{ $f.StartLine }},"Commit":{{ mustToJson $f.Commit }}}{{ end }}]';
const TEMPLATE_FILE = "report.tmpl";

const STDOUT_LIMIT = 64 * 1024;

export const realRunner: Runner = (command, args, options) =>
  new Promise<RunResult>((resolve) => {
    const base: RunResult = {
      exitCode: null,
      failedToStart: false,
      timedOut: false,
      aborted: false,
      stdout: "",
      stderr: "",
    };
    if (options.signal.aborted) {
      resolve({ ...base, aborted: true });
      return;
    }
    let timedOut = false;
    let aborted = false;
    let stdout = "";
    let stderr = "";
    let done = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        stdio: [
          "ignore",
          options.captureStdout === true ? "pipe" : "ignore",
          options.captureStderr === true ? "pipe" : "ignore",
        ],
        ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
        windowsHide: true,
      });
    } catch {
      resolve({ ...base, failedToStart: true });
      return;
    }
    const finish = (result: RunResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => {
      aborted = true;
      child.kill();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
    options.signal.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < STDOUT_LIMIT) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < STDOUT_LIMIT) stderr += chunk.toString("utf8");
    });
    child.on("error", () => finish({ ...base, failedToStart: true }));
    child.on("close", (code) =>
      finish({
        exitCode: aborted || timedOut ? null : code,
        failedToStart: false,
        timedOut,
        aborted,
        stdout,
        stderr,
      }),
    );
  });

/** gitleaks のイメージ（image:tag@digest）。#42 と同じ値を、技術プロファイルから取る（二重に持たない） */
export function gitleaksImage(templatesDir: string = findTemplatesDir()): string {
  const profile = loadProfile(templatesDir, PROFILE_KEY);
  const image = containerImageValues([profile])[IMAGE_VALUE];
  if (image === undefined) {
    throw new GenerateError(
      `技術プロファイル ${PROFILE_KEY} の container_images に gitleaks がありません`,
    );
  }
  return image;
}

export interface ArgsInput {
  image: string;
  /** コンテナの名前（中断・時間切れのときに消す） */
  name: string;
  /** /src に読み取り専用で置くフォルダ */
  sourceDir: string;
  /** レポートを出す一時フォルダ（/out に置く。ここだけが書き込める） */
  outDir: string;
}

/**
 * docker run の引数。ネットワークなし・対象は読み取り専用・--redact（値を伏せる）・
 * レポートは一時フォルダの JSON ファイルにだけ出す（標準出力には出さない）。
 * git は履歴、dir は作業フォルダ（未コミット・未追跡を含む。.git の中は gitleaks の既定で調べない）。
 */
export function gitleaksArgs(mode: "git" | "dir", input: ArgsInput): string[] {
  return [
    "run",
    "--rm",
    "--name",
    input.name,
    "--network",
    "none",
    "-v",
    `${input.sourceDir}:/src:ro`,
    "-v",
    `${input.outDir}:/out`,
    "-w",
    "/src",
    input.image,
    mode,
    "/src",
    "--redact",
    "--no-banner",
    "--log-level",
    "error",
    "--exit-code",
    "1",
    "--report-format",
    "template",
    "--report-template",
    `/out/${TEMPLATE_FILE}`,
    "--report-path",
    `/out/${REPORT_FILE}`,
  ];
}

class ReportError extends Error {
  constructor() {
    super("gitleaks の結果の形が想定と違います");
    this.name = "ReportError";
  }
}

const hex2 = (code: number): string =>
  code <= 0xff ? `\\x${code.toString(16).padStart(2, "0")}` : `\\u{${code.toString(16)}}`;

/** 制御文字（端末の操作・行の偽装に使えるもの）を、見える形に逃がす */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu;
const escapeControl = (text: string): string =>
  text.replace(CONTROL, (c) => hex2(c.codePointAt(0) ?? 0));

const FILE_LIMIT = 300;

/**
 * gitleaks の JSON のレポートから、場所・行・コミット・種類だけを取り出す。
 * 値の入りうる項目（Secret・Match・Line など）は読まない。型を確かめ、新しいオブジェクトに一つずつ写す。
 * 形が違えば ReportError（文に入力の中身は入れない）。
 */
export function parseLeakReport(text: string): Leak[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ReportError();
  }
  if (!Array.isArray(data)) throw new ReportError();
  return data.map((item: unknown): Leak => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new ReportError();
    const record = item as Record<string, unknown>;
    const file = record["File"];
    const line = record["StartLine"];
    const rule = record["RuleID"];
    const commit = record["Commit"];
    if (typeof file !== "string" || file === "") throw new ReportError();
    if (typeof line !== "number" || !Number.isInteger(line) || line < 1) throw new ReportError();
    if (typeof rule !== "string") throw new ReportError();
    if (commit !== undefined && typeof commit !== "string") throw new ReportError();
    const shownFile = escapeControl(file.replace(/^\/src\//, "")).slice(0, FILE_LIMIT);
    const leak: Leak = { file: shownFile, line, rule: rule.replace(/[^\w.-]/gu, "?") };
    if (typeof commit === "string" && /^[0-9a-f]{40}$/.test(commit)) {
      leak.commit = commit.slice(0, 7);
    }
    return leak;
  });
}

/** 見つかったものの表示（値は含めない）。履歴（コミットあり）と作業フォルダ（コミットなし）を分ける */
export function formatLeaks(history: Leak[], worktree: Leak[]): string[] {
  const lines: string[] = [];
  let shown = 0;
  const total = history.length + worktree.length;
  const block = (title: string, leaks: Leak[]): void => {
    if (leaks.length === 0 || shown >= SHOWN_LIMIT) return;
    lines.push(title);
    for (const leak of leaks) {
      if (shown >= SHOWN_LIMIT) break;
      const where = `${leak.file}:${String(leak.line)}`;
      lines.push(
        leak.commit !== undefined
          ? `  - ${where}（コミット ${leak.commit}・種類 ${leak.rule}）`
          : `  - ${where}（種類 ${leak.rule}）`,
      );
      shown += 1;
    }
  };
  block("履歴（コミット済み）で見つかったもの：", history);
  block("作業フォルダ（未コミット・未追跡のファイルを含む）で見つかったもの：", worktree);
  if (total > shown) lines.push(`  ほか ${String(total - shown)} 件`);
  return lines;
}

export interface ScanDeps {
  /** 実行役の差し替え（テスト用）。既定は本物の docker・git */
  runner?: Runner;
  /** 中断の合図 */
  signal?: AbortSignal;
  /** イメージを調べるテンプレートの置き場所の差し替え（テスト用） */
  templatesDir?: string;
  /** レポートの一時フォルダを作る場所の差し替え（テスト用）。既定は OS の一時フォルダ */
  tmpDir?: string;
  /** 1回の実行の時間切れ（ミリ秒）。既定は 10 分 */
  timeoutMs?: number;
  /** 後始末の失敗の知らせ先（決まった文だけが渡される）。既定は何もしない */
  onWarning?: (message: string) => void;
  /** docker run に足す引数（テスト用。root の権限を落とした環境をまねる）。既定は無し */
  extraDockerArgs?: string[];
  /** 一時フォルダの削除の差し替え（テスト用）。既定は rm -r */
  removeDir?: (dir: string) => Promise<void>;
  /** テンプレートの書き込みの差し替え（テスト用）。既定は writeFile */
  writeTemplate?: (file: string, text: string) => Promise<void>;
}

/**
 * 読めないファイル・フォルダの数を数えるシェルスクリプト（gitleaks のイメージの sh と find）。
 * gitleaks は、読めないファイル・入れないフォルダを黙って飛ばし、exit 0 になりうる。
 * gitleaks と同じユーザー・同じマウントで、/src の下を調べる。.git の中は、履歴の確認で扱うので除く。
 * 名前は出さない：find の出力は wc にだけつなぎ、数だけを標準出力に出す（標準エラーも同じ）。
 */
export const UNREADABLE_SCRIPT = [
  "e=$(find /src -path /src/.git -prune -o -print 2>&1 >/dev/null | wc -l)",
  "u=$(find /src -path /src/.git -prune -o \\( -type f -o -type d \\) ! -exec test -r {} \\; -print 2>/dev/null | wc -l)",
  "echo $((e + u))",
].join("\n");

const failed = (message: string): SecretScanResult => ({ kind: "failed", message });

/** git が「リポジトリではない」と答えたときの標準エラー（LC_ALL=C で英語にそろえて読む） */
const NOT_A_REPOSITORY = /not a git repository/i;
const GIT_REFUSED = /dubious ownership|permission denied|safe\.directory/i;

/**
 * root の秘密情報を確かめる。Git のリポジトリなら、履歴と作業フォルダ（未コミット・未追跡を含む）の両方。
 * 「Git のリポジトリではない」と確かめられたときだけ、作業フォルダだけを調べる。
 * Git かどうかを確かめられないとき（起動失敗・時間切れ・所有権やアクセス権の拒否・想定外の出力）は失敗。
 * どちらかが失敗なら失敗（片方の結果で通さない）。
 * 中断されたら CancelledError。それ以外は、決まった文の結果を返す。
 */
export async function scanSecrets(root: string, deps: ScanDeps = {}): Promise<SecretScanResult> {
  const rawRunner = deps.runner ?? realRunner;
  const signal = deps.signal ?? new AbortController().signal;
  const timeoutMs = deps.timeoutMs ?? TOOL_TIMEOUT_MS;
  const warn = deps.onWarning ?? (() => undefined);
  const removeDir =
    deps.removeDir ??
    ((dir: string) => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  // 実行役が投げた例外の文は、使わない（値が入りうる）
  const run = async (command: string, args: string[], options: RunOptions): Promise<RunResult> => {
    try {
      return await rawRunner(command, args, options);
    } catch {
      return {
        exitCode: null,
        failedToStart: true,
        timedOut: false,
        aborted: false,
        stdout: "",
        stderr: "",
      };
    }
  };

  let image: string;
  try {
    image = gitleaksImage(deps.templatesDir);
  } catch {
    return failed(SCAN_FAILED.image);
  }

  const info = await run("docker", ["info"], { signal, timeoutMs: PROBE_TIMEOUT_MS });
  if (info.aborted) throw new CancelledError();
  if (info.failedToStart || info.timedOut || info.exitCode !== 0) return { kind: "docker-missing" };

  // Git のリポジトリか。トップを調べる（--dir がサブフォルダでも、履歴はリポジトリ全体を見る）
  const probe = await run("git", ["-C", root, "rev-parse", "--show-toplevel"], {
    signal,
    timeoutMs: PROBE_TIMEOUT_MS,
    captureStdout: true,
    captureStderr: true,
    env: { LC_ALL: "C", LANGUAGE: "C" },
  });
  if (probe.aborted) throw new CancelledError();
  const topLines = probe.stdout.split(/\r?\n/).filter((l) => l !== "");
  let isGit: boolean;
  if (!probe.failedToStart && !probe.timedOut && probe.exitCode === 0 && topLines.length === 1) {
    isGit = true;
  } else if (
    !probe.failedToStart &&
    !probe.timedOut &&
    probe.exitCode === 128 &&
    NOT_A_REPOSITORY.test(probe.stderr) &&
    !GIT_REFUSED.test(probe.stderr)
  ) {
    isGit = false;
  } else {
    return failed(SCAN_FAILED.git);
  }
  const top = isGit ? (topLines[0] ?? root) : root;
  const scope: ScanScope = isGit ? "history+worktree" : "worktree";
  // 実際に /src に置くフォルダの .gitleaks.toml（gitleaks が使う）
  const gitleaksConfig = await lstat(path.join(top, ".gitleaks.toml")).then(
    () => true,
    () => false,
  );

  let outDir: string;
  try {
    outDir = await mkdtemp(path.join(deps.tmpDir ?? os.tmpdir(), "harness-secret-scan-"));
  } catch {
    return failed(SCAN_FAILED.start);
  }
  // 作成の直後から、削除の対象にする（テンプレートの書き込みに失敗しても消える）
  try {
    try {
      await (deps.writeTemplate ?? ((file, text) => writeFile(file, text)))(
        path.join(outDir, TEMPLATE_FILE),
        REPORT_TEMPLATE,
      );
    } catch {
      return failed(SCAN_FAILED.start);
    }
    // docker run に足す引数（テスト用）を、"run --rm" の直後に入れる
    const withExtra = (args: string[]): string[] => [
      ...args.slice(0, 2),
      ...(deps.extraDockerArgs ?? []),
      ...args.slice(2),
    ];
    const one = async (mode: "git" | "dir"): Promise<Leak[] | string> => {
      const name = `harness-secret-scan-${randomBytes(6).toString("hex")}`;
      const reportPath = path.join(outDir, REPORT_FILE);
      await rm(reportPath, { force: true });
      // 正常終了（終了コード 0 / 1 で、結果を読めた）を確かめられたときだけ省く。それ以外は、コンテナが残りうる
      let needsCleanup = true;
      try {
        const result = await run(
          "docker",
          withExtra(gitleaksArgs(mode, { image, name, sourceDir: top, outDir })),
          { signal, timeoutMs },
        );
        if (result.aborted) throw new CancelledError();
        if (result.timedOut) return SCAN_FAILED.timeout;
        if (result.failedToStart) return SCAN_FAILED.start;
        if (result.exitCode !== 0 && result.exitCode !== 1) return SCAN_FAILED.exit;
        let leaks: Leak[];
        try {
          leaks = parseLeakReport(await readFile(reportPath, "utf8"));
        } catch {
          return SCAN_FAILED.report;
        }
        needsCleanup = false;
        // 終了コードとレポートが食い違えば、信用しない（0 なら空、1 なら 1 件以上）
        if ((result.exitCode === 0) !== (leaks.length === 0)) return SCAN_FAILED.report;
        return leaks;
      } finally {
        if (needsCleanup) await removeContainer(name);
      }
    };

    /** 残ったコンテナを、名前で探して消す（失敗は固定の文で知らせる） */
    const removeContainer = async (name: string): Promise<void> => {
      const quiet = { signal: new AbortController().signal, timeoutMs: PROBE_TIMEOUT_MS };
      const listed = await run("docker", ["ps", "-aq", "--filter", `name=^${name}$`], {
        ...quiet,
        captureStdout: true,
      });
      if (listed.failedToStart || listed.timedOut || listed.exitCode !== 0) {
        warn(SCAN_WARNING.container);
        return;
      }
      if (listed.stdout.trim() === "") return;
      const removed = await run("docker", ["rm", "-f", name], quiet);
      if (removed.failedToStart || removed.timedOut || removed.exitCode !== 0) {
        warn(SCAN_WARNING.container);
      }
    };

    /** 読めないファイル・フォルダの数。調べに失敗したら固定の文 */
    const countUnreadable = async (): Promise<number | string> => {
      const name = `harness-secret-scan-${randomBytes(6).toString("hex")}`;
      let needsCleanup = true;
      try {
        const result = await run(
          "docker",
          withExtra([
            "run",
            "--rm",
            "--name",
            name,
            "--network",
            "none",
            "-v",
            `${top}:/src:ro`,
            "--entrypoint",
            "sh",
            image,
            "-c",
            UNREADABLE_SCRIPT,
          ]),
          { signal, timeoutMs, captureStdout: true },
        );
        if (result.aborted) throw new CancelledError();
        if (result.timedOut) return SCAN_FAILED.timeout;
        if (result.failedToStart || result.exitCode !== 0) return SCAN_FAILED.readable;
        const text = result.stdout.trim();
        if (!/^\d{1,9}$/.test(text)) return SCAN_FAILED.readable;
        needsCleanup = false;
        return Number(text);
      } finally {
        if (needsCleanup) await removeContainer(name);
      }
    };

    let history: Leak[] = [];
    if (isGit) {
      const found = await one("git");
      if (typeof found === "string") return failed(found);
      history = found;
    }
    // gitleaks は読めないものを黙って飛ばすため、作業フォルダの確認の前に、読めないものが無いかを調べる
    const unreadable = await countUnreadable();
    if (typeof unreadable === "string") return failed(unreadable);
    if (unreadable > 0) return { kind: "unreadable", count: unreadable };
    const found = await one("dir");
    if (typeof found === "string") return failed(found);
    if (history.length === 0 && found.length === 0) return { kind: "clean", scope, gitleaksConfig };
    return { kind: "leaks", scope, history, worktree: found };
  } finally {
    await removeDir(outDir).catch(() => {
      warn(`${SCAN_WARNING.tempDir}${outDir}`);
    });
  }
}
