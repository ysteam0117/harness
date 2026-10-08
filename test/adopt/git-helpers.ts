// #20 harness adopt のブランチ作成のテストの道具。偽の git(実行した引数を記録する)と、既存のテスト向けの runAdopt の包み。
// 実在の個人名・実データは使わない(架空の値だけ)。
import {
  runAdopt as runAdoptReal,
  type AdoptDeps,
  type AdoptOptions,
} from "../../src/commands/adopt.js";
import type { GitResult, RunGit } from "../../src/commands/update.js";

export interface FakeGitState {
  /** git のフォルダか(既定 true) */
  inside?: boolean;
  /** git status --porcelain の出力(既定は空=きれい) */
  dirty?: string;
  /** 今のブランチ(既定 main。空文字は HEAD が切り離されている) */
  branch?: string;
  /** すでにあるブランチ */
  existing?: string[];
  /** switch -c の終了コード(既定 0) */
  switchCode?: number;
  /** switch -c を実行した時点で呼ぶ(書き込みより前かを確かめる) */
  onSwitch?: () => void;
}

export interface FakeGit {
  runGit: RunGit;
  /** 実行した git の引数 */
  calls: string[][];
  /** 今のブランチを動かす(対話の途中で別のブランチへ移された、を再現する) */
  setBranch: (name: string) => void;
}

const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });

export function fakeGit(state: FakeGitState = {}): FakeGit {
  const calls: string[][] = [];
  let current = state.branch ?? "main";
  const runGit: RunGit = async (args) => {
    calls.push(args);
    const [a, b] = args;
    if (a === "rev-parse" && b === "--is-inside-work-tree") {
      return state.inside === false
        ? { code: 128, stdout: "", stderr: "fatal: not a git repository" }
        : ok("true\n");
    }
    if (a === "status") return ok(state.dirty ?? "");
    if (a === "branch" && b === "--show-current") return ok(`${current}\n`);
    if (a === "rev-parse" && b === "--verify") {
      const name = (args[args.length - 1] ?? "").replace("refs/heads/", "");
      return (state.existing ?? []).includes(name)
        ? ok("0000000\n")
        : { code: 1, stdout: "", stderr: "" };
    }
    if (a === "switch") {
      if (b === "-c" && args[2] !== undefined) current = args[2];
      state.onSwitch?.();
      return state.switchCode === undefined || state.switchCode === 0
        ? ok()
        : { code: state.switchCode, stdout: "", stderr: "fatal: switch failed" };
    }
    return { code: 1, stdout: "", stderr: `unexpected: ${args.join(" ")}` };
  };
  return { runGit, calls, setBranch: (name) => (current = name) };
}

/**
 * 既存のテスト向けの runAdopt。--issue(適用時は必須)と偽の git(きれいな main)を、指定がなければ補う。
 * 実際の git を使うテストは、これを使わずに runAdopt を直接呼ぶ
 */
export function runAdopt(options: AdoptOptions, deps: AdoptDeps) {
  return runAdoptReal({ issue: 12, ...options }, { runGit: fakeGit().runGit, ...deps });
}
