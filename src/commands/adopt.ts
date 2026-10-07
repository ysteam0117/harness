import { readFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { buildAdoptFiles, type AdoptFile } from "../adopt/build.js";
import { extractBlock, mergeBlock, MarkerError } from "../adopt/markers.js";
import { planAdopt, type AdoptDecision } from "../adopt/plan.js";
import { buildConfigText, CONFIG_PATH, localDay } from "../generate/config.js";
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
import { messageOf, rawSha, readState, type FileSnapshot } from "../update/state.js";
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
}

export interface AdoptOutcome {
  exitCode: number;
}

const CANCEL_MESSAGE = "中断しました。ファイルは変更していません。";
const LOCK_PATH = ".harness/.update-lock";
const HARNESS_DIR = ".harness";
const START_NOTICE = [
  "秘密情報の確認（履歴を含む）はまだ行いません（#17 で追加予定）。導入の前に、秘密情報が含まれていないことを確かめてください。",
  "harness adopt は、ファイルを書くだけです。コミット・push はしません。導入の差分は、Git で確かめてください。",
].join("\n");
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

/** 既存の文書が、UTF-8 として正しく読めるか。UTF-16・Shift_JIS 等（読み替えると元に戻らないもの）と、NUL を含むものは読めないとする */
function isUtf8Text(state: Extract<FileSnapshot, { kind: "file" }>): boolean {
  return rawSha(Buffer.from(state.text, "utf8")) === state.sha && !state.text.includes("\0");
}

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
        `${CONFIG_PATH} がすでにあります。このプロジェクトは、ハーネスを導入済みです。状態の確認は harness status を使ってください（harness adopt は、導入していないプロジェクトに使います。adopt で導入したプロジェクトの harness update は、#16 で対応予定です）`,
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
    const result = await adopt(root, initial, options, deps, fs, fail, controller.signal);
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

function renderReport(input: {
  dryRun: boolean;
  outcome: Outcome;
  diffs: { path: string; text: string }[];
  appName: string;
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

  prompter.note(dryRun ? START_NOTICE : `${START_NOTICE}\n${EDIT_NOTICE}`, "導入を始めます");

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
    deps.stdout(renderReport({ dryRun: true, outcome, diffs, appName: answers.app_name }));
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

  deps.stdout(renderReport({ dryRun: false, outcome, diffs: [], appName: answers.app_name }));
  prompter.note(
    `導入しました（${localDay(now)}）。差分を Git で確かめ、既存のテストと品質チェックを実行してください。上の一覧は、PR の本文に貼れます。`,
    "導入しました",
  );
  return { exitCode: 0, applied: true };
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
    .action(async (options: AdoptOptions) => {
      const outcome = await runAdopt(options, {
        prompter: deps.prompter ?? createClackPrompter(),
        cwd: deps.cwd ?? process.cwd(),
        interactive: deps.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
        stderr: deps.stderr ?? ((text) => void process.stderr.write(text)),
        stdout: deps.stdout ?? ((text) => void process.stdout.write(text)),
        ...(deps.now ? { now: deps.now } : {}),
        ...(deps.fs ? { fs: deps.fs } : {}),
      });
      process.exitCode = outcome.exitCode;
    });
}
