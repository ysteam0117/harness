// #6 PR-B：create の「範囲の外の版を試す」（AC-3・AC-4）。偽の runner・Docker・fetch。本物の npm・Docker・ネットワークは使わない。
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import type { ToolStatus } from "../../src/checks/tools.js";
import { runCreate, type CreateDeps, type CreateOptions } from "../../src/commands/create.js";
import { CancelledError } from "../../src/questions/prompter.js";
import { FakePrompter, baseAnswers, cleanupTmp, makeTmp } from "../questions/helpers.js";
import { FIXED_NOW } from "../versions/helpers.js";
import {
  DOWN,
  DOWN_V,
  candidateRegistry,
  makeRunner,
  type Behavior,
} from "../versions/range-trial-helpers.js";
import { LONG_TEST_MS, waitFor } from "../verify/helpers.js";

afterEach(cleanupTmp);

const okTools = async (): Promise<ToolStatus[]> => [
  { name: "node", state: "ok", version: "24.0.0" },
  { name: "git", state: "ok", version: "2.45.0" },
  { name: "docker", state: "ok", version: "27.0.1" },
];

function setup(
  options: {
    script?: Record<string, unknown[]>;
    behave?: (key: string, cwd: string) => Behavior;
    interactive?: boolean;
    fetcher?: ReturnType<typeof candidateRegistry>;
    docker?: boolean;
    generateFs?: CreateDeps["generateFs"];
  } = {},
) {
  const tmp = makeTmp();
  const trialRoot = path.join(tmp.root, "trial-root");
  mkdirSync(trialRoot);
  const prompter = new FakePrompter(options.script ?? {});
  const errs: string[] = [];
  const runner = makeRunner(options.behave);
  const deps: CreateDeps = {
    prompter,
    cwd: tmp.cwd,
    interactive: options.interactive ?? false,
    stderr: (s) => errs.push(s),
    checkTools: okTools,
    fetch: (options.fetcher ?? candidateRegistry()).fn,
    now: () => FIXED_NOW,
    runCommand: runner.runner,
    dockerAvailable: async () => options.docker ?? true,
    trialTmpRoot: trialRoot,
    ...(options.generateFs ? { generateFs: options.generateFs } : {}),
  };
  const file = path.join(tmp.inputDir, "answers.yaml");
  const project = path.join(tmp.cwd, "testapp-001");
  const run = (o: CreateOptions, answers: Record<string, unknown> = baseAnswers()) => {
    writeFileSync(file, stringify(answers));
    return runCreate({ answers: file, ...o }, deps);
  };
  return {
    tmp,
    prompter,
    runner,
    err: () => errs.join(""),
    notes: () => prompter.notes.join("\n"),
    project,
    trialRoot,
    run,
  };
}

/** フォルダの全ファイルの（相対パス → ハッシュ）。生成したプロジェクトが変わっていないことの確認 */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else
        out[path.relative(dir, full)] = createHash("sha256")
          .update(readFileSync(full))
          .digest("hex");
    }
  };
  walk(dir);
  return out;
}

const pgAnswers = () => baseAnswers({ database: "postgresql", postgres_provider: "neon" });
const titles = (s: ReturnType<typeof setup>) => s.prompter.notes.map((n) => n.split("\n")[0]);

describe("#6 AC-3：試すかどうか", () => {
  it("対話：確認の順は confirm_generate → verify_after_generate → try_wider_ranges。「いいえ」なら試さない", async () => {
    const s = setup({
      interactive: true,
      script: {
        confirm_generate: [true],
        verify_after_generate: [false],
        try_wider_ranges: [false],
      },
    });
    const out = await s.run({});
    expect(out.exitCode).toBe(0);
    expect(s.prompter.askedIds).toEqual([
      "confirm_generate",
      "verify_after_generate",
      "try_wider_ranges",
    ]);
    const ask = s.prompter.inputs.find((e) => e.id === "try_wider_ranges");
    expect(ask?.opts?.initialValue).toBe(false);
    expect(s.runner.calls).toHaveLength(0);
    expect(out.rangeTrials).toBeUndefined();
  });

  it("対話で「はい」：結果と下書きが出て、生成したプロジェクトは試しの前後で1ファイルも変わらず、試しの cwd は外にある。終了コード0", async () => {
    let before: Record<string, string> | undefined;
    const s: ReturnType<typeof setup> = setup({
      interactive: true,
      script: {
        confirm_generate: [true],
        verify_after_generate: [false],
        try_wider_ranges: [true],
      },
      behave: () => ({
        onCall: () => {
          before ??= snapshot(s.project);
        },
      }),
    });
    const out = await s.run({});
    expect(out.exitCode).toBe(0);
    expect(out.rangeTrials?.length).toBeGreaterThan(0);
    expect(out.rangeTrials?.every((r) => r.outcome.kind === "passed")).toBe(true);
    expect(titles(s)).toContain("範囲の外の版の試し");
    expect(s.notes()).toContain("ハーネスの改善の提案（下書き・試した結果つき）");
    expect(s.notes()).toContain("通った");
    expect(before).toBeDefined();
    expect(snapshot(s.project)).toEqual(before);
    for (const c of s.runner.calls) {
      expect(path.relative(s.project, c.cwd).startsWith("..")).toBe(true);
      expect(c.cwd.startsWith(s.trialRoot)).toBe(true);
    }
    expect(readdirSync(s.trialRoot)).toEqual([]);
  });

  it("--yes だけでは試さず、聞きもしない", async () => {
    const s = setup({ interactive: true });
    const out = await s.run({ yes: true });
    expect(out.exitCode).toBe(0);
    expect(s.prompter.askedIds).toEqual([]);
    expect(s.runner.calls).toHaveLength(0);
  });

  it("端末でなく --try-wider-ranges なしなら試さない", async () => {
    const s = setup({ interactive: false });
    const out = await s.run({ yes: true });
    expect(out.exitCode).toBe(0);
    expect(s.runner.calls).toHaveLength(0);
    expect(out.rangeTrials).toBeUndefined();
  });

  it("--yes --try-wider-ranges は聞かずに試す", async () => {
    const s = setup({ interactive: true });
    const out = await s.run({ yes: true, tryWiderRanges: true });
    expect(out.exitCode).toBe(0);
    expect(s.prompter.askedIds).toEqual([]);
    expect(s.runner.keys()).toContain("install");
    expect(out.rangeTrials?.length).toBeGreaterThan(0);
  });

  it("候補が無く --try-wider-ranges：「試す候補はありません」を表示し、終了コード0、npm は呼ばない", async () => {
    const s = setup({ fetcher: candidateRegistry("^4", "~6.0.0") });
    const out = await s.run({ yes: true, tryWiderRanges: true });
    expect(out.exitCode).toBe(0);
    expect(s.notes()).toContain("試す候補はありません");
    expect(s.runner.calls).toHaveLength(0);
  });

  it("本体の動作確認が中断（130）なら、試しを聞かず、試さない", async () => {
    const s = setup({
      interactive: true,
      script: { confirm_generate: [true], verify_after_generate: [true] },
      behave: (key) => (key === "install" ? { waitForAbort: true } : {}),
    });
    const running = s.run({});
    await waitFor(() => s.runner.keys().includes("install"), "本体の install の開始");
    process.emit("SIGINT", "SIGINT");
    const out = await running;
    expect(out.exitCode).toBe(130);
    expect(s.prompter.askedIds).toEqual(["confirm_generate", "verify_after_generate"]);
    expect(out.rangeTrials).toBeUndefined();
  });

  it("確認の取り消し（Ctrl+C）：生成は終わっている旨を stderr に出し、終了コードは変えない", async () => {
    const s = setup({
      interactive: true,
      script: {
        confirm_generate: [true],
        verify_after_generate: [false],
        try_wider_ranges: [new CancelledError()],
      },
    });
    const out = await s.run({});
    expect(out.exitCode).toBe(0);
    expect(s.err()).toContain("試しは行いませんでした（生成は終わっています）");
    expect(s.runner.calls).toHaveLength(0);
  });
});

describe("#6 AC-3：試しの失敗・中断・後始末の失敗でも、終了コードは変えない", () => {
  it("試しが失敗（check 失敗）しても、終了コードは0。失敗は結果の表に出て、下書きに載る", async () => {
    const s = setup({
      behave: (key) =>
        key === "run check"
          ? { exitCode: 1, raw: "> x@0.0.0 typecheck\nerror TS2307: Cannot find module" }
          : {},
    });
    const out = await s.run({ yes: true, tryWiderRanges: true });
    expect(out.exitCode).toBe(0);
    expect(out.rangeTrials?.every((r) => r.outcome.kind === "failed")).toBe(true);
    expect(s.notes()).toContain("失敗");
    expect(s.notes()).toContain("実際に試すと失敗した");
  });

  it("Docker が無い：npm を呼ばず、飛ばした旨を表示し、終了コードは0", async () => {
    const s = setup({ docker: false });
    const out = await s.run({ yes: true, tryWiderRanges: true });
    expect(out.exitCode).toBe(0);
    expect(s.runner.calls).toHaveLength(0);
    expect(s.notes()).toContain("Docker を使えなかった");
  });

  it(
    "試しの途中の SIGINT：試しは中断になるが、終了コードは0のまま（130にしない）。リスナーは外れる",
    async () => {
      const before = process.listenerCount("SIGINT");
      const s = setup({ behave: (key) => (key === "run check" ? { waitForAbort: true } : {}) });
      const running = s.run({ yes: true, tryWiderRanges: true });
      await waitFor(() => s.runner.keys().includes("run check"), "試しの check の開始");
      process.emit("SIGINT", "SIGINT");
      const out = await running;
      expect(out.exitCode).toBe(0);
      expect(out.rangeTrials?.every((r) => r.outcome.kind === "interrupted")).toBe(true);
      expect(s.err()).toContain("中断しました");
      expect(process.listenerCount("SIGINT")).toBe(before);
      expect(readdirSync(s.trialRoot)).toEqual([]);
    },
    LONG_TEST_MS,
  );

  it("後始末の失敗（検証用 DB を止められない）：終了コードは0。案内を stderr と画面に出し、フォルダを残す", async () => {
    const s = setup({ behave: (key) => (key === DOWN ? { exitCode: 1 } : {}) });
    const out = await s.run({ yes: true, tryWiderRanges: true }, pgAnswers());
    expect(out.exitCode).toBe(0);
    expect(s.err()).toContain("検証用 DB を停止できませんでした");
    expect(s.err()).toContain("生成したプロジェクトの場所では実行しないでください");
    expect(s.err()).not.toContain(s.project);
    expect(readdirSync(s.trialRoot)).toHaveLength(1);
    // 下書きには、一時フォルダのパスを入れない
    const draft =
      s.prompter.notes.find((n) =>
        n.startsWith("ハーネスの改善の提案（下書き・試した結果つき）"),
      ) ?? "";
    expect(draft).not.toContain(s.trialRoot);
  });

  it("PostgreSQL の通常の試し：down と down -v が呼ばれ、本体のプロジェクトでは呼ばれない", async () => {
    const s = setup();
    const out = await s.run({ yes: true, tryWiderRanges: true }, pgAnswers());
    expect(out.exitCode).toBe(0);
    expect(s.runner.keys()).toContain(DOWN_V);
    for (const c of s.runner.calls) expect(c.cwd.startsWith(s.trialRoot)).toBe(true);
    expect(readdirSync(s.trialRoot)).toEqual([]);
  });
});
