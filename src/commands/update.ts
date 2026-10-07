import { execFile } from "node:child_process";
import path from "node:path";
import { Command } from "commander";
import semver from "semver";
import { buildAdoptFiles } from "../adopt/build.js";
import { extractBlock, mergeBlock, MarkerError } from "../adopt/markers.js";
import { collectFacts } from "../checks/facts.js";
import type { AcceptedWarning } from "../checks/review.js";
import { evaluateRules, loadRules, RulesError, type RuleHit } from "../checks/rules.js";
import type { ToolStatus } from "../checks/tools.js";
import {
  buildConfigText,
  CONFIG_PATH,
  fingerprint,
  harnessVersion,
  localDay,
  toUpdateConfigText,
} from "../generate/config.js";
import { GenerateError } from "../generate/errors.js";
import { judge } from "../generate/judgment.js";
import { buildAdr, buildProject, type ProjectFile } from "../generate/project.js";
import { rolesFor } from "../generate/roles.js";
import { type Answers } from "../questions/answers.js";
import { questionDefinitions } from "../questions/definitions.js";
import { findMissing, runQuestions } from "../questions/flow.js";
import { CancelledError, createClackPrompter, type Prompter } from "../questions/prompter.js";
import { targetsFor } from "../versions/targets.js";
import type { VersionEntry, VersionResult } from "../versions/choose.js";
import {
  applyUpdate,
  ApplyFailed,
  ChangedAfterJudgment,
  RollbackIncomplete,
  UpdateInterrupted,
  type ApplyOp,
} from "../update/apply.js";
import { changesSince, parseChangelog, readBundledChangelog } from "../update/changelog.js";
import { formatDiff, settingChangeNotes } from "../update/diff.js";
import { realUpdateFs, type UpdateFs } from "../update/fs.js";
import { planUpdate, type Decision, type FileState, type NewFile } from "../update/plan.js";
import { ConfigError, parseConfig, type RecordedConfig } from "../update/read-config.js";
import { isUtf8Text, messageOf, readState, type FileSnapshot } from "../update/state.js";

export interface GitResult {
  /** 実行できなかった（git がない等）ときは null */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** git の実行の差し替え口（cwd は更新するプロジェクトのフォルダ） */
export type RunGit = (args: string[], cwd: string) => Promise<GitResult>;

export interface UpdateDeps {
  prompter: Prompter;
  /** 更新するプロジェクトの場所の基準（--dir がなければ、ここ） */
  cwd: string;
  interactive: boolean;
  stderr: (text: string) => void;
  /** 結果の一覧（PR の本文に貼れる Markdown）の出力先 */
  stdout: (text: string) => void;
  /** 手元の道具の確かめの差し替え（テスト用） */
  checkTools?: () => Promise<ToolStatus[]>;
  /** 更新した日の差し替え（テスト用）。既定は現在の日時 */
  now?: () => Date;
  /** git の実行の差し替え（テスト用）。既定は本物 */
  runGit?: RunGit;
  /** ファイル操作の差し替え（テスト用）。既定は本物 */
  fs?: Partial<UpdateFs>;
  /** 実行中の CLI のバージョンの差し替え（テスト用）。既定は package.json の version */
  harnessVersion?: () => string;
  /** 同梱の CHANGELOG.md の差し替え（テスト用） */
  changelog?: () => string | undefined;
  /** テンプレートの置き場所の差し替え（テスト用。harness adopt で導入したアプリの更新で使う）。既定は同梱のもの */
  templatesDir?: string;
}

export interface UpdateOptions {
  /** --yes：確認を省く（書き換え済みのファイルは残して .harness-new を置く。消したファイルは消したまま） */
  yes?: boolean;
  /** --dir：更新するプロジェクトのフォルダ（既定は作業中のフォルダ） */
  dir?: string;
  /** --dry-run：判定の一覧だけを表示し、何も書かない */
  dryRun?: boolean;
  /** --allow-dirty：Git の未コミットの変更があっても続ける */
  allowDirty?: boolean;
}

export interface UpdateOutcome {
  exitCode: number;
}

const CANCEL_MESSAGE = "中断しました。ファイルは変更していません。";
const LOCK_PATH = ".harness/.update-lock";
const EDIT_NOTICE = "更新の間は、ファイルを編集しないでください。";

const realRunGit: RunGit = (args, cwd) =>
  new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: 30_000, windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        resolve({
          code: typeof code === "number" ? code : null,
          stdout: stdout ?? "",
          stderr: stderr !== "" && stderr !== undefined ? stderr : error.message,
        });
      },
    );
  });

/** 更新の結果（置き換えた・残した・追加した…）。レポートと config.yaml に使う */
interface Outcome {
  replaced: string[];
  /** 書き換え済みのため残した（新しい内容の置き場所があれば newPath） */
  kept: { path: string; newPath?: string }[];
  added: string[];
  restored: string[];
  /** 消したままにした（removed_files） */
  leftRemoved: string[];
  obsolete: string[];
  /** ハーネスの管理に入っていない（adopt で既存を残した）ため、触れなかったファイル */
  untouched: string[];
  unchanged: number;
}

function formatHit(hit: RuleHit): string {
  return `[${hit.id}] ${hit.message}\n    理由：${hit.reason}`;
}

function titleOf(id: string): string {
  return questionDefinitions.find((d) => d.id === id)?.title ?? id;
}

/** 結果の一覧（PR の本文に貼れる Markdown） */
function renderReport(input: {
  dryRun: boolean;
  from: string;
  to: string;
  outcome: Outcome;
  addedQuestions: string[];
  newWarnings: AcceptedWarning[];
  adrPath?: string;
  notes: string[];
  ignored: string[];
  changes: { version: string; body: string }[];
}): string {
  const { outcome: o } = input;
  const lines: string[] = [];
  const section = (title: string, intro: string | undefined, items: string[]): void => {
    if (items.length === 0) return;
    lines.push(`### ${title}`, "");
    if (intro !== undefined) lines.push(intro, "");
    lines.push(...items.map((i) => `- ${i}`), "");
  };
  lines.push(`## ハーネスの更新（${input.from} → ${input.to}）`, "");
  if (input.dryRun) {
    lines.push("--dry-run のため、何も書いていません。実行すると、次のとおりになります。", "");
  }
  section(
    "置き換え",
    input.dryRun
      ? "書き換えていない管理ファイルを、新しい内容で置き換えます。"
      : "書き換えていない管理ファイルを、新しい内容で置き換えました。",
    o.replaced.map((p) => `\`${p}\``),
  );
  section(
    "書き換え済みのため残した",
    input.dryRun
      ? "利用者が書き換えたファイルは、置き換えません。"
      : "利用者が書き換えたファイルは置き換えていません。",
    o.kept.map((k) =>
      k.newPath !== undefined
        ? `\`${k.path}\`（新しい内容は \`${k.newPath}\` に置きました）`
        : input.dryRun
          ? `\`${k.path}\`（実行するとき、対話では選べます。--yes では、新しい内容を .harness-new に置きます）`
          : `\`${k.path}\``,
    ),
  );
  section(
    "追加",
    input.dryRun
      ? "新しいバージョンで追加されたファイルです。追加します。"
      : "新しいバージョンで追加されたファイルです。",
    o.added.map((p) => `\`${p}\``),
  );
  section(
    "復元",
    "削除されていたファイルを、新しい内容で復元しました。",
    o.restored.map((p) => `\`${p}\``),
  );
  section(
    "消したままにした",
    input.dryRun
      ? "削除されているファイルです。対話では、復元するかを聞きます。--yes では、消したままにします（config.yaml の removed_files に記録）。"
      : "削除されているファイルは、そのままにしました（config.yaml の removed_files に記録）。",
    o.leftRemoved.map((p) => `\`${p}\``),
  );
  section(
    "不要になった",
    input.dryRun
      ? "新しいバージョンでは不要になりました（削除しません。要らなければ、手で消してください）。"
      : "新しいバージョンでは不要になりました（削除していません。要らなければ、手で消してください）。",
    o.obsolete.map((p) => `\`${p}\``),
  );
  section(
    "管理外のため触れない",
    "導入のとき（harness adopt）に既存のファイルを残したため、ハーネスの管理に入っていません。新しい内容には、更新しません。",
    o.untouched.map((p) => `\`${p}\``),
  );
  section(
    "増えた質問",
    "新しいバージョンで増えた質問です（回答は config.yaml に記録しました）。",
    input.addedQuestions.map((id) => `\`${id}\`（${titleOf(id)}）`),
  );
  section(
    "新しい警告",
    input.dryRun ? "実行すると、承知を求めます。" : "承知した警告です。",
    input.newWarnings.map((w) => `\`${w.id}\`：${w.message}`),
  );
  if (input.adrPath !== undefined) {
    section("新しい ADR", undefined, [`\`${input.adrPath}\``]);
  }
  section(
    "設定の変化",
    "新しいハーネスでは、次の設定が変わります（プロジェクトのものなので、書き換えていません。必要なら、手で反映してください）。",
    input.notes,
  );
  section(
    "無視した記録",
    "config.yaml の managed_files に、管理の対象でないパスがありました（ファイルには触れていません）。",
    input.ignored.map((p) => `\`${p}\``),
  );
  if (input.changes.length > 0) {
    lines.push("### ハーネスの変更履歴", "");
    for (const c of input.changes) lines.push(`#### ${c.version}`, "", c.body, "");
  }
  if (!input.dryRun) {
    lines.push(
      "### 次にすること",
      "",
      "テストと品質チェックを実行し、Issue・PR で取り込んでください（main に直接入れません）。",
      "",
    );
  }
  lines.push(`（変わらなかった管理ファイル：${String(o.unchanged)} 件）`, "");
  return lines.join("\n");
}

class Stop extends Error {
  readonly exitCode: number;
  constructor(exitCode: number) {
    super("stop");
    this.exitCode = exitCode;
  }
}

/** 更新（F-27）。判定 → 確認 → 原子的な書き込み */
export async function runUpdate(options: UpdateOptions, deps: UpdateDeps): Promise<UpdateOutcome> {
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

async function run(options: UpdateOptions, deps: UpdateDeps): Promise<UpdateOutcome> {
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

  // config.yaml
  let configState: FileSnapshot;
  try {
    configState = await readState(fs, root, CONFIG_PATH);
  } catch (e) {
    if (e instanceof GenerateError) return fail(e.message);
    throw e;
  }
  if (configState.kind === "absent") {
    return fail(
      `${root} に .harness/config.yaml がありません。harness create で作ったプロジェクトのフォルダで実行するか、--dir で指定してください`,
    );
  }
  let recorded: RecordedConfig;
  try {
    recorded = parseConfig(configState.text);
  } catch (e) {
    if (e instanceof ConfigError) return fail(e.message);
    throw e;
  }

  // ダウングレード
  const cliVersion = (deps.harnessVersion ?? harnessVersion)();
  if (semver.valid(cliVersion) !== null && semver.lt(cliVersion, recorded.harnessVersion)) {
    return fail(
      `このプロジェクトは、新しいバージョン（${recorded.harnessVersion}）のハーネスで更新されています。実行中のハーネスは ${cliVersion} で、古いため、ダウングレードになります。ハーネスを更新してから、もう一度実行してください`,
    );
  }

  if (!yes && !dryRun && !deps.interactive) {
    return fail(
      "端末で実行していないため、確認できません。確認を省くには --yes を付けてください（--dry-run で、何が変わるかだけを確かめられます）",
    );
  }

  // Git の状態：未コミットの変更があれば止める（更新の前の状態を Git から取り戻せるように）
  await checkGit(root, options, deps, fail);

  // 並行の更新を防ぐ（--dry-run は何も書かないので、ロックしない）
  const lock = path.join(root, ...LOCK_PATH.split("/"));
  const controller = new AbortController();
  const onInterrupt = (): void => controller.abort();
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  let locked = false;
  try {
    if (!dryRun) {
      try {
        await fs.createExclusive(lock, `${String(process.pid)}\n`);
        locked = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") {
          return fail(
            `別の更新が実行中か、前回の更新が途中で止まりました。${lock} を確かめてください（実行中でなければ、このファイルを消してから、もう一度実行します）`,
          );
        }
        return fail(`ロックを作れませんでした：${lock}（${messageOf(e)}）`);
      }
    }
    if (controller.signal.aborted) throw new CancelledError();
    const result = await update(
      root,
      configState,
      recorded,
      options,
      deps,
      fs,
      cliVersion,
      fail,
      controller.signal,
    );
    if (controller.signal.aborted && result.applied) {
      deps.stderr("更新は完了しました。\n");
    } else if (controller.signal.aborted && result.exitCode === 0) {
      throw new CancelledError();
    }
    return { exitCode: result.exitCode };
  } finally {
    try {
      if (locked) await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
    } finally {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
    }
  }
}

/** 応答が戻らない質問も、中断を受けたら待つのをやめる。 */
export async function interruptible<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new CancelledError();
  let onAbort: () => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new CancelledError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(), interrupted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function checkGit(
  root: string,
  options: UpdateOptions,
  deps: UpdateDeps,
  fail: (message: string) => never,
): Promise<void> {
  const runGit = deps.runGit ?? realRunGit;
  const inRepo = await runGit(["rev-parse", "--is-inside-work-tree"], root).then(
    (r) => r.code === 0 && r.stdout.trim() === "true",
    () => false,
  );
  if (!inRepo) {
    deps.prompter.note(
      "Git のフォルダではありません。更新の前の状態を、Git から取り戻せません（更新は、Git で管理してから行うことをおすすめします）。",
      "警告",
    );
    return;
  }
  let status: GitResult;
  try {
    status = await runGit(["status", "--porcelain", "--", "."], root);
  } catch (e) {
    return fail(`git status を実行できませんでした（${messageOf(e)}）`);
  }
  if (status.code !== 0) {
    return fail(`git status を実行できませんでした（${status.stderr.trim()}）`);
  }
  if (status.stdout.trim() === "") return;
  if (options.allowDirty === true || options.dryRun === true) {
    deps.prompter.note(
      "Git に未コミットの変更があります。更新の前の状態を、Git から取り戻せない場合があります。",
      "警告",
    );
    return;
  }
  fail(
    "Git に未コミットの変更があります。先にコミットするか、退避してから、もう一度実行してください（更新は、変更がきれいな状態でだけ動きます。--allow-dirty で続けられますが、更新の前の状態を Git から取り戻せなくなります）",
  );
}

/** 管理するファイル（新しい組）の、今の状態を読む */
async function readStates(
  fs: UpdateFs,
  root: string,
  paths: string[],
): Promise<Map<string, FileSnapshot>> {
  const states = new Map<string, FileSnapshot>();
  for (const p of paths) states.set(p, await readState(fs, root, p));
  return states;
}

async function update(
  root: string,
  configState: Extract<FileSnapshot, { kind: "file" }>,
  recorded: RecordedConfig,
  options: UpdateOptions,
  deps: UpdateDeps,
  fs: UpdateFs,
  cliVersion: string,
  fail: (message: string) => never,
  signal: AbortSignal,
): Promise<UpdateOutcome & { applied?: true }> {
  const dryRun = options.dryRun === true;
  const yes = options.yes === true;
  /** harness adopt で導入したアプリ：印の中だけを更新する（版・整合性・警告は、導入のときの記録のまま） */
  const adopted = recorded.mode === "adopt";
  const now = (deps.now ?? (() => new Date()))();
  const prompter: Prompter = {
    note: (...args) => deps.prompter.note(...args),
    text: (o) => interruptible(() => deps.prompter.text(o), signal),
    select: (o) => interruptible(() => deps.prompter.select(o), signal),
    multiselect: (o) => interruptible(() => deps.prompter.multiselect(o), signal),
    confirm: (o) => interruptible(() => deps.prompter.confirm(o), signal),
  };

  if (!dryRun) prompter.note(EDIT_NOTICE, "更新を始めます");

  // 増えた質問だけを聞く（--yes・--dry-run は、既定の値だけで進む）
  let initial: Partial<Answers> = { ...recorded.answers };
  let pendingQuestions: string[] = [];
  if (yes || dryRun) {
    for (;;) {
      const missing = findMissing(questionDefinitions, initial);
      if (missing.length === 0) break;
      const noDefault = missing.filter(
        (id) => questionDefinitions.find((d) => d.id === id)?.initialValue === undefined,
      );
      if (noDefault.length > 0) {
        pendingQuestions = noDefault;
        break;
      }
      const next: Record<string, unknown> = { ...initial };
      for (const id of missing) {
        next[id] = questionDefinitions.find((d) => d.id === id)?.initialValue;
      }
      initial = next as Partial<Answers>;
    }
    if (pendingQuestions.length > 0) {
      if (dryRun) {
        deps.stdout(
          `## ハーネスの更新（${recorded.harnessVersion} → ${cliVersion}）\n\n--dry-run のため、何も書いていません。\n\n### 増えた質問\n\n新しいバージョンで質問が増えています。実行すると、次の質問をします。\n\n${pendingQuestions.map((id) => `- \`${id}\`（${titleOf(id)}）`).join("\n")}\n`,
        );
        return { exitCode: 0 };
      }
      deps.stderr("エラー: 新しいバージョンで質問が増えましたが、既定の値がない質問があります。\n");
      for (const id of pendingQuestions) deps.stderr(`  - ${id}（${titleOf(id)}）\n`);
      deps.stderr("--yes を付けずに、端末で実行して、質問に答えてください。\n");
      throw new Stop(1);
    }
  }
  const quiet: Prompter = Object.create(prompter, { note: { value: () => undefined } }) as Prompter;
  let answers: Answers;
  try {
    answers = await runQuestions(questionDefinitions, quiet, initial);
  } catch (e) {
    if (e instanceof CancelledError) throw e;
    return fail(`回答を確かめられません：${messageOf(e)}`);
  }
  const addedQuestions = questionDefinitions
    .map((d) => d.id)
    .filter((id) => (answers as unknown as Record<string, unknown>)[id] !== undefined)
    .filter((id) => !(id in recorded.answers));

  // 版：記録された版はそのまま使う。増えた分は、同梱の検証済みの版（ネットワークは使わない）
  let versions: VersionResult = { entries: recorded.versions, newerThanVerified: false };
  if (!adopted) {
    try {
      const targets = targetsFor(answers);
      const byName = new Map(recorded.versions.map((v) => [v.name, v]));
      const entries: VersionEntry[] = [];
      const unresolved: string[] = [];
      for (const target of targets) {
        const keep = byName.get(target.name);
        if (keep !== undefined) {
          entries.push(keep);
        } else if (target.verified === undefined) {
          unresolved.push(target.name);
        } else {
          entries.push({
            name: target.name,
            version: target.verified,
            reason: "更新で追加（検証済みの版）",
            surveyedOn: localDay(now),
            latestStable: null,
            latestStatus: "failed",
            fetchFailure: "更新ではネットワークを使わないため、調べていません",
            verified: target.verified,
            newerThanVerified: false,
            majorDiffers: false,
          });
        }
      }
      if (unresolved.length > 0) {
        return fail(
          `新しいバージョンで増えたパッケージに、検証済みの版がありません：${unresolved.join("、")}（更新ではネットワークを使わないため、版を決められません。harness create で新しく作るか、手で追加してください）`,
        );
      }
      versions = { entries, newerThanVerified: entries.some((e) => e.newerThanVerified) };
    } catch (e) {
      if (e instanceof GenerateError) return fail(e.message);
      throw e;
    }
  }

  // 整合性チェックをやり直す（生成先は、すでに中身があるのが当然なので、見ない）
  let newHits: RuleHit[] = [];
  if (!adopted) {
    let rules;
    try {
      rules = loadRules();
    } catch (e) {
      if (e instanceof RulesError) return fail(e.message);
      throw e;
    }
    const facts = await collectFacts(answers, {
      cwd: path.dirname(root),
      versionsNewerThanVerified: versions.newerThanVerified,
      isNonEmptyDir: () => Promise.resolve(false),
      ...(deps.checkTools ? { checkTools: deps.checkTools } : {}),
    });
    const result = evaluateRules(rules, answers, facts);
    if (result.errors.length > 0) {
      deps.stderr("エラー: 整合性チェックでエラーが見つかりました。\n");
      deps.stderr(`${result.errors.map(formatHit).join("\n")}\n`);
      throw new Stop(1);
    }
    const knownIds = new Set(recorded.acceptedWarnings.map((w) => w.id));
    newHits = result.warnings.filter((h) => h.id !== "missing-tools" && !knownIds.has(h.id));
  }

  // 新しい警告（手元の道具の不足は、プロジェクトの警告ではないので、数えない）
  const newWarnings: AcceptedWarning[] = [];
  if (newHits.length > 0 && !dryRun) {
    if (yes) {
      deps.stderr(
        "エラー: 承知していない警告があります（新しいバージョンの更新で、新しく出ました）。\n",
      );
      deps.stderr(`${newHits.map(formatHit).join("\n")}\n`);
      deps.stderr(
        "--yes では承知できません。端末で、--yes を付けずに実行して、内容を確かめてください。\n",
      );
      throw new Stop(1);
    }
    for (const hit of newHits) {
      const go = await prompter.confirm({
        id: `accept_warning:${hit.id}`,
        message: `警告：${hit.message}\n理由：${hit.reason}\nこの警告を承知して続けますか`,
        initialValue: false,
      });
      if (!go) {
        prompter.note("警告を承知しなかったため、何も変更せずに終了します。");
        return { exitCode: 0 };
      }
      newWarnings.push({ id: hit.id, message: hit.message, reason: hit.reason });
    }
  } else if (dryRun) {
    for (const hit of newHits) {
      newWarnings.push({ id: hit.id, message: hit.message, reason: hit.reason });
    }
  }
  const acceptedAll = [...recorded.acceptedWarnings, ...newWarnings];

  // 新しい組を、記録の回答・承知した警告・版で組み立てる
  let managedNew: NewFile[];
  let createdConfig: string | undefined;
  let settingFiles: ProjectFile[] = [];
  /** adopt のとき：印で囲んで統合する文書（AGENTS.md・CLAUDE.md）。content は印の中の本文 */
  const adoptDocs = new Set<string>();
  try {
    if (adopted) {
      const files = buildAdoptFiles({
        answers,
        ...(deps.templatesDir !== undefined ? { templatesDir: deps.templatesDir } : {}),
      });
      managedNew = files.map((f) => ({ path: f.path, content: f.content }));
      for (const f of files) if (f.kind === "doc") adoptDocs.add(f.path);
    } else {
      const built = buildProject({ answers, acceptedWarnings: acceptedAll, versions, now }).files;
      managedNew = built
        .filter((f) => f.managed)
        .map((f) => ({
          path: f.path,
          content: f.content,
          ...(f.executable ? { executable: true as const } : {}),
        }));
      createdConfig = built.find((f) => f.path === CONFIG_PATH)?.content;
      if (createdConfig === undefined) return fail("新しい config.yaml を組み立てられませんでした");
      settingFiles = built.filter((f) => f.path === "package.json" || f.path === "wrangler.jsonc");
    }
  } catch (e) {
    if (e instanceof GenerateError) return fail(e.message);
    throw e;
  }

  // 今のファイルの状態を読む（管理するファイルと、知らせだけの設定。リンクは拒む）
  let states: Map<string, FileSnapshot>;
  try {
    states = await readStates(fs, root, [
      ...managedNew.map((f) => f.path),
      ...settingFiles.map((f) => f.path),
    ]);
  } catch (e) {
    if (e instanceof GenerateError) return fail(e.message);
    throw e;
  }
  const current = new Map<string, FileState>(states);
  const untouched: string[] = [];
  let planFiles = managedNew;
  if (adopted) {
    // 印で囲んだ文書は、印の中の本文だけを比べる。読めない・印が壊れている・印が無いときは、何も書かずに止まる
    for (const p of recorded.markedFiles) {
      const state = states.get(p);
      if (state?.kind !== "file") continue;
      if (!isUtf8Text(state)) {
        return fail(
          `${p} は、文字コードが UTF-8 ではないため扱えません（UTF-16・Shift_JIS など）。UTF-8 に変換してから、もう一度実行してください。何も書いていません`,
        );
      }
      const located = extractBlock(state.text);
      if (located.kind === "broken") {
        return fail(
          `${p} の印（harness:begin〜harness:end）が壊れています：${located.reason}。印を直してから、もう一度実行してください。何も書いていません`,
        );
      }
      if (located.kind === "none") {
        return fail(
          `${p} に、ハーネスの印（harness:begin〜harness:end）がありません。印の中だけを更新するため、何も書いていません。印を戻してから、もう一度実行してください`,
        );
      }
      current.set(p, { kind: "file", text: located.body });
    }
    // 導入のとき既存のファイルを残したもの（管理に入っていないが、ディスクにある）には、触れない
    planFiles = managedNew.filter((f) => {
      const onDisk = states.get(f.path)?.kind === "file";
      if (onDisk && !(f.path in recorded.managedFiles)) {
        untouched.push(f.path);
        return false;
      }
      return true;
    });
  }
  const decisions = planUpdate({
    files: planFiles,
    recorded: recorded.managedFiles,
    removed: recorded.removedFiles,
    current,
  });
  const notes = settingChangeNotes(
    settingFiles.map((f) => ({ path: f.path, content: f.content })),
    current,
  );

  const changelogText = (deps.changelog ?? readBundledChangelog)();
  const changes =
    changelogText === undefined
      ? []
      : changesSince(parseChangelog(changelogText), recorded.harnessVersion);

  // --dry-run：判定の一覧だけ
  if (dryRun) {
    const outcome = describe(decisions);
    outcome.untouched = untouched;
    deps.stdout(
      renderReport({
        dryRun: true,
        from: recorded.harnessVersion,
        to: cliVersion,
        outcome,
        addedQuestions,
        newWarnings,
        notes,
        ignored: recorded.ignored,
        changes,
      }),
    );
    return { exitCode: 0 };
  }

  // 確認（対話）／既定（--yes）
  const outcome: Outcome = {
    replaced: [],
    kept: [],
    added: [],
    restored: [],
    leftRemoved: [],
    obsolete: [],
    untouched,
    unchanged: 0,
  };
  const ops: ApplyOp[] = [];
  const creates: ApplyOp[] = [];
  const checks: { path: string; sha: string | null }[] = [];
  const newFingerprints: Record<string, string> = {};
  const removedAfter = new Set(recorded.removedFiles);
  const planned = new Set<string>(decisions.map((d) => d.path));
  const shaOf = (p: string): string | null => {
    const s = states.get(p);
    return s?.kind === "file" ? s.sha : null;
  };
  const fpOf = (file: NewFile): string => fingerprint(file.content);
  /** 書き込む中身。印で囲む文書は、今のファイル全体の印の中だけを新しい本文にする（印の外は変えない） */
  const contentOf = (file: NewFile): string => {
    if (!adoptDocs.has(file.path)) return file.content;
    const state = states.get(file.path);
    return mergeBlock(state?.kind === "file" ? state.text : undefined, file.content);
  };
  const replaceOp = (file: NewFile): ApplyOp => ({
    kind: "replace",
    path: file.path,
    content: contentOf(file),
    ...(file.executable ? { executable: true as const } : {}),
    expected: shaOf(file.path) ?? "",
  });
  const createOp = (file: NewFile, at: string = file.path): ApplyOp => ({
    kind: "create",
    path: at,
    content: contentOf(file),
    ...(file.executable ? { executable: true as const } : {}),
  });
  /** <path>.harness-new の置き場所。既にあれば .2・.3…（既存のファイルには触れない） */
  const freeNewPath = async (p: string): Promise<string> => {
    for (let n = 1; ; n += 1) {
      const candidate = n === 1 ? `${p}.harness-new` : `${p}.harness-new.${String(n)}`;
      if (planned.has(candidate)) continue;
      const state = await readState(fs, root, candidate);
      checks.push({ path: candidate, sha: state.kind === "file" ? state.sha : null });
      if (state.kind === "absent") {
        planned.add(candidate);
        return candidate;
      }
    }
  };

  try {
    for (const d of decisions) {
      switch (d.kind) {
        case "unchanged":
          checks.push({ path: d.path, sha: shaOf(d.path) });
          outcome.unchanged += 1;
          newFingerprints[d.path] = fpOf(d.file);
          break;
        case "replace":
          ops.push(replaceOp(d.file));
          outcome.replaced.push(d.path);
          newFingerprints[d.path] = fpOf(d.file);
          break;
        case "added":
          creates.push(createOp(d.file));
          outcome.added.push(d.path);
          newFingerprints[d.path] = fpOf(d.file);
          break;
        case "obsolete":
          outcome.obsolete.push(d.path);
          break;
        case "conflict": {
          const choice = yes ? "new" : await askConflict(prompter, d);
          if (choice === "replace") {
            ops.push(replaceOp(d.file));
            outcome.replaced.push(d.path);
            newFingerprints[d.path] = fpOf(d.file);
          } else {
            // 残す。記録の指紋は変えない（次回も、書き換え済みと判定する）
            const recordedFp = recorded.managedFiles[d.path];
            if (recordedFp !== undefined) newFingerprints[d.path] = recordedFp;
            checks.push({ path: d.path, sha: shaOf(d.path) });
            if (choice === "new") {
              const newPath = await freeNewPath(d.path);
              creates.push(createOp(d.file, newPath));
              outcome.kept.push({ path: d.path, newPath });
            } else {
              outcome.kept.push({ path: d.path });
            }
          }
          break;
        }
        case "missing":
        case "removed_kept": {
          const file = d.kind === "missing" ? d.file : managedNew.find((f) => f.path === d.path);
          const restore =
            !yes &&
            file !== undefined &&
            (await prompter.confirm({
              id: `update_restore:${d.path}`,
              message: `${d.path} は削除されています。新しい内容で復元しますか（いいえ：消したままにします）`,
              initialValue: false,
            }));
          if (restore && file !== undefined) {
            creates.push(createOp(file));
            outcome.restored.push(d.path);
            removedAfter.delete(d.path);
            newFingerprints[d.path] = fpOf(file);
          } else {
            checks.push({ path: d.path, sha: null });
            removedAfter.add(d.path);
            outcome.leftRemoved.push(d.path);
          }
          break;
        }
      }
    }
  } catch (e) {
    if (e instanceof GenerateError) return fail(e.message);
    if (e instanceof MarkerError) return fail(`${e.message}。何も書いていません`);
    throw e;
  }

  // 新しい警告の ADR（新しいファイルを足すだけ。既存の ADR は変えない）
  let adrPath: string | undefined;
  if (newWarnings.length > 0) {
    try {
      adrPath = await nextAdrPath(fs, root, planned);
      const state = await readState(fs, root, adrPath);
      if (state.kind !== "absent") return fail(`${adrPath} がすでにあります`);
      checks.push({ path: adrPath, sha: null });
      const number = path.basename(adrPath).slice(0, 4);
      creates.push({
        kind: "create",
        path: adrPath,
        content: buildAdr(newWarnings, localDay(now), { number, update: true }),
      });
    } catch (e) {
      if (e instanceof GenerateError) return fail(e.message);
      throw e;
    }
  }

  // config.yaml は最後に入れ替える
  const configText = toUpdateConfigText(
    createdConfig ??
      buildConfigText({
        answers,
        acceptedWarnings: recorded.acceptedWarnings,
        judgment: judge(answers),
        versions,
        roles: rolesFor(answers.ais),
        managed: [],
        now,
        mode: "adopt",
        // 管理に残った、印で囲んだ文書
        markedFiles: [...adoptDocs].filter((p) => p in newFingerprints),
      }),
    {
      generatedOn: recorded.generatedOn,
      updatedOn: localDay(now),
      managedFiles: newFingerprints,
      removedFiles: [...removedAfter],
      mode: adopted ? "adopt" : "update",
    },
  );
  const configOp: ApplyOp = {
    kind: "replace",
    path: CONFIG_PATH,
    content: configText,
    expected: configState.sha,
  };

  // 適用前なら何も書かず、適用中なら applyUpdate が元に戻す。
  if (signal.aborted) throw new CancelledError();
  try {
    const applied = await applyUpdate({
      root,
      ops: [...ops, ...creates, configOp],
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
      from: recorded.harnessVersion,
      to: cliVersion,
      outcome,
      addedQuestions,
      newWarnings,
      ...(adrPath !== undefined ? { adrPath } : {}),
      notes,
      ignored: recorded.ignored,
      changes,
    }),
  );
  prompter.note(
    "テストと品質チェックを実行し、Issue・PR で取り込んでください。上の一覧は、PR の本文に貼れます。",
    "更新しました",
  );
  return { exitCode: 0, applied: true };
}

function reportApplyError(e: unknown, deps: UpdateDeps): UpdateOutcome {
  if (e instanceof UpdateInterrupted) {
    deps.stderr(`${e.message}\n`);
    return { exitCode: 130 };
  }
  if (e instanceof ChangedAfterJudgment) {
    deps.stderr(
      `エラー: ${e.message}（変わったファイル：${e.changed.join("、")}。何も書き換えていません）\n`,
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
  deps.stderr(`エラー: 更新に失敗しました：${messageOf(e)}\n`);
  return { exitCode: 1 };
}

async function askConflict(
  prompter: Prompter,
  d: Extract<Decision, { kind: "conflict" }>,
): Promise<"replace" | "keep" | "new"> {
  prompter.note(formatDiff(d.path, d.current, d.file.content), `差分：${d.path}`);
  return prompter.select<"replace" | "keep" | "new">({
    id: `update_conflict:${d.path}`,
    message: `${d.path} は、書き換えられています。どうしますか`,
    options: [
      { value: "replace", label: "新しい内容で置き換える" },
      { value: "keep", label: "今のファイルを残す" },
      { value: "new", label: "今のファイルを残し、新しい内容を <ファイル>.harness-new に置く" },
    ],
    initialValue: "new",
  });
}

/** 新しい ADR のパス。docs/adr/ の番号の最大＋1（すでにあれば、さらに進める） */
async function nextAdrPath(fs: UpdateFs, root: string, planned: Set<string>): Promise<string> {
  let names: string[] = [];
  try {
    names = await fs.readdir(path.join(root, "docs", "adr"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  let max = 0;
  for (const name of names) {
    const m = /^(\d{4})-/.exec(name);
    if (m?.[1] !== undefined) max = Math.max(max, Number(m[1]));
  }
  for (let n = max + 1; ; n += 1) {
    const candidate = `docs/adr/${String(n).padStart(4, "0")}-accepted-warnings-update.md`;
    if (!planned.has(candidate)) return candidate;
  }
}

/** --dry-run の一覧用に、判定を結果の形にする（対話の選択は反映しない） */
function describe(decisions: Decision[]): Outcome {
  const o: Outcome = {
    replaced: [],
    kept: [],
    added: [],
    restored: [],
    leftRemoved: [],
    obsolete: [],
    untouched: [],
    unchanged: 0,
  };
  for (const d of decisions) {
    switch (d.kind) {
      case "unchanged":
        o.unchanged += 1;
        break;
      case "replace":
        o.replaced.push(d.path);
        break;
      case "added":
        o.added.push(d.path);
        break;
      case "conflict":
        o.kept.push({ path: d.path });
        break;
      case "missing":
      case "removed_kept":
        o.leftRemoved.push(d.path);
        break;
      case "obsolete":
        o.obsolete.push(d.path);
        break;
    }
  }
  return o;
}

export function updateCommand(deps: Partial<UpdateDeps> = {}): Command {
  return new Command("update")
    .description("生成済みのプロジェクトに、新しいハーネスを反映する")
    .option(
      "--yes",
      "確認を省く（書き換え済みのファイルは残して .harness-new に新しい内容を置き、消したファイルは消したままにする）",
    )
    .option("--dir <フォルダ>", "更新するプロジェクトのフォルダ（既定は作業中のフォルダ）")
    .option("--dry-run", "何が変わるかの一覧だけを表示し、何も書かない")
    .option(
      "--allow-dirty",
      "Git の未コミットの変更があっても続ける（更新の前の状態を、Git から取り戻せなくなります）",
    )
    .action(async (options: UpdateOptions) => {
      const outcome = await runUpdate(options, {
        prompter: deps.prompter ?? createClackPrompter(),
        cwd: deps.cwd ?? process.cwd(),
        interactive: deps.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
        stderr: deps.stderr ?? ((text) => void process.stderr.write(text)),
        stdout: deps.stdout ?? ((text) => void process.stdout.write(text)),
        ...(deps.checkTools ? { checkTools: deps.checkTools } : {}),
        ...(deps.now ? { now: deps.now } : {}),
        ...(deps.runGit ? { runGit: deps.runGit } : {}),
        ...(deps.fs ? { fs: deps.fs } : {}),
        ...(deps.harnessVersion ? { harnessVersion: deps.harnessVersion } : {}),
        ...(deps.changelog ? { changelog: deps.changelog } : {}),
        ...(deps.templatesDir ? { templatesDir: deps.templatesDir } : {}),
      });
      process.exitCode = outcome.exitCode;
    });
}
