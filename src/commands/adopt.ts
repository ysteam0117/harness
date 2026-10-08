import { readFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { buildAdoptFiles, type AdoptFile } from "../adopt/build.js";
import {
  CLASS_ORDER,
  detectStack,
  loadDetectionRules,
  matchProfiles,
  type DetectClass,
  type DetectedStack,
  type ProfileMatch,
} from "../adopt/detect.js";
import {
  formatLeaks,
  scanSecrets,
  type Runner,
  type ScanScope,
  type SecretScanResult,
} from "../adopt/secret-scan.js";
import { extractBlock, mergeBlock, MarkerError } from "../adopt/markers.js";
import { planAdopt, type AdoptDecision } from "../adopt/plan.js";
import {
  buildConfigText,
  CONFIG_PATH,
  localDay,
  type SecretScanRecord,
} from "../generate/config.js";
import { GenerateError } from "../generate/errors.js";
import { judge } from "../generate/judgment.js";
import { rolesFor } from "../generate/roles.js";
import { AnswersError, parseAnswersYaml, type Answers } from "../questions/answers.js";
import { validateAppName } from "../questions/app-name.js";
import { questionDefinitions } from "../questions/definitions.js";
import { findMissing, runQuestions } from "../questions/flow.js";
import { CancelledError, createClackPrompter, type Prompter } from "../questions/prompter.js";
import {
  applyUpdate,
  ApplyFailed,
  ChangedAfterJudgment,
  RollbackIncomplete,
  UpdateInterrupted,
  type ApplyOp,
} from "../update/apply.js";
import { formatDiff } from "../update/diff.js";
import { realUpdateFs, type UpdateFs } from "../update/fs.js";
import type { FileState } from "../update/plan.js";
import { isUtf8Text, messageOf, readState, type FileSnapshot } from "../update/state.js";
import { interruptible } from "./update.js";

export interface AdoptDeps {
  prompter: Prompter;
  /** 導入するプロジェクトの場所の基準（--dir がなければ、ここ） */
  cwd: string;
  interactive: boolean;
  stderr: (text: string) => void;
  /** 結果の一覧（PR の本文に貼れる Markdown）の出力先 */
  stdout: (text: string) => void;
  /** 導入した日の差し替え（テスト用）。既定は現在の日時 */
  now?: () => Date;
  /** ファイル操作の差し替え（テスト用）。既定は本物 */
  fs?: Partial<UpdateFs>;
  /** 秘密情報の確認の差し替え（テスト用）。既定は Docker の gitleaks（src/adopt/secret-scan.ts） */
  secretScan?: (root: string, signal: AbortSignal) => Promise<SecretScanResult>;
  /** docker・git の実行役の差し替え（テスト用。secretScan を差し替えないときに使う） */
  runner?: Runner;
}

export interface AdoptOptions {
  /** --answers：質問への回答をまとめたファイル（必須。足りない項目だけ質問する） */
  answers?: string;
  /** --yes：確認を省く（同じ名前のファイルは、残す） */
  yes?: boolean;
  /** --dir：導入するプロジェクトのフォルダ（既定は作業中のフォルダ） */
  dir?: string;
  /** --dry-run：一覧と差分だけを表示し、何も書かない */
  dryRun?: boolean;
  /** --skip-secret-scan：秘密情報の確認を省く（Docker が無いときなど。確認していないと記録する） */
  skipSecretScan?: boolean;
}

export interface AdoptOutcome {
  exitCode: number;
}

const CANCEL_MESSAGE = "中断しました。ファイルは変更していません。";
const LOCK_PATH = ".harness/.update-lock";
const HARNESS_DIR = ".harness";
const START_NOTICE =
  "harness adopt は、ファイルを書くだけです。コミット・push はしません。導入の差分は、Git で確かめてください。";

/** 秘密情報の確認の結果（開始の表示・レポート・config に使う） */
type ScanOutcome =
  { status: "skipped" } | { status: "passed"; scope: ScanScope; gitleaksConfig: boolean };

/** 確認の結果の説明（開始の表示とレポートに出す） */
function scanSentence(scan: ScanOutcome): string {
  if (scan.status === "skipped") {
    return "秘密情報の確認：確認していません（--skip-secret-scan で省きました）。導入の前に、履歴を含めて、秘密情報が含まれていないことを確かめてください。--dry-run などの差分の表示には、既存のファイルの値が出ることがあります。";
  }
  return scan.scope === "history+worktree"
    ? "秘密情報の確認：問題は見つかりませんでした（Git の履歴と、作業フォルダ（未コミット・未追跡のファイルを含む）を gitleaks で確かめました）。"
    : "秘密情報の確認：問題は見つかりませんでした（Git のリポジトリではないため、作業フォルダのみ確かめました。履歴は確かめていません）。";
}

const GITLEAKS_CONFIG_NOTICE =
  "このフォルダの .gitleaks.toml の設定が、確認に使われます（その設定で許可したものは、見つかりません）。";
const SCAN_PROGRESS =
  "秘密情報を確認しています（Docker で gitleaks を実行します。履歴が長いと時間がかかります）。";
const EDIT_NOTICE = "導入の間は、ファイルを編集しないでください。";

class Stop extends Error {
  readonly exitCode: number;
  constructor(exitCode: number) {
    super("stop");
    this.exitCode = exitCode;
  }
}

const codeOf = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null ? (e as NodeJS.ErrnoException).code : undefined;

/** 既存のアプリに、AI 向けのルールを足す（F-29 の最小限）。判定 → 確認 → 原子的な書き込み */
export async function runAdopt(options: AdoptOptions, deps: AdoptDeps): Promise<AdoptOutcome> {
  try {
    return await run(options, deps);
  } catch (e) {
    if (e instanceof Stop) return { exitCode: e.exitCode };
    if (e instanceof CancelledError) {
      deps.stderr(`${CANCEL_MESSAGE}\n`);
      return { exitCode: 130 };
    }
    throw e;
  }
}

async function run(options: AdoptOptions, deps: AdoptDeps): Promise<AdoptOutcome> {
  const fs: UpdateFs = { ...realUpdateFs, ...deps.fs };
  const dryRun = options.dryRun === true;
  const yes = options.yes === true;
  const fail = (message: string): never => {
    deps.stderr(`エラー: ${message}\n`);
    throw new Stop(1);
  };

  // 場所
  let root: string;
  try {
    root = await fs.realpath(path.resolve(deps.cwd, options.dir ?? "."));
  } catch (e) {
    return fail(`プロジェクトのフォルダを開けません（${messageOf(e)}）`);
  }

  // すでに導入済み（または create で作った）プロジェクトには、導入しない
  try {
    const config = await readState(fs, root, CONFIG_PATH);
    if (config.kind === "file") {
      return fail(
        `${CONFIG_PATH} がすでにあります。このプロジェクトは、ハーネスを導入済みです。状態の確認は harness status を使ってください（harness adopt は、導入していないプロジェクトに使います。導入したプロジェクトに新しいハーネスを反映するには、harness update を使ってください）`,
      );
    }
  } catch (e) {
    if (e instanceof GenerateError) return fail(e.message);
    throw e;
  }

  // 回答（--answers は必須。足りない項目だけ質問する）
  if (options.answers === undefined) {
    return fail(
      "--answers で回答ファイルを指定してください（harness adopt は、回答ファイルが必要です。足りない項目だけ質問します）",
    );
  }
  const answersFile = path.resolve(deps.cwd, options.answers);
  let text: string;
  try {
    text = readFileSync(answersFile, "utf8");
  } catch (e) {
    return fail(`回答ファイルを読めません：${answersFile}（${messageOf(e)}）`);
  }
  let initial: Partial<Answers>;
  try {
    initial = { ...parseAnswersYaml(text).answers };
  } catch (e) {
    if (!(e instanceof AnswersError)) throw e;
    deps.stderr(`エラー: 回答ファイルに問題があります（${answersFile}）\n`);
    for (const message of e.errors) deps.stderr(`  - ${message}\n`);
    throw new Stop(1);
  }
  // アプリ名は、常にフォルダの名前から決める（回答ファイルに書いてあれば、同じ名前のときだけ可）
  const folderName = path.basename(root);
  const problem = validateAppName(folderName);
  if (problem !== undefined) {
    return fail(
      `フォルダの名前「${folderName}」は、アプリ名として使えません（${problem}）。アプリ名にできる名前のフォルダで実行してください`,
    );
  }
  if (initial.app_name !== undefined && initial.app_name !== folderName) {
    return fail(
      `回答ファイルの app_name「${initial.app_name}」が、フォルダの名前「${folderName}」と違います。アプリ名はフォルダの名前から決めます。回答ファイルの app_name を ${folderName} にするか、消してください`,
    );
  }
  initial.app_name = folderName;

  if (!yes && !dryRun && !deps.interactive) {
    return fail(
      "端末で実行していないため、確認できません。確認を省くには --yes を付けてください（--dry-run で、何が変わるかだけを確かめられます）",
    );
  }
  if (!deps.interactive) {
    const missing = findMissing(questionDefinitions, initial);
    if (missing.length > 0) {
      deps.stderr("エラー: 端末で実行していないため質問できません。次の回答が足りません。\n");
      for (const id of missing) {
        const title = questionDefinitions.find((d) => d.id === id)?.title ?? id;
        deps.stderr(`  - ${id}（${title}）\n`);
      }
      deps.stderr("--answers の回答ファイルに書いてください。\n");
      throw new Stop(1);
    }
  }

  // 並行の実行を防ぐ（--dry-run は何も書かないので、ロックしない）
  const lock = path.join(root, ...LOCK_PATH.split("/"));
  const harnessDir = path.join(root, HARNESS_DIR);
  const controller = new AbortController();
  const onInterrupt = (): void => controller.abort();
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  let locked = false;
  let createdHarnessDir = false;
  try {
    // 秘密情報の確認（回答・アプリ名の確認の後、ロックと .harness を作る前。--dry-run でも確認する）
    const scan = await checkSecrets(root, options, deps, fail, controller.signal);

    if (!dryRun) {
      createdHarnessDir = await fs.lstat(harnessDir).then(
        () => false,
        (e: unknown) => {
          if (codeOf(e) === "ENOENT") return true;
          throw e;
        },
      );
      try {
        await fs.mkdir(harnessDir, { recursive: true });
        await fs.createExclusive(lock, `${String(process.pid)}\n`);
        locked = true;
      } catch (e) {
        if (codeOf(e) === "EEXIST") {
          createdHarnessDir = false;
          return fail(
            `別の導入・更新が実行中か、前回が途中で止まりました。${lock} を確かめてください（実行中でなければ、このファイルを消してから、もう一度実行します）`,
          );
        }
        return fail(`ロックを作れませんでした：${lock}（${messageOf(e)}）`);
      }
    }
    if (controller.signal.aborted) throw new CancelledError();
    const result = await adopt(root, initial, options, deps, fs, fail, controller.signal, scan);
    if (controller.signal.aborted && result.applied) {
      deps.stderr("導入は完了しました。\n");
    } else if (controller.signal.aborted && result.exitCode === 0) {
      throw new CancelledError();
    }
    return { exitCode: result.exitCode };
  } finally {
    try {
      if (locked) await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
      // 何も書かなかったときは、こちらが作った .harness フォルダも消す（空のときだけ）
      if (createdHarnessDir) await fs.rmdir(harnessDir).catch(() => undefined);
    } finally {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
    }
  }
}

/**
 * 秘密情報の確認。通ったら結果（範囲）、省いたら skipped を返す。
 * 見つかった・Docker が無い・確認できなかったときは、何も書かずに止める（値は出さない）。
 */
async function checkSecrets(
  root: string,
  options: AdoptOptions,
  deps: AdoptDeps,
  fail: (message: string) => never,
  signal: AbortSignal,
): Promise<ScanOutcome> {
  if (options.skipSecretScan === true) return { status: "skipped" };
  deps.prompter.note(SCAN_PROGRESS, "秘密情報の確認");
  const scan =
    deps.secretScan ??
    ((r: string, s: AbortSignal) =>
      scanSecrets(r, {
        signal: s,
        onWarning: (m) => deps.stderr(`${m}\n`),
        ...(deps.runner ? { runner: deps.runner } : {}),
      }));
  const result = await scan(root, signal);
  if (signal.aborted) throw new CancelledError();
  switch (result.kind) {
    case "clean":
      return {
        status: "passed",
        scope: result.scope,
        gitleaksConfig: result.gitleaksConfig === true,
      };
    case "docker-missing":
      return fail(
        "秘密情報の確認に Docker が必要です（Docker が見つからないか、動いていません）。Docker を起動してください。確認を省くなら --skip-secret-scan を付けます（確認していないと記録されます）。何も書いていません",
      );
    case "docker-not-linux":
      return fail(
        "秘密情報の確認に、Linux コンテナを動かせる Docker が必要です（今の Docker は Windows コンテナのモードです）。Linux コンテナに切り替えてください。確認を省くなら --skip-secret-scan を付けます（確認していないと記録されます）。何も書いていません",
      );
    case "failed":
      return fail(`${result.message}。何も書いていません`);
    case "unreadable":
      return fail(
        `読めないファイル・フォルダが ${String(result.count)} 件あり、秘密情報を確かめきれません。権限を直すか、--skip-secret-scan で省いてください（確認していないと記録されます）。何も書いていません`,
      );
    case "leaks": {
      deps.stderr(
        "エラー: 秘密情報らしいものが見つかりました（値は表示しません）。何も書いていません\n",
      );
      for (const line of formatLeaks(result.history, result.worktree)) deps.stderr(`${line}\n`);
      deps.stderr(
        "本物の秘密なら、値の取り消しと作り直しが必要です。Git の履歴から消すかどうかは、利用者が決めて行います（harness adopt は、履歴を書き換えません）。誤検知なら、このフォルダの .gitleaks.toml で許可します。直したら、もう一度実行してください。確認を省くなら --skip-secret-scan を付けます（確認していないと記録されます）。\n",
      );
      throw new Stop(1);
    }
  }
}

/** 導入の結果（追加した・統合した…）。レポートに使う */
interface Outcome {
  added: string[];
  merged: { path: string; created: boolean }[];
  replaced: string[];
  kept: string[];
  same: string[];
}

function tally(d: AdoptDecision, o: Outcome): void {
  switch (d.kind) {
    case "doc-merge":
      o.merged.push({ path: d.path, created: d.current === undefined });
      break;
    case "add":
      o.added.push(d.path);
      break;
    case "same":
      o.same.push(d.path);
      break;
    case "choose":
      o.kept.push(d.path);
      break;
  }
}

const CLASS_LABEL: Record<DetectClass, string> = {
  language: "言語",
  runtime: "実行環境",
  backend: "バックエンド",
  frontend: "フロントエンド",
  db: "DB",
  test: "テスト",
  quality: "品質チェック",
  ci: "CI",
};
const WILL_APPLY = "当てる予定（#18 の続きで入れる）";

const dirLabel = (dir: string): string => (dir === "." ? "ルート" : `\`${dir}\``);
const dirsLabel = (dirs: string[]): string => dirs.map(dirLabel).join("、");

/** 技術の判定・プロファイル・プロファイルなしの節（F-29 の「既存の技術の扱い」）。技術プロファイルの Skill は、まだ入れない */
function detectionLines(stack: DetectedStack, match: ProfileMatch): string[] {
  const lines: string[] = [];
  const found = stack.apps.flatMap((a) => a.items.map((i) => ({ dir: a.dir, item: i })));
  if (found.length > 0) {
    lines.push("### 技術の判定", "");
    lines.push(
      "ファイルから機械的に判定しました（.env 等の秘密情報のファイルは読んでいません）。",
      "",
    );
    for (const { dir, item } of found) {
      const version = item.version === undefined ? "" : ` ${item.version}`;
      const evidence = item.evidence.map((e) => `\`${e}\``).join("、");
      lines.push(
        `- ${dirLabel(dir)}：${CLASS_LABEL[item.class]} ${item.technology}${version}（根拠：${evidence}）`,
      );
    }
    lines.push("");
  }
  if (stack.notes.length > 0) {
    lines.push("### 読まなかったもの", "");
    for (const n of stack.notes) lines.push(`- \`${n.path}\`：${n.reason}`);
    lines.push("");
  }
  if (match.applied.length > 0) {
    lines.push("### 技術プロファイル", "");
    lines.push(
      "必要な手がかりがすべて合った技術プロファイルです。今は技術によらない共通のルールだけを入れます。プロファイルの Skill は、まだ入れません。",
      "",
    );
    for (const a of match.applied) {
      lines.push(`- ${a.profile}：${WILL_APPLY}（対象：${dirsLabel(a.apps)}）`);
    }
    lines.push("");
  }
  if (match.none.length > 0) {
    lines.push("### プロファイルなし", "");
    lines.push(
      "技術ごとのルールは入れず、技術によらない共通のルールだけを入れます。技術プロファイルを作る提案は、ハーネスの改善の提案（C-78）として出します。",
      "",
    );
    const ordered = [...match.none].sort(
      (a, b) => CLASS_ORDER.indexOf(a.category) - CLASS_ORDER.indexOf(b.category),
    );
    for (const n of ordered) {
      const partial =
        n.partial !== undefined && n.partial.length > 0
          ? `（一部一致：${n.partial.join("・")}）`
          : "";
      lines.push(
        n.category === "language"
          ? `- プロファイルなし（${n.technology}）（対象：${dirsLabel(n.apps)}）`
          : `- ${CLASS_LABEL[n.category]} ${n.technology}：プロファイルなし${partial}（対象：${dirsLabel(n.apps)}）`,
      );
    }
    lines.push("");
    for (const n of ordered) {
      lines.push(
        `- ${n.technology} の技術プロファイルを作る提案：ハーネスのリポジトリに Issue を作ってください（harness は Issue を作りません）`,
      );
    }
    lines.push("");
  }
  return lines;
}

function renderReport(input: {
  dryRun: boolean;
  outcome: Outcome;
  diffs: { path: string; text: string }[];
  appName: string;
  scan: ScanOutcome;
  stack: DetectedStack;
  match: ProfileMatch;
}): string {
  const o = input.outcome;
  const lines: string[] = [];
  const section = (title: string, intro: string | undefined, items: string[]): void => {
    if (items.length === 0) return;
    lines.push(`### ${title}`, "");
    if (intro !== undefined) lines.push(intro, "");
    lines.push(...items.map((i) => `- ${i}`), "");
  };
  lines.push(`## ハーネスの導入（${input.appName}）`, "");
  lines.push(`- ${scanSentence(input.scan)}`, "");
  if (input.dryRun) {
    lines.push("--dry-run のため、何も書いていません。実行すると、次のとおりになります。", "");
  }
  section(
    "印で囲んで統合",
    input.dryRun
      ? "既存の文章は変えず、ハーネスの部分を印で囲んで足します（ファイルが無ければ、作ります）。"
      : "既存の文章は変えず、ハーネスの部分を印で囲んで足しました（ファイルが無ければ、作りました）。",
    o.merged.map((m) => `\`${m.path}\`${m.created ? "（新しく作る）" : ""}`),
  );
  section(
    "追加",
    input.dryRun
      ? "同じ名前のファイルが無いので、追加します。"
      : "同じ名前のファイルが無いので、追加しました。",
    o.added.map((p) => `\`${p}\``),
  );
  section(
    "置き換え",
    input.dryRun ? undefined : "同じ名前のファイルを、選んで置き換えました。",
    o.replaced.map((p) => `\`${p}\``),
  );
  section(
    "残した",
    input.dryRun
      ? "同じ名前で中身が違うファイルです。対話では、置き換えるかを選べます。--yes では、既存を残します。"
      : "同じ名前で中身が違うファイルです。既存を残しました（ハーネスの管理には入れていません）。",
    o.kept.map((p) => `\`${p}\``),
  );
  section(
    "同じ内容",
    "すでに同じ内容のファイルです（書き換えません）。",
    o.same.map((p) => `\`${p}\``),
  );
  lines.push(...detectionLines(input.stack, input.match));
  if (input.dryRun && input.diffs.length > 0) {
    lines.push("### 差分", "");
    for (const d of input.diffs) lines.push(`#### ${d.path}`, "", "```diff", d.text, "```", "");
  }
  if (!input.dryRun) {
    lines.push(
      "### 次にすること",
      "",
      "導入した差分を Git で確かめ、既存のテストと品質チェックを実行し、Issue・PR（またはブランチ）で取り込んでください（main に直接入れません）。harness adopt は、コミット・push をしていません。",
      "",
    );
  }
  return lines.join("\n");
}

async function adopt(
  root: string,
  initial: Partial<Answers>,
  options: AdoptOptions,
  deps: AdoptDeps,
  fs: UpdateFs,
  fail: (message: string) => never,
  signal: AbortSignal,
  scan: ScanOutcome,
): Promise<AdoptOutcome & { applied?: true }> {
  const dryRun = options.dryRun === true;
  const yes = options.yes === true;
  const now = (deps.now ?? (() => new Date()))();
  const prompter: Prompter = {
    note: (...args) => deps.prompter.note(...args),
    text: (o) => interruptible(() => deps.prompter.text(o), signal),
    select: (o) => interruptible(() => deps.prompter.select(o), signal),
    multiselect: (o) => interruptible(() => deps.prompter.multiselect(o), signal),
    confirm: (o) => interruptible(() => deps.prompter.confirm(o), signal),
  };

  prompter.note(
    [
      scanSentence(scan),
      ...(scan.status === "passed" && scan.gitleaksConfig ? [GITLEAKS_CONFIG_NOTICE] : []),
      START_NOTICE,
      ...(dryRun ? [] : [EDIT_NOTICE]),
    ].join("\n"),
    "導入を始めます",
  );

  // 既存の技術の判定（ファイルから機械的に。回答は使わない。.env 等は読まない）
  let stack: DetectedStack;
  let match: ProfileMatch;
  try {
    const rules = loadDetectionRules();
    stack = await detectStack(root, fs, rules);
    match = matchProfiles(stack, rules);
  } catch (e) {
    if (e instanceof GenerateError) return fail(e.message);
    throw e;
  }
  if (signal.aborted) throw new CancelledError();

  // 足りない項目だけ質問する
  const quiet: Prompter = Object.create(prompter, { note: { value: () => undefined } }) as Prompter;
  let answers: Answers;
  try {
    answers = await runQuestions(questionDefinitions, quiet, initial);
  } catch (e) {
    if (e instanceof CancelledError) throw e;
    return fail(`回答を確かめられません：${messageOf(e)}`);
  }

  // 導入するファイル
  let files: AdoptFile[];
  try {
    files = buildAdoptFiles({ answers });
  } catch (e) {
    if (e instanceof GenerateError) return fail(e.message);
    throw e;
  }

  // 今のファイルの状態を読む（リンクは拒む）
  const states = new Map<string, FileSnapshot>();
  try {
    for (const f of files) {
      const state = await readState(fs, root, f.path);
      if (f.kind === "doc" && state.kind === "file" && !isUtf8Text(state)) {
        return fail(
          `${f.path} は、文字コードが UTF-8 ではないため扱えません（UTF-16・Shift_JIS など）。UTF-8 に変換してから、もう一度実行してください。何も書いていません`,
        );
      }
      states.set(f.path, state);
    }
  } catch (e) {
    if (e instanceof GenerateError) return fail(e.message);
    throw e;
  }

  // 判定。文書は、印で囲んだ統合の結果を先に作る（印が壊れていれば、ここで止まる）
  const current = new Map<string, FileState>(states);
  const decisions = planAdopt({ files, current });
  const mergedText = new Map<string, string>();
  for (const d of decisions) {
    if (d.kind !== "doc-merge") continue;
    if (d.current !== undefined) {
      const located = extractBlock(d.current);
      if (located.kind === "broken") {
        return fail(
          `${d.path} の印（harness:begin〜harness:end）が壊れています：${located.reason}。印を直してから（または消してから）、もう一度実行してください。何も書いていません`,
        );
      }
    }
    try {
      mergedText.set(d.path, mergeBlock(d.current, d.body));
    } catch (e) {
      if (e instanceof MarkerError) return fail(`${d.path}：${e.message}。何も書いていません`);
      throw e;
    }
  }

  const outcome: Outcome = { added: [], merged: [], replaced: [], kept: [], same: [] };
  for (const d of decisions) tally(d, outcome);

  // 差分（既存の文書への統合と、同じ名前で中身が違うファイル）
  const diffOf = (d: AdoptDecision): { path: string; text: string } | undefined => {
    const hint = "全体は導入した後のファイルで確かめられます";
    if (d.kind === "doc-merge") {
      return {
        path: d.path,
        text: formatDiff(d.path, d.current ?? "", mergedText.get(d.path) ?? "", hint),
      };
    }
    if (d.kind === "choose") {
      return {
        path: d.path,
        text: formatDiff(d.path, d.current, d.file.content, hint, Number.POSITIVE_INFINITY),
      };
    }
    return undefined;
  };
  const diffs = decisions.flatMap((d) => {
    const diff = diffOf(d);
    return diff === undefined ? [] : [diff];
  });

  // --dry-run：一覧と差分だけ
  if (dryRun) {
    deps.stdout(
      renderReport({ dryRun: true, outcome, diffs, appName: answers.app_name, scan, stack, match }),
    );
    return { exitCode: 0 };
  }

  // 確認（対話）／既定（--yes。同じ名前のファイルは残す）
  prompter.note(
    [
      ...outcome.merged.map((m) => `印で囲んで統合：${m.path}${m.created ? "（新しく作る）" : ""}`),
      ...outcome.added.map((p) => `追加：${p}`),
      ...outcome.kept.map((p) => `同じ名前で中身が違う：${p}`),
      ...(outcome.same.length > 0
        ? [`同じ内容（書かない）：${String(outcome.same.length)} 件`]
        : []),
    ].join("\n"),
    "導入する内容",
  );
  const replace = new Set<string>();
  if (!yes) {
    for (const d of decisions) {
      const diff = diffOf(d);
      if (diff !== undefined && d.kind === "doc-merge") {
        prompter.note(diff.text, `差分：${d.path}`);
      }
    }
    for (const d of decisions) {
      if (d.kind !== "choose") continue;
      prompter.note(
        formatDiff(d.path, d.current, d.file.content, "", Number.POSITIVE_INFINITY),
        `差分：${d.path}`,
      );
      const choice = await prompter.select<"replace" | "keep">({
        id: `adopt_conflict:${d.path}`,
        message: `${d.path} は、すでにあり、中身が違います。どうしますか`,
        options: [
          { value: "replace", label: "ハーネスの内容で置き換える" },
          { value: "keep", label: "今のファイルを残す" },
        ],
        initialValue: "keep",
      });
      if (choice === "replace") replace.add(d.path);
    }
    const go = await prompter.confirm({
      id: "adopt_confirm",
      message: "この内容で導入しますか",
      initialValue: true,
    });
    if (!go) {
      prompter.note("導入を承知しなかったため、何も変更せずに終了します。");
      return { exitCode: 0 };
    }
  }

  // 置き換えを選んだものは、結果で「残した」から「置き換え」に移す
  outcome.replaced = outcome.kept.filter((p) => replace.has(p));
  outcome.kept = outcome.kept.filter((p) => !replace.has(p));

  // 書き込みの操作を組み立てる。config.yaml も同じ一括の最後の操作にする
  const ops: ApplyOp[] = [];
  const checks: { path: string; sha: string | null }[] = [];
  const managed: { path: string; content: string }[] = [];
  const markedFiles: string[] = [];
  const shaOf = (p: string): string | null => {
    const s = states.get(p);
    return s?.kind === "file" ? s.sha : null;
  };
  const replaceOp = (p: string, content: string): ApplyOp => ({
    kind: "replace",
    path: p,
    content,
    expected: shaOf(p) ?? "",
  });
  for (const d of decisions) {
    switch (d.kind) {
      case "doc-merge": {
        const merged = mergedText.get(d.path) ?? "";
        if (d.current === undefined) ops.push({ kind: "create", path: d.path, content: merged });
        else if (merged === d.current) checks.push({ path: d.path, sha: shaOf(d.path) });
        else ops.push(replaceOp(d.path, merged));
        managed.push({ path: d.path, content: d.body });
        markedFiles.push(d.path);
        break;
      }
      case "add":
        ops.push({ kind: "create", path: d.path, content: d.file.content });
        managed.push({ path: d.path, content: d.file.content });
        break;
      case "same":
        checks.push({ path: d.path, sha: shaOf(d.path) });
        managed.push({ path: d.path, content: d.file.content });
        break;
      case "choose":
        if (replace.has(d.path)) {
          ops.push(replaceOp(d.path, d.file.content));
          managed.push({ path: d.path, content: d.file.content });
        } else {
          // 残す。ハーネスの管理には入れない
          checks.push({ path: d.path, sha: shaOf(d.path) });
        }
        break;
    }
  }

  const configText = buildConfigText({
    answers,
    acceptedWarnings: [],
    judgment: judge(answers),
    versions: { entries: [], newerThanVerified: false },
    roles: rolesFor(answers.ais),
    managed,
    now,
    mode: "adopt",
    markedFiles,
    secretScan: secretScanRecord(scan, now),
    detectedStack: stack,
    profiles: match,
  });
  ops.push({ kind: "create", path: CONFIG_PATH, content: configText });

  // 適用前なら何も書かず、適用中なら applyUpdate が元に戻す
  if (signal.aborted) throw new CancelledError();
  try {
    const applied = await applyUpdate({
      root,
      ops,
      checks,
      ...(deps.fs ? { fs: deps.fs } : {}),
      signal,
    });
    for (const w of applied.cleanupWarnings) deps.stderr(`${w}\n`);
  } catch (e) {
    return reportApplyError(e, deps);
  }

  deps.stdout(
    renderReport({
      dryRun: false,
      outcome,
      diffs: [],
      appName: answers.app_name,
      scan,
      stack,
      match,
    }),
  );
  prompter.note(
    `導入しました（${localDay(now)}）。差分を Git で確かめ、既存のテストと品質チェックを実行してください。上の一覧は、PR の本文に貼れます。`,
    "導入しました",
  );
  return { exitCode: 0, applied: true };
}

/** config.yaml に残す、秘密情報の確認の記録 */
function secretScanRecord(scan: ScanOutcome, now: Date): SecretScanRecord {
  return scan.status === "skipped"
    ? { status: "skipped", checkedOn: localDay(now) }
    : { status: "passed", scope: scan.scope, checkedOn: localDay(now) };
}

function reportApplyError(e: unknown, deps: AdoptDeps): AdoptOutcome {
  if (e instanceof UpdateInterrupted) {
    deps.stderr("中断の要求を受けたため、導入を止めて元に戻しました\n");
    return { exitCode: 130 };
  }
  if (e instanceof ChangedAfterJudgment) {
    deps.stderr(
      `エラー: 判定の後にファイルが変わりました。もう一度 harness adopt を実行してください（変わったファイル：${e.changed.join("、")}。何も書き換えていません）\n`,
    );
    return { exitCode: 1 };
  }
  if (e instanceof RollbackIncomplete) {
    deps.stderr(`エラー: ${e.message}\n`);
    deps.stderr(`元の内容の退避は、消さずに残しています：${e.backupDir}\n`);
    return { exitCode: 1 };
  }
  if (e instanceof ApplyFailed || e instanceof GenerateError) {
    deps.stderr(`エラー: ${e.message}\n`);
    return { exitCode: 1 };
  }
  deps.stderr(`エラー: 導入に失敗しました：${messageOf(e)}\n`);
  return { exitCode: 1 };
}

export function adoptCommand(deps: Partial<AdoptDeps> = {}): Command {
  return new Command("adopt")
    .description(
      "既存のプロジェクトに、AI 向けのルール（AGENTS.md・Skill など）を足して、ハーネスを導入する",
    )
    .option("--answers <file>", "質問への回答をまとめたファイル（必須。足りない項目だけ質問する）")
    .option("--yes", "確認を省く（同じ名前のファイルは、既存を残す）")
    .option("--dir <フォルダ>", "導入するプロジェクトのフォルダ（既定は作業中のフォルダ）")
    .option("--dry-run", "何が変わるかの一覧と差分だけを表示し、何も書かない")
    .option(
      "--skip-secret-scan",
      "秘密情報の確認（Docker の gitleaks）を省く（確認していないと記録する）",
    )
    .action(async (options: AdoptOptions) => {
      const outcome = await runAdopt(options, {
        prompter: deps.prompter ?? createClackPrompter(),
        cwd: deps.cwd ?? process.cwd(),
        interactive: deps.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
        stderr: deps.stderr ?? ((text) => void process.stderr.write(text)),
        stdout: deps.stdout ?? ((text) => void process.stdout.write(text)),
        ...(deps.now ? { now: deps.now } : {}),
        ...(deps.fs ? { fs: deps.fs } : {}),
        ...(deps.secretScan ? { secretScan: deps.secretScan } : {}),
        ...(deps.runner ? { runner: deps.runner } : {}),
      });
      process.exitCode = outcome.exitCode;
    });
}
