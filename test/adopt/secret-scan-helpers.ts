// #17 秘密情報の確認のテスト共通の道具。ダミーの値は、実行時に文字列を連結して作る（ソースに直接書かない）。
// 実データ・個人名は使わない（架空の値だけ）。
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Runner, RunResult } from "../../src/adopt/secret-scan.js";

/** 架空の値（テスト専用）。リポジトリ自身の gitleaks に引っかからないよう、連結して作る */
export const DUMMY = ["FAKE", "SECRET", "VALUE", "0042"].join("_");

export const COMMIT_A = "a1b2c3d".padEnd(40, "0");

export const ok = (over: Partial<RunResult> = {}): RunResult => ({
  exitCode: 0,
  failedToStart: false,
  timedOut: false,
  aborted: false,
  stdout: "",
  stderr: "",
  ...over,
});

/** git が「リポジトリではない」と答えたときの標準エラー（英語に固定して読む） */
export const NOT_GIT = "fatal: not a git repository (or any of the parent directories): .git";

export interface DockerCall {
  command: string;
  args: string[];
}

export interface FakeOptions {
  /** docker info の結果 */
  info?: RunResult;
  /** git rev-parse --show-toplevel の結果。stdout にトップ */
  top?: RunResult;
  /** docker ps（残ったコンテナの探索）の結果。stdout に ID。既定は残っている */
  ps?: RunResult;
  /** docker rm -f の結果 */
  rm?: RunResult;
  /** 読めないファイル・フォルダの調べ（--entrypoint sh）の結果。stdout は件数。既定は 0 件 */
  readable?: RunResult;
  /** 履歴の確認（git モード）。report は gitleaks のレポート（JSON の文字列）、exit は終了コード */
  history?: { exit: number; report?: string; over?: Partial<RunResult> };
  /** 作業フォルダの確認（dir モード） */
  worktree?: { exit: number; report?: string; over?: Partial<RunResult> };
}

/** docker run の引数から、一時フォルダ（/out の側）を探す */
export function outDirOf(args: string[]): string | undefined {
  const index = args.findIndex((a) => a.endsWith(":/out"));
  return index === -1 ? undefined : (args[index] ?? "").slice(0, -":/out".length);
}

/** 本物の docker・git を使わない実行役。呼ばれた順を calls に残す */
export function fakeRunner(options: FakeOptions = {}): { runner: Runner; calls: DockerCall[] } {
  const calls: DockerCall[] = [];
  const runner: Runner = (command, args) => {
    calls.push({ command, args });
    if (command === "docker" && args[0] === "info") return Promise.resolve(options.info ?? ok());
    if (command === "docker" && args[0] === "ps") {
      return Promise.resolve(options.ps ?? ok({ stdout: "abc123" }));
    }
    if (command === "docker" && args[0] === "rm") return Promise.resolve(options.rm ?? ok());
    if (command === "git") {
      return Promise.resolve(options.top ?? ok({ exitCode: 128, stderr: NOT_GIT }));
    }
    if (command === "docker" && args[0] === "run") {
      if (args.includes("--entrypoint")) {
        return Promise.resolve(options.readable ?? ok({ stdout: "0" }));
      }
      const mode = args.includes("git") ? "history" : "worktree";
      const planned = options[mode];
      const out = outDirOf(args);
      if (planned === undefined) return Promise.resolve(ok());
      if (planned.report !== undefined && out !== undefined) {
        writeFileSync(path.join(out, "report.json"), planned.report);
      }
      return Promise.resolve(ok({ exitCode: planned.exit, ...planned.over }));
    }
    return Promise.resolve(ok());
  };
  return { runner, calls };
}

/** gitleaks のレポートの1件。Secret・Match・Line には、ダミーを入れる（本物の gitleaks なら --redact で REDACTED になる） */
export function reportItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    RuleID: "generic-api-key",
    Description: `説明 ${DUMMY}`,
    StartLine: 3,
    EndLine: 3,
    Match: DUMMY,
    Secret: DUMMY,
    Line: DUMMY,
    File: "src/config.ts",
    Commit: COMMIT_A,
    Author: "testuser_001",
    Email: "testuser_001@example.com",
    Fingerprint: `${COMMIT_A}:src/config.ts:generic-api-key:3`,
    ...over,
  };
}

export const reportOf = (...items: Record<string, unknown>[]): string => JSON.stringify(items);

/** 問題なしの確認（adopt の他のテストで、本物の docker を使わないための差し替え） */
export const cleanScan = (): Promise<{ kind: "clean"; scope: "history+worktree" }> =>
  Promise.resolve({ kind: "clean", scope: "history+worktree" });
