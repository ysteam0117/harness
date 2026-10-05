// #57：生成の直後に、選んだバージョンで動くかを確かめて記録する（偽の runner・偽の Docker。本物の npm・Docker は使わない）
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import type { ToolStatus } from "../../src/checks/tools.js";
import { runCreate, type CreateDeps, type CreateOptions } from "../../src/commands/create.js";
import { CancelledError } from "../../src/questions/prompter.js";
import type { CommandRunner, RunOptions, RunResult } from "../../src/verify/runner.js";
import { FakePrompter, baseAnswers, cleanupTmp, makeTmp } from "../questions/helpers.js";
import { FIXED_DAY, FIXED_NOW, offlineFetch, registryForReal } from "../versions/helpers.js";
import { LONG_TEST_MS, waitFor } from "../verify/helpers.js";

afterEach(cleanupTmp);

const RULE7 = "version-newer-than-verified";
const UP = "run docker:up:test -- --wait db";
const DOWN = "run docker:down:test";

const okTools = async (): Promise<ToolStatus[]> => [
  { name: "node", state: "ok", version: "24.0.0" },
  { name: "git", state: "ok", version: "2.45.0" },
  { name: "docker", state: "ok", version: "27.0.1" },
];

interface Behavior {
  exitCode?: number;
  raw?: string;
  /** true なら、中断の合図が来るまで待ち、aborted で返す */
  waitForAbort?: boolean;
  /** runner の完了を、テスト側から許可するまで待つ */
  waitFor?: Promise<void>;
}

function setup(
  options: {
    script?: Record<string, unknown[]>;
    behave?: (key: string) => Behavior;
    docker?: boolean;
    fetcher?: ReturnType<typeof offlineFetch>;
    interactive?: boolean;
  } = {},
) {
  const tmp = makeTmp();
  const prompter = new FakePrompter(options.script ?? {});
  const errs: string[] = [];
  const calls: { key: string; opts: RunOptions }[] = [];
  const started: Record<string, () => void> = {};
  const startedPromises: Record<string, Promise<void>> = {};
  const whenStarted = (key: string): Promise<void> =>
    (startedPromises[key] ??= new Promise<void>((resolve) => {
      started[key] = resolve;
    }));
  let dockerChecks = 0;
  const runCommand: CommandRunner = async (_command, args, opts) => {
    const key = args.join(" ");
    calls.push({ key, opts });
    void whenStarted(key);
    started[key]?.();
    const b = options.behave?.(key) ?? {};
    const raw = b.raw ?? "";
    const done = (aborted: boolean): RunResult => {
      const scanned: Record<string, string[]> = {};
      for (const [name, scan] of Object.entries(opts.scans ?? {})) scanned[name] = scan(raw);
      return {
        exitCode: aborted ? null : (b.exitCode ?? 0),
        timedOut: false,
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
    await b.waitFor;
    return done(false);
  };
  const deps: CreateDeps = {
    prompter,
    cwd: tmp.cwd,
    interactive: options.interactive ?? false,
    stderr: (s) => errs.push(s),
    checkTools: okTools,
    fetch: (options.fetcher ?? offlineFetch()).fn,
    now: () => FIXED_NOW,
    runCommand,
    dockerAvailable: async () => {
      dockerChecks++;
      return options.docker ?? true;
    },
  };
  const writeAnswers = (obj: Record<string, unknown>) => {
    const file = path.join(tmp.inputDir, "answers.yaml");
    writeFileSync(file, stringify(obj));
    return file;
  };
  const project = path.join(tmp.cwd, "testapp-001");
  const run = (o: CreateOptions, answers: Record<string, unknown> = baseAnswers()) =>
    runCreate({ answers: writeAnswers(answers), ...o }, deps);
  return {
    tmp,
    prompter,
    deps,
    calls,
    keys: () => calls.map((c) => c.key),
    whenStarted,
    dockerChecks: () => dockerChecks,
    err: () => errs.join(""),
    notes: () => prompter.notes.join("\n"),
    all: () => `${errs.join("")}\n${prompter.notes.join("\n")}`,
    project,
    techStack: () => readFileSync(path.join(project, "docs", "tech-stack.md"), "utf8"),
    run,
  };
}

const pgAnswers = () => baseAnswers({ database: "postgresql", postgres_provider: "neon" });

describe("#57 AC-1：通ったとき", () => {
  it("--yes --verify：install → check の順に実行し、結果を表示し、tech-stack.md に固定の日付で記録し、終了コード0", async () => {
    const s = setup();
    const out = await s.run({ yes: true, verify: true });
    expect(out.exitCode).toBe(0);
    expect(s.keys()).toEqual(["install", "run check"]);
    expect(out.verification?.status).toBe("passed");
    expect(s.notes()).toContain("通りました");
    const text = s.techStack();
    expect(text).toContain("## 動作確認");
    expect(text).toContain(
      `このプロジェクトで動作確認済み（${FIXED_DAY}、npm install・npm run check）`,
    );
    expect(text.match(/## 動作確認/g)).toHaveLength(1);
    expect(out.techStack).toBeDefined(); // 生成のときの中身（記録の前）は、そのまま
    expect(s.notes()).not.toContain("C-78"); // 検証済みの版だけなので、提案は出さない
  });

  it("生成直後に、.env.development と .env.test が作られ（項目は .env.example と一致）、作ったことが表示される。値は表示されない", async () => {
    const s = setup();
    await s.run({ yes: true, verify: true });
    const names = Object.keys(parseEnv(readFileSync(path.join(s.project, ".env.example"), "utf8")));
    for (const file of [".env.development", ".env.test"]) {
      const values = parseEnv(readFileSync(path.join(s.project, file), "utf8"));
      expect(Object.keys(values).sort()).toEqual([...names].sort());
      for (const [name, value] of Object.entries(values)) {
        if (/SECRET/.test(name) && value) expect(s.all(), name).not.toContain(value);
      }
    }
    expect(s.notes()).toContain(".env.test");
  });

  it("未検証の新しい版で通ったときだけ、C-78 の提案（プロファイルの verified_versions の更新）を表示する。何も書き込まない", async () => {
    const fetcher = registryForReal({
      vitest: ["4.1.11", "4.2.0"],
      typescript: ["6.0.3", "6.0.9"],
    });
    const s = setup({ fetcher });
    const out = await s.run(
      { yes: true, verify: true },
      { ...baseAnswers({ version_policy: "latest" }), accepted_warnings: [RULE7] },
    );
    expect(out.exitCode).toBe(0);
    expect(out.verification?.status).toBe("passed");
    expect(s.notes()).toContain("C-78");
    expect(s.notes()).toContain("verified_versions");
    expect(s.notes()).toContain("vitest");
    expect(existsSync(path.join(s.project, "docs", "harness-feedback"))).toBe(false);
  });
});

describe("#57 AC-2：失敗したとき", () => {
  const failingCheck = (key: string): Behavior =>
    key === "run check"
      ? {
          exitCode: 1,
          raw: [
            "> testapp-001@0.0.0 typecheck",
            "error TS2307: Cannot find module 'vitest' (FAKE_SECRET_FOR_TEST)",
          ].join("\n"),
        }
      : {};

  it("--verify で check が失敗：終了コード1。失敗した script 名・原因の候補・戻し方を表示し、記録は足さず、生成物は残る", async () => {
    const s = setup({ behave: failingCheck });
    const out = await s.run({ yes: true, verify: true });
    expect(out.exitCode).toBe(1);
    expect(out.verification).toMatchObject({
      status: "failed",
      failedStep: "check",
      failedScripts: ["typecheck"],
    });
    const shown = s.all();
    expect(shown).toContain("typecheck");
    expect(shown).toContain("vitest"); // 出力に名前が出た候補
    expect(shown).toContain("検証済みの版に戻す方法");
    expect(shown).toContain("package.json");
    expect(shown).toContain("version_policy");
    expect(s.techStack()).not.toContain("動作確認");
    expect(existsSync(path.join(s.project, ".harness", "config.yaml"))).toBe(true);
    expect(existsSync(path.join(s.project, "package.json"))).toBe(true);
  });

  it("install が失敗したら check を呼ばない（終了コード1）", async () => {
    const s = setup({ behave: (key) => (key === "install" ? { exitCode: 1 } : {}) });
    const out = await s.run({ yes: true, verify: true });
    expect(s.keys()).toEqual(["install"]);
    expect(out.exitCode).toBe(1);
    expect(out.verification).toMatchObject({ status: "failed", failedStep: "install" });
  });

  it("対話で「はい」を選んで失敗したときは、終了コード0（案内は表示する）", async () => {
    const s = setup({
      interactive: true,
      behave: failingCheck,
      script: { confirm_generate: [true], verify_after_generate: [true] },
    });
    const out = await s.run({});
    expect(out.exitCode).toBe(0);
    expect(out.verification?.status).toBe("failed");
    expect(s.notes()).toContain("検証済みの版に戻す方法");
    expect(existsSync(path.join(s.project, ".harness", "config.yaml"))).toBe(true);
  });

  it("出力の秘密の値（環境ファイルの値）は、表示にも結果にも出ない", async () => {
    const s = setup({
      behave: (key) => {
        if (key !== "run check") return {};
        const dev = readFileSync(path.join(s.project, ".env.development"), "utf8");
        const secret = /^SESSION_SECRET=(.+)$/m.exec(dev)?.[1] ?? "";
        return { exitCode: 1, raw: `> testapp-001@0.0.0 lint\nvalue=${secret}\n` };
      },
    });
    const out = await s.run({ yes: true, verify: true });
    const dev = readFileSync(path.join(s.project, ".env.development"), "utf8");
    const secret = /^SESSION_SECRET=(.+)$/m.exec(dev)?.[1] ?? "";
    expect(secret.length).toBeGreaterThanOrEqual(16);
    expect(s.all()).not.toContain(secret);
    expect(JSON.stringify(out.verification)).not.toContain(secret);
    expect(s.all()).toContain("[REDACTED]");
  });
});

describe("#57：確かめるかどうかの判定", () => {
  it("対話で「はい」→実行する。質問は verify_after_generate（既定は「いいえ」）", async () => {
    const s = setup({
      interactive: true,
      script: { confirm_generate: [true], verify_after_generate: [true] },
    });
    const out = await s.run({});
    expect(out.exitCode).toBe(0);
    expect(s.keys()).toEqual(["install", "run check"]);
    const asked = s.prompter.inputs.find((e) => e.id === "verify_after_generate");
    expect(asked?.opts.initialValue).toBe(false);
    expect(asked?.message).toContain("npm run check");
  });

  it("対話で「いいえ」→runner は呼ばれず、生成物は残り、終了コード0。次の手順に npm install が出る", async () => {
    const s = setup({
      interactive: true,
      script: { confirm_generate: [true], verify_after_generate: [false] },
    });
    const out = await s.run({});
    expect(out.exitCode).toBe(0);
    expect(s.calls).toHaveLength(0);
    expect(out.verification).toBeUndefined();
    expect(existsSync(path.join(s.project, ".harness", "config.yaml"))).toBe(true);
    expect(s.notes()).toContain("npm install");
  });

  it("--yes だけ（--verify なし）→確認も実行もしない", async () => {
    const s = setup({ interactive: true });
    const out = await s.run({ yes: true });
    expect(out.exitCode).toBe(0);
    expect(s.calls).toHaveLength(0);
    expect(s.prompter.askedIds).not.toContain("verify_after_generate");
  });

  it("対話しない（--yes のみ）→確認も実行もしない", async () => {
    const s = setup();
    const out = await s.run({ yes: true });
    expect(out.exitCode).toBe(0);
    expect(s.calls).toHaveLength(0);
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("--yes --verify（対話しない）→質問せずに実行する", async () => {
    const s = setup();
    await s.run({ yes: true, verify: true });
    expect(s.keys()).toEqual(["install", "run check"]);
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("対話で --verify だけ（--yes なし）→最後の確認は聞くが、動作確認は聞かずに実行する", async () => {
    const s = setup({ interactive: true, script: { confirm_generate: [true] } });
    await s.run({ verify: true });
    expect(s.prompter.askedIds).not.toContain("verify_after_generate");
    expect(s.keys()).toEqual(["install", "run check"]);
  });

  it("R5：動作確認の質問で Ctrl+C →生成物を残し、終了コード130。「生成は終わっています」を示し、「ファイルは作成していません」は出さない", async () => {
    const s = setup({
      interactive: true,
      script: { confirm_generate: [true], verify_after_generate: [new CancelledError()] },
    });
    const out = await s.run({});
    expect(out.exitCode).toBe(130);
    expect(existsSync(path.join(s.project, ".harness", "config.yaml"))).toBe(true);
    expect(out.projectDir).toBe(s.project);
    expect(s.err()).toContain("生成は終わっています");
    expect(s.err()).toContain(s.project);
    expect(s.err()).toContain("動作の確認は行いませんでした");
    expect(s.err()).not.toContain("ファイルは作成していません");
    expect(s.calls).toHaveLength(0);
  });

  it("生成の前の Ctrl+C は、これまでどおり「ファイルは作成していません」（確認しない）", async () => {
    const s = setup({ interactive: true, script: { confirm_generate: [new CancelledError()] } });
    const out = await s.run({});
    expect(out.exitCode).toBe(130);
    expect(s.err()).toContain("ファイルは作成していません");
    expect(existsSync(s.project)).toBe(false);
  });
});

describe("#57：PostgreSQL と Docker", () => {
  it("install → up → check → down の順（Docker を確かめてから）", async () => {
    const s = setup();
    const out = await s.run({ yes: true, verify: true }, pgAnswers());
    expect(out.exitCode).toBe(0);
    expect(s.dockerChecks()).toBe(1);
    expect(s.keys()).toEqual(["install", UP, "run check", DOWN]);
  });

  it("Docker が使えなければ、npm を呼ばず、理由を表示して飛ばす（--verify でも終了コード0。生成物は残る）", async () => {
    const s = setup({ docker: false });
    const out = await s.run({ yes: true, verify: true }, pgAnswers());
    expect(out.exitCode).toBe(0);
    expect(s.calls).toHaveLength(0);
    expect(out.verification?.status).toBe("skipped");
    expect(s.notes()).toContain("Docker");
    expect(existsSync(path.join(s.project, ".harness", "config.yaml"))).toBe(true);
    expect(s.techStack()).not.toContain("動作確認");
  });

  it("D1 では、Docker を確かめない", async () => {
    const s = setup({ docker: false });
    const out = await s.run({ yes: true, verify: true });
    expect(s.dockerChecks()).toBe(0);
    expect(out.verification?.status).toBe("passed");
  });

  it("DB なしでも、Docker を確かめない", async () => {
    const s = setup({ docker: false });
    const out = await s.run(
      { yes: true, verify: true },
      { ...baseAnswers({ database: "none", auth: "none" }), idp: undefined },
    );
    expect(s.dockerChecks()).toBe(0);
    expect(out.verification?.status).toBe("passed");
  });

  it("check が失敗しても down を呼ぶ（--verify なので終了コード1）", async () => {
    const s = setup({ behave: (key) => (key === "run check" ? { exitCode: 1 } : {}) });
    const out = await s.run({ yes: true, verify: true }, pgAnswers());
    expect(s.keys()).toEqual(["install", UP, "run check", DOWN]);
    expect(out.exitCode).toBe(1);
  });
});

describe("#57：中断（SIGINT・SIGTERM）", () => {
  it.each([
    ["SIGINT", 0],
    ["SIGTERM", 0],
    ["SIGINT", 1],
    ["SIGTERM", 1],
  ] as const)(
    "down の途中の %s（check の終了コード%d）：後始末の完了を待ち、中断として終了コード130を返し、記録せず生成物を残す",
    async (signal, checkExitCode) => {
      let finishCleanup!: () => void;
      const cleanup = new Promise<void>((resolve) => {
        finishCleanup = resolve;
      });
      const s = setup({
        behave: (key) =>
          key === DOWN
            ? { waitFor: cleanup }
            : key === "run check"
              ? { exitCode: checkExitCode }
              : {},
      });
      let finished = false;
      const running = s.run({ yes: true, verify: true }, pgAnswers()).then((out) => {
        finished = true;
        return out;
      });
      await s.whenStarted(DOWN);
      try {
        process.emit(signal, signal);
        expect(s.calls.find((c) => c.key === "run check")?.opts.signal?.aborted).toBe(true);
        expect(s.calls.find((c) => c.key === DOWN)?.opts.signal).toBeUndefined();
        await Promise.resolve();
        expect(finished).toBe(false);
      } finally {
        finishCleanup();
      }
      const out = await running;
      expect(out.verification).toEqual({ status: "interrupted", cleanupFailures: [] });
      expect(out.exitCode).toBe(130);
      expect(s.keys()).toEqual(["install", UP, "run check", DOWN]);
      expect(s.techStack()).not.toContain("動作確認");
      expect(existsSync(path.join(s.project, ".harness", "config.yaml"))).toBe(true);
      expect(existsSync(path.join(s.project, "package.json"))).toBe(true);
    },
    LONG_TEST_MS,
  );

  it(
    "check の途中の SIGINT：signal が runner に届き、down が1回だけ呼ばれ、終了コード130、生成物が残り、リスナーが外れる",
    async () => {
      const before = process.listenerCount("SIGINT");
      const beforeTerm = process.listenerCount("SIGTERM");
      const s = setup({ behave: (key) => (key === "run check" ? { waitForAbort: true } : {}) });
      const running = s.run({ yes: true, verify: true }, pgAnswers());
      await s.whenStarted("run check");
      await waitFor(() => process.listenerCount("SIGINT") > before, "SIGINT の受け手の登録");
      const check = s.calls.find((c) => c.key === "run check");
      expect(check?.opts.signal?.aborted).toBe(false);
      process.emit("SIGINT", "SIGINT");
      const out = await running;
      expect(check?.opts.signal?.aborted).toBe(true);
      expect(out.exitCode).toBe(130);
      expect(out.verification?.status).toBe("interrupted");
      expect(s.keys().filter((k) => k === DOWN)).toHaveLength(1);
      expect(s.keys()).toEqual(["install", UP, "run check", DOWN]);
      expect(s.calls.find((c) => c.key === DOWN)?.opts.signal).toBeUndefined();
      expect(existsSync(path.join(s.project, ".harness", "config.yaml"))).toBe(true);
      expect(s.techStack()).not.toContain("動作確認");
      expect(s.err()).toContain("中断");
      expect(process.listenerCount("SIGINT")).toBe(before);
      expect(process.listenerCount("SIGTERM")).toBe(beforeTerm);
    },
    LONG_TEST_MS,
  );

  it(
    "SIGTERM でも同じ（終了コード130）",
    async () => {
      const s = setup({ behave: (key) => (key === "install" ? { waitForAbort: true } : {}) });
      const running = s.run({ yes: true, verify: true });
      await s.whenStarted("install");
      process.emit("SIGTERM", "SIGTERM");
      const out = await running;
      expect(out.exitCode).toBe(130);
      expect(s.keys()).toEqual(["install"]);
    },
    LONG_TEST_MS,
  );

  it(
    "続けて2回 SIGINT が来ても、後始末は1回だけ",
    async () => {
      const s = setup({ behave: (key) => (key === "run check" ? { waitForAbort: true } : {}) });
      const running = s.run({ yes: true, verify: true }, pgAnswers());
      await s.whenStarted("run check");
      process.emit("SIGINT", "SIGINT");
      process.emit("SIGINT", "SIGINT");
      const out = await running;
      expect(out.exitCode).toBe(130);
      expect(s.keys().filter((k) => k === DOWN)).toHaveLength(1);
    },
    LONG_TEST_MS,
  );
});
