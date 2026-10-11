import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AcceptedWarning } from "../checks/review.js";
import { buildProject } from "../generate/project.js";
import { GenerationInterrupted, writeProject } from "../generate/write.js";
import type { Answers } from "../questions/answers.js";
import { validateAppName } from "../questions/app-name.js";
import type { CommandRunner } from "../verify/runner.js";
import {
  DEFAULT_TIMEOUTS,
  VerifyCleanupError,
  verifyProject,
  type Suspect,
  type VerifyStep,
} from "../verify/verify.js";
import type { VersionEntry, VersionResult } from "./choose.js";
import type { CandidateFinding } from "./range-review.js";
import { compareWithVerified } from "./select.js";

/** 飛ばした理由の分類（固定。例外の本文は、分類に変えて、結果にも下書きにも入れない） */
export type TrialSkipReason =
  | "docker-unavailable"
  | "missing-cause-entry"
  | "build-failed"
  | "write-failed"
  | "unexpected-error"
  | "db-stop-failed-earlier";

export type TrialOutcome =
  | { kind: "passed" }
  | {
      kind: "failed";
      failedStep: VerifyStep;
      failedScripts: string[];
      timedOut: boolean;
      suspects: Suspect[];
      /** 子プロセスの出力の終わり（秘密の値は伏せ字）。画面だけに出し、下書きには入れない */
      outputTail: string;
      outputSuppressed: boolean;
    }
  | { kind: "skipped"; reason: TrialSkipReason }
  | { kind: "interrupted" };

/** 試しの後始末で、手で対応が要るもの。パスは画面と stderr だけに出し、下書きには入れない */
export type TrialCleanupFailure =
  | { kind: "tmp-remove"; path: string }
  | {
      kind: "db-stop";
      /** package.json がある場所（writeProject が返す dir）。ここで command を実行する */
      dir: string;
      /** 残している一時フォルダ（dir の親） */
      tmpDir: string;
      command: string;
    };

/** 試しで置き換えた版（対象と原因の2つだけ） */
export interface ReplacedVersion {
  name: string;
  adopted: string;
  trial: string;
}

export interface TrialResult {
  finding: CandidateFinding;
  replaced: ReplacedVersion[];
  outcome: TrialOutcome;
  cleanupFailures: TrialCleanupFailure[];
}

/** 一時フォルダの操作の窓口（テストで差し替える） */
export interface TrialFs {
  mkdtemp(prefix: string): Promise<string>;
  rm(p: string, opts: { recursive: true; force: true; maxRetries: number }): Promise<void>;
}

const realTrialFs: TrialFs = {
  mkdtemp: (prefix) => mkdtemp(prefix),
  rm: (p, opts) => rm(p, opts),
};

/**
 * 試しの入力。生成した本体のプロジェクトの場所（projectDir・cwd）は受け取らない
 * （試しが本体に触れないことを、型で保つ）。
 */
export interface RangeTrialInput {
  candidates: CandidateFinding[];
  /** 本体の最終の回答。app_name は試し用の名前に置き換えて使う */
  answers: Answers;
  acceptedWarnings: AcceptedWarning[];
  /** 本体の選定結果。対象と原因の2つだけを置き換える */
  versions: VersionResult;
  now: Date;
  runner: CommandRunner;
  dockerAvailable: () => Promise<boolean>;
  signal: AbortSignal;
  onProgress?: (message: string) => void;
  /** 飛ばした例外の詳細（stderr 用。画面の表・下書きには入れない） */
  onDetail?: (message: string) => void;
  /** 一時フォルダを作る場所。既定は os.tmpdir() */
  tmpRoot?: string;
  fs?: Partial<TrialFs>;
  timeouts?: Partial<Record<"install" | "dbUp" | "check" | "cleanup", number>>;
}

const TMP_PREFIX = "harness-range-trial-";
const REPLACED_REASON = "範囲の外の版を試す（未検証）";
/** アプリ名の長さの目安（docker の名前に使うため、長くしすぎない） */
const NAME_LIMIT = 50;

/** 対象と原因の2つだけを置き換えた選定結果。原因の entry が無ければ undefined */
export function trialVersions(
  versions: VersionResult,
  finding: CandidateFinding,
): { versions: VersionResult; replaced: ReplacedVersion[] } | undefined {
  const causeName = finding.target.cause.package;
  const targets: [string, string][] = [
    [finding.target.name, finding.candidate],
    [causeName, finding.causeVersion],
  ];
  const replaced: ReplacedVersion[] = [];
  const entries: VersionEntry[] = [];
  for (const [name, trial] of targets) {
    const found = versions.entries.find((e) => e.name === name);
    if (found === undefined) return undefined;
    replaced.push({ name, adopted: found.version, trial });
  }
  for (const entry of versions.entries) {
    const hit = replaced.find((r) => r.name === entry.name);
    if (hit === undefined) {
      entries.push({ ...entry });
      continue;
    }
    entries.push({
      ...entry,
      version: hit.trial,
      reason: REPLACED_REASON,
      newerThanVerified: true,
      majorDiffers:
        entry.verified !== null && compareWithVerified(entry.verified, hit.trial).majorDiffers,
    });
  }
  return { versions: { entries, newerThanVerified: true }, replaced };
}

/**
 * 試し用のアプリ名：<app>-rt-<実行ごとの識別子>-<候補の番号>。
 * Docker 上のプロジェクト名・コンテナ名・ボリュームが、本体・前回の残骸・並行実行と衝突しないようにする。
 */
export function trialAppName(appName: string, runId: string, index: number): string {
  const tail = `-rt-${runId}-${String(index)}`;
  const head = appName.slice(0, Math.max(1, NAME_LIMIT - tail.length)).replace(/-+$/, "");
  const name = `${head}${tail}`;
  return validateAppName(name) === undefined ? name : `harness${tail}`;
}

function newRunId(): string {
  return randomBytes(4).toString("hex");
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const DOWN = ["run", "docker:down:test"];
const DOWN_V_COMMAND = "npm run docker:down:test -- -v";

interface OneResult {
  result: TrialResult;
  /** この後の候補を試さない理由 */
  stop?: "interrupted" | "db-stop";
}

/**
 * 範囲の外の版を、別の一時フォルダで試す。本体のプロジェクトには触れない。
 * 最初に Docker を1回だけ確かめ、使えなければ何も作らず全件を飛ばす。候補は順に、候補ごとに別のフォルダと別の名前で試す。
 * 検証用 DB を止められなかったとき、中断したときは、残りを試さない。
 */
export async function runRangeTrials(input: RangeTrialInput): Promise<TrialResult[]> {
  const { candidates, signal } = input;
  const base = (finding: CandidateFinding, outcome: TrialOutcome): TrialResult => ({
    finding,
    replaced: [],
    outcome,
    cleanupFailures: [],
  });
  const all = (outcome: TrialOutcome): TrialResult[] => candidates.map((c) => base(c, outcome));

  let available = false;
  try {
    available = await input.dockerAvailable();
  } catch (e) {
    input.onDetail?.(`Docker の確認に失敗しました：${messageOf(e)}`);
  }
  if (signal.aborted) return all({ kind: "interrupted" });
  if (!available) return all({ kind: "skipped", reason: "docker-unavailable" });

  const runId = newRunId();
  const results: TrialResult[] = [];
  let stop: OneResult["stop"];
  for (const [i, finding] of candidates.entries()) {
    if (stop === "db-stop") {
      results.push(base(finding, { kind: "skipped", reason: "db-stop-failed-earlier" }));
      continue;
    }
    if (stop === "interrupted" || signal.aborted) {
      stop = "interrupted";
      results.push(base(finding, { kind: "interrupted" }));
      continue;
    }
    input.onProgress?.(
      `範囲の外の版を試しています（${String(i + 1)}/${String(candidates.length)}）：${finding.target.name} ${finding.candidate}`,
    );
    const one = await trialOne(input, finding, i + 1, runId);
    results.push(one.result);
    stop = one.stop;
  }
  return results;
}

async function trialOne(
  input: RangeTrialInput,
  finding: CandidateFinding,
  index: number,
  runId: string,
): Promise<OneResult> {
  const fs: TrialFs = { ...realTrialFs, ...input.fs };
  const { signal } = input;
  const skipped = (reason: TrialSkipReason, replaced: ReplacedVersion[] = []): OneResult => ({
    result: { finding, replaced, outcome: { kind: "skipped", reason }, cleanupFailures: [] },
  });

  const trial = trialVersions(input.versions, finding);
  if (trial === undefined) return skipped("missing-cause-entry");
  const { replaced } = trial;

  const appName = trialAppName(input.answers.app_name, runId, index);
  let tmp: string;
  try {
    tmp = await fs.mkdtemp(path.join(input.tmpRoot ?? os.tmpdir(), TMP_PREFIX));
  } catch (e) {
    input.onDetail?.(`試し用の一時フォルダを作れませんでした：${messageOf(e)}`);
    return skipped("write-failed", replaced);
  }

  const cleanupFailures: TrialCleanupFailure[] = [];
  let outcome: TrialOutcome = { kind: "skipped", reason: "unexpected-error" };
  let stop: OneResult["stop"];
  // 検証用 DB を止められなかったとき（または成否が分からないとき）は、一時フォルダを残す
  let keepTmp = false;
  try {
    let files;
    try {
      files = buildProject({
        answers: { ...input.answers, app_name: appName },
        acceptedWarnings: input.acceptedWarnings,
        versions: trial.versions,
        now: input.now,
      }).files;
    } catch (e) {
      input.onDetail?.(`試し用のプロジェクトを組み立てられませんでした：${messageOf(e)}`);
      outcome = { kind: "skipped", reason: "build-failed" };
      return { result: { finding, replaced, outcome, cleanupFailures } };
    }

    let dir: string;
    try {
      dir = (await writeProject({ cwd: tmp, appName, files, signal })).dir;
    } catch (e) {
      if (e instanceof GenerationInterrupted) {
        outcome = { kind: "interrupted" };
        return { result: { finding, replaced, outcome, cleanupFailures }, stop: "interrupted" };
      }
      input.onDetail?.(`試し用のプロジェクトを書き込めませんでした：${messageOf(e)}`);
      outcome = { kind: "skipped", reason: "write-failed" };
      return { result: { finding, replaced, outcome, cleanupFailures } };
    }

    const dbStopFailure = (command: string): TrialCleanupFailure => ({
      kind: "db-stop",
      dir,
      tmpDir: tmp,
      command,
    });
    const timeouts = { ...DEFAULT_TIMEOUTS, ...input.timeouts };

    let dbStopFailed = false;
    let dbMayHaveStarted = true;
    try {
      const verified = await verifyProject({
        projectDir: dir,
        database: input.answers.database,
        versions: trial.versions,
        runner: input.runner,
        dockerAvailable: () => Promise.resolve(true),
        signal,
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        ...(input.timeouts ? { timeouts: input.timeouts } : {}),
      });
      switch (verified.status) {
        case "passed":
          outcome = { kind: "passed" };
          break;
        case "failed":
          outcome = {
            kind: "failed",
            failedStep: verified.failedStep,
            failedScripts: verified.failedScripts,
            timedOut: verified.timedOut,
            suspects: verified.suspects,
            outputTail: verified.outputTail,
            outputSuppressed: verified.outputSuppressed,
          };
          dbMayHaveStarted = verified.failedStep !== "env" && verified.failedStep !== "install";
          break;
        case "skipped":
          outcome = { kind: "skipped", reason: "docker-unavailable" };
          dbMayHaveStarted = false;
          break;
        case "interrupted":
          outcome = { kind: "interrupted" };
          stop = "interrupted";
          break;
      }
      if ("cleanupFailures" in verified && verified.cleanupFailures.length > 0) {
        dbStopFailed = true;
        cleanupFailures.push(dbStopFailure(DOWN_V_COMMAND));
      }
    } catch (e) {
      // 例外のとき、停止の成否は付加情報で分かる。付加情報が無ければ不明なので、安全側に倒す
      input.onDetail?.(`動作確認を続けられませんでした：${messageOf(e)}`);
      outcome = { kind: "skipped", reason: "unexpected-error" };
      if (e instanceof VerifyCleanupError) {
        if (e.cleanupFailures.length > 0) {
          dbStopFailed = true;
          cleanupFailures.push(dbStopFailure(DOWN_V_COMMAND));
        }
      } else {
        dbStopFailed = true;
        cleanupFailures.push(dbStopFailure(DOWN_V_COMMAND));
      }
    }

    // 検証用 DB のボリューム（compose down だけでは消えない）を、自分の名前の資源だけ消す
    if (!dbStopFailed && input.answers.database === "postgresql" && dbMayHaveStarted) {
      try {
        const down = await input.runner("npm", [...DOWN, "--", "-v"], {
          cwd: dir,
          timeoutMs: timeouts.cleanup,
        });
        if (down.exitCode !== 0 || down.timedOut || down.startError) {
          dbStopFailed = true;
          cleanupFailures.push(dbStopFailure(DOWN_V_COMMAND));
        }
      } catch {
        dbStopFailed = true;
        cleanupFailures.push(dbStopFailure(DOWN_V_COMMAND));
      }
    }
    if (dbStopFailed) {
      keepTmp = true;
      stop = "db-stop";
    }
    return { result: { finding, replaced, outcome, cleanupFailures }, ...(stop ? { stop } : {}) };
  } finally {
    if (!keepTmp) {
      try {
        await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5 });
      } catch {
        cleanupFailures.push({ kind: "tmp-remove", path: tmp });
      }
    }
  }
}
