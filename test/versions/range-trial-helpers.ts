// #6 PR-B：範囲の外の版の試しのテストの共通の道具（偽の runner・偽の登録情報・本体の準備）。
// 本物の npm・Docker・ネットワークは使わない。値と名前はすべて架空。
import { writeFileSync } from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import type { ToolStatus } from "../../src/checks/tools.js";
import { runCreate, type CreateOutcome } from "../../src/commands/create.js";
import type { CommandRunner, RunOptions, RunResult } from "../../src/verify/runner.js";
import { FakePrompter, baseAnswers, makeTmp } from "../questions/helpers.js";
import { FIXED_NOW, registryForReal } from "./helpers.js";

export const UP = "run docker:up:test -- --wait db";
export const DOWN = "run docker:down:test";
export const DOWN_V = "run docker:down:test -- -v";

export interface Behavior {
  exitCode?: number;
  timedOut?: boolean;
  raw?: string;
  /** runner が例外を投げる */
  throws?: boolean;
  /** 中断の合図が来るまで待ち、aborted で返す */
  waitForAbort?: boolean;
  /** 呼ばれたときに実行する（package.json の読み取りなど） */
  onCall?: () => void;
}

export interface RecordedCall {
  key: string;
  cwd: string;
  opts: RunOptions;
}

/** 呼び出しを記録する偽の runner。behave は（key, cwd）ごとの結果を決める */
export function makeRunner(behave: (key: string, cwd: string) => Behavior = () => ({})) {
  const calls: RecordedCall[] = [];
  const runner: CommandRunner = async (_command, args, opts) => {
    const key = args.join(" ");
    calls.push({ key, cwd: opts.cwd, opts });
    const b = behave(key, opts.cwd);
    b.onCall?.();
    if (b.throws) throw new Error("runner の例外（テスト）");
    const raw = b.raw ?? "";
    const done = (aborted: boolean): RunResult => {
      const scanned: Record<string, string[]> = {};
      for (const [name, scan] of Object.entries(opts.scans ?? {})) scanned[name] = scan(raw);
      return {
        exitCode: aborted || b.timedOut ? null : (b.exitCode ?? 0),
        timedOut: b.timedOut ?? false,
        aborted,
        startError: false,
        outputTail: (opts.redact ?? ((t: string) => t))(raw).slice(-4000),
        scanned,
      };
    };
    if (b.waitForAbort) {
      if (!opts.signal?.aborted) {
        await new Promise<void>((resolve) =>
          opts.signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      }
      return done(true);
    }
    return done(false);
  };
  return { runner, calls, keys: () => calls.map((c) => c.key) };
}

const okTools = async (): Promise<ToolStatus[]> => [
  { name: "node", state: "ok", version: "24.0.0" },
  { name: "git", state: "ok", version: "2.45.0" },
  { name: "docker", state: "ok", version: "27.0.1" },
];

/** 原因（vitest-pool-workers・typescript-eslint）が範囲の外の版にも対応している、架空の登録情報 */
export function candidateRegistry(peer = "^4 || ^5", tsPeer = "^6.0.0 || ^7.0.0") {
  return registryForReal(
    {
      vitest: ["4.1.11", "4.2.0", "5.0.0", "5.1.0"],
      typescript: ["6.0.3", "6.0.9", "6.1.0", "7.0.0"],
    },
    {
      peers: {
        "@cloudflare/vitest-pool-workers": { "0.22.0": { vitest: peer } },
        "typescript-eslint": { "8.71.0": { typescript: tsPeer } },
      },
    },
  );
}

/**
 * 本体を作って（生成まで）、試しの入力に使う回答・選定結果・範囲の見直しを得る。
 * 生成の出力先は一時フォルダ。動作確認はしない。
 */
export async function prepareMain(
  over: Record<string, unknown> = {},
  fetcher = candidateRegistry(),
): Promise<CreateOutcome & { cwd: string }> {
  const tmp = makeTmp();
  const file = path.join(tmp.inputDir, "answers.yaml");
  writeFileSync(file, stringify(baseAnswers(over)));
  const out = await runCreate(
    { answers: file, yes: true },
    {
      prompter: new FakePrompter({}),
      cwd: tmp.cwd,
      interactive: false,
      stderr: () => undefined,
      checkTools: okTools,
      fetch: fetcher.fn,
      now: () => FIXED_NOW,
      runCommand: makeRunner().runner,
      dockerAvailable: async () => true,
    },
  );
  return { ...out, cwd: tmp.cwd };
}
