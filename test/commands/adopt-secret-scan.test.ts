// #17 harness adopt の秘密情報の確認。確認の道具（docker・gitleaks）は差し替える（secretScan・runner）。
// ダミーの値は、実行時に連結して作る。実データ・個人名は使わない（架空の値だけ）。
// 想定する型：src/commands/adopt.ts（AdoptDeps に secretScan・runner、AdoptOptions に skipSecretScan）
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import type { SecretScanResult } from "../../src/adopt/secret-scan.js";
import { runAdopt, type AdoptDeps, type AdoptOptions } from "../../src/commands/adopt.js";
import { CancelledError } from "../../src/questions/prompter.js";
import { FakePrompter, baseAnswers } from "../questions/helpers.js";
import { DUMMY, fakeRunner, ok, reportItem, reportOf } from "../adopt/secret-scan-helpers.js";
import { FIXED_DAY, FIXED_NOW } from "../versions/helpers.js";
import { cleanupRoots, newRoot, readConfig, snapshot, write } from "../update/helpers.js";

afterEach(() => {
  cleanupRoots();
  vi.restoreAllMocks();
});

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "adopt-sample",
);

function sampleApp(): string {
  const dir = path.join(newRoot(), "sample-app");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function answersFile(): string {
  const file = path.join(newRoot(), "answers.yaml");
  const answers: Record<string, unknown> = baseAnswers();
  delete answers["app_name"];
  writeFileSync(file, stringify(answers));
  return file;
}

interface Setup {
  deps: AdoptDeps;
  prompter: FakePrompter;
  errs: string[];
  outs: string[];
  /** 画面に出たものすべて（stderr・stdout・note） */
  everything: () => string;
}

function setup(dir: string, over: Partial<AdoptDeps> = {}): Setup {
  const errs: string[] = [];
  const outs: string[] = [];
  const prompter = new FakePrompter();
  const deps: AdoptDeps = {
    prompter,
    cwd: dir,
    interactive: false,
    stderr: (s) => errs.push(s),
    stdout: (s) => outs.push(s),
    now: () => FIXED_NOW,
    ...over,
  };
  return {
    deps,
    prompter,
    errs,
    outs,
    everything: () => [...errs, ...outs, ...prompter.notes].join("\n"),
  };
}

const leaksResult: SecretScanResult = {
  kind: "leaks",
  scope: "history+worktree",
  history: [{ file: "src/old.ts", line: 7, rule: "generic-api-key", commit: "abc1234" }],
  worktree: [{ file: "notes/new.txt", line: 2, rule: "github-pat" }],
};

const options = (over: Partial<AdoptOptions> = {}): AdoptOptions => ({
  answers: answersFile(),
  yes: true,
  ...over,
});

describe("#17 見つかった：止める", () => {
  it("exit 1。場所・コミット・種類が出て、値はどこにも出ない。何も書かない（.harness も作らない）", async () => {
    const dir = sampleApp();
    // 作業フォルダの中にダミーの値があっても、表示には出ない
    write(dir, "notes/new.txt", `memo ${DUMMY}\n`);
    const before = snapshot(dir);
    const s = setup(dir, { secretScan: () => Promise.resolve(leaksResult) });
    const out = await runAdopt(options(), s.deps);
    expect(out.exitCode).toBe(1);
    const err = s.errs.join("");
    expect(err).toContain("src/old.ts:7（コミット abc1234・種類 generic-api-key）");
    expect(err).toContain("notes/new.txt:2（種類 github-pat）");
    expect(err).toContain("値の取り消し");
    expect(s.everything()).not.toContain(DUMMY);
    expect(s.outs.join("")).toBe("");
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(path.join(dir, ".harness"))).toBe(false);
  });

  it("--dry-run でも確認し、見つかったら止まる。差分の表示に、作業フォルダの値が出ない", async () => {
    const dir = sampleApp();
    // 既存の AGENTS.md の中にもダミーの値がある（差分に出る経路）
    write(dir, "AGENTS.md", `# ルール\n\nメモ ${DUMMY}\n`);
    const before = snapshot(dir);
    const s = setup(dir, { secretScan: () => Promise.resolve(leaksResult) });
    const out = await runAdopt(options({ yes: false, dryRun: true }), s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.everything()).not.toContain(DUMMY);
    expect(s.outs.join("")).toBe("");
    expect(snapshot(dir)).toEqual(before);
  });

  it("確認は、回答・アプリ名の確認の後、ロックを作る前に呼ばれる（回答が無ければ呼ばれない）", async () => {
    const dir = sampleApp();
    const secretScan = vi.fn(() => Promise.resolve(leaksResult));
    const s = setup(dir, { secretScan });
    const out = await runAdopt({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(secretScan).not.toHaveBeenCalled();
  });
});

describe("#17 実行役（runner）の出力・例外に値があっても出ない", () => {
  it("確認の実行が失敗し、出力に値がある：決まった文だけで止まる", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const { runner } = fakeRunner({
      worktree: { exit: 2, over: { stdout: `token ${DUMMY}` } },
    });
    const s = setup(dir, { runner });
    const out = await runAdopt(options(), s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.errs.join("")).toContain("秘密情報の確認を完了できませんでした");
    expect(s.everything()).not.toContain(DUMMY);
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(path.join(dir, ".harness"))).toBe(false);
  });

  it("実行役が値入りの例外を投げても、文に入らない", async () => {
    const dir = sampleApp();
    const runner = (): Promise<never> => Promise.reject(new Error(`boom ${DUMMY}`));
    const s = setup(dir, { runner });
    const out = await runAdopt(options(), s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.everything()).not.toContain(DUMMY);
  });

  it("実行役の経路でも、見つかった値は出ない（レポートに値があっても）", async () => {
    const dir = sampleApp();
    const { runner } = fakeRunner({
      worktree: {
        exit: 1,
        report: reportOf(reportItem({ File: "/src/notes/new.txt", Commit: "" })),
      },
    });
    const s = setup(dir, { runner });
    const out = await runAdopt(options(), s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.errs.join("")).toContain("notes/new.txt:3");
    expect(s.everything()).not.toContain(DUMMY);
  });
});

describe("#17 Docker が無い", () => {
  it("exit 1。--skip-secret-scan の案内が出て、何も書かない", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const s = setup(dir, { secretScan: () => Promise.resolve({ kind: "docker-missing" }) });
    const out = await runAdopt(options(), s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.errs.join("")).toContain("Docker が必要");
    expect(s.errs.join("")).toContain("--skip-secret-scan");
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(path.join(dir, ".harness"))).toBe(false);
  });

  it("実行役の docker info が失敗でも、同じ", async () => {
    const dir = sampleApp();
    const { runner } = fakeRunner({ info: ok({ exitCode: 1 }) });
    const s = setup(dir, { runner });
    const out = await runAdopt(options(), s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.errs.join("")).toContain("Docker が必要");
  });
});

describe("#17 --skip-secret-scan", () => {
  it("確認を呼ばない。開始の表示・レポート・config に「確認していない」を記録する", async () => {
    const dir = sampleApp();
    const secretScan = vi.fn(() => Promise.resolve(leaksResult));
    const s = setup(dir, { secretScan });
    const out = await runAdopt(options({ skipSecretScan: true }), s.deps);
    expect(out.exitCode, s.errs.join("")).toBe(0);
    expect(secretScan).not.toHaveBeenCalled();
    expect(s.prompter.notes.join("\n")).toContain("確認していません");
    expect(s.outs.join("")).toContain("秘密情報の確認");
    expect(s.outs.join("")).toContain("確認していません");
    expect(readConfig(dir)["secret_scan"]).toEqual({ status: "skipped", checked_on: FIXED_DAY });
  });

  it("Docker が無くても進める（--dry-run でも、確認は呼ばれない）", async () => {
    const dir = sampleApp();
    const { runner, calls } = fakeRunner({ info: ok({ failedToStart: true, exitCode: null }) });
    const s = setup(dir, { runner });
    const out = await runAdopt(options({ skipSecretScan: true, yes: false, dryRun: true }), s.deps);
    expect(out.exitCode, s.errs.join("")).toBe(0);
    expect(calls).toEqual([]);
    expect(s.outs.join("")).toContain("確認していません");
  });

  it("確認していないときは、差分の表示に値が出うることを、開始の表示で知らせる", async () => {
    const dir = sampleApp();
    const s = setup(dir);
    await runAdopt(options({ skipSecretScan: true, yes: false, dryRun: true }), s.deps);
    expect(s.prompter.notes.join("\n")).toMatch(/差分.*値|値.*差分/);
  });
});

describe("#17 問題なし：記録する", () => {
  it("git（履歴＋作業フォルダ）：passed・scope・日付を config に残し、確認の範囲を表示する", async () => {
    const dir = sampleApp();
    const s = setup(dir, {
      secretScan: () => Promise.resolve({ kind: "clean", scope: "history+worktree" }),
    });
    const out = await runAdopt(options(), s.deps);
    expect(out.exitCode, s.errs.join("")).toBe(0);
    expect(readConfig(dir)["secret_scan"]).toEqual({
      status: "passed",
      scope: "history+worktree",
      checked_on: FIXED_DAY,
    });
    expect(s.prompter.notes.join("\n")).toContain("履歴");
    expect(s.outs.join("")).toContain("秘密情報の確認");
  });

  it("git でない：作業フォルダのみ、と表示し、scope は worktree", async () => {
    const dir = sampleApp();
    const s = setup(dir, {
      secretScan: () => Promise.resolve({ kind: "clean", scope: "worktree" }),
    });
    const out = await runAdopt(options(), s.deps);
    expect(out.exitCode, s.errs.join("")).toBe(0);
    expect(readConfig(dir)["secret_scan"]).toMatchObject({ status: "passed", scope: "worktree" });
    expect(s.prompter.notes.join("\n")).toContain("作業フォルダのみ");
    expect(s.outs.join("")).toContain("作業フォルダのみ");
  });

  it("--dry-run：確認は通すが、何も書かない", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const secretScan = vi.fn(() =>
      Promise.resolve<SecretScanResult>({ kind: "clean", scope: "worktree" }),
    );
    const s = setup(dir, { secretScan });
    const out = await runAdopt(options({ yes: false, dryRun: true }), s.deps);
    expect(out.exitCode, s.errs.join("")).toBe(0);
    expect(secretScan).toHaveBeenCalledTimes(1);
    expect(snapshot(dir)).toEqual(before);
  });

  it("確認が .gitleaks.toml を使ったと伝えたら、その設定が使われることを表示する", async () => {
    const dir = sampleApp();
    const s = setup(dir, {
      secretScan: () => Promise.resolve({ kind: "clean", scope: "worktree", gitleaksConfig: true }),
    });
    await runAdopt(options({ yes: false, dryRun: true }), s.deps);
    expect(s.prompter.notes.join("\n")).toContain(".gitleaks.toml");
  });

  it("作業フォルダに .gitleaks.toml があっても、確認が使っていなければ表示しない（マウントするのはトップ）", async () => {
    const dir = sampleApp();
    write(dir, ".gitleaks.toml", "# 架空の設定\n");
    const s = setup(dir, {
      secretScan: () =>
        Promise.resolve({ kind: "clean", scope: "worktree", gitleaksConfig: false }),
    });
    await runAdopt(options({ yes: false, dryRun: true }), s.deps);
    expect(s.prompter.notes.join("\n")).not.toContain(".gitleaks.toml");
  });

  it("後始末の失敗の警告が、画面に出る（固定の文。値は出ない）", async () => {
    const dir = sampleApp();
    const { runner } = fakeRunner({
      worktree: { exit: 0, over: { timedOut: true, exitCode: null } },
      rm: ok({ exitCode: 1, stderr: DUMMY }),
    });
    const s = setup(dir, { runner });
    const out = await runAdopt(options(), s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.errs.join("")).toContain("コンテナ");
    expect(s.everything()).not.toContain(DUMMY);
  });
});

describe("#17 読めないファイル・フォルダ", () => {
  it("あり：exit 1。件数の文だけが出る（名前・値は出ない）。何も書かない", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const { runner } = fakeRunner({
      worktree: { exit: 0, report: "[]" },
      readable: ok({ stdout: "2" }),
    });
    const s = setup(dir, { runner });
    const out = await runAdopt(options(), s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.errs.join("")).toContain(
      "読めないファイル・フォルダが 2 件あり、秘密情報を確かめきれません",
    );
    expect(s.errs.join("")).toContain("--skip-secret-scan");
    expect(s.everything()).not.toContain(DUMMY);
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(path.join(dir, ".harness"))).toBe(false);
  });

  it("調べの失敗：決まった文で止まる", async () => {
    const dir = sampleApp();
    const { runner } = fakeRunner({
      worktree: { exit: 0, report: "[]" },
      readable: ok({ exitCode: 2, stdout: DUMMY }),
    });
    const s = setup(dir, { runner });
    const out = await runAdopt(options(), s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.errs.join("")).toContain("読めないファイル・フォルダの調べに失敗しました");
    expect(s.everything()).not.toContain(DUMMY);
  });

  it("--skip-secret-scan なら、調べない", async () => {
    const dir = sampleApp();
    const { runner, calls } = fakeRunner({ readable: ok({ stdout: "5" }) });
    const s = setup(dir, { runner });
    const out = await runAdopt(options({ skipSecretScan: true }), s.deps);
    expect(out.exitCode).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("#17 中断", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "確認の最中の %s：exit 130、何も書かず、.harness もできない。リスナーも戻る",
    async (signal) => {
      const dir = sampleApp();
      const before = snapshot(dir);
      const listeners = [process.listeners("SIGINT"), process.listeners("SIGTERM")];
      const s = setup(dir, {
        secretScan: (_root, abort) => {
          process.emit(signal);
          expect(abort.aborted).toBe(true);
          return Promise.resolve<SecretScanResult>({ kind: "clean", scope: "worktree" });
        },
      });
      const out = await runAdopt(options(), s.deps);
      expect(out.exitCode).toBe(130);
      expect(snapshot(dir)).toEqual(before);
      expect(existsSync(path.join(dir, ".harness"))).toBe(false);
      expect(process.listeners("SIGINT")).toEqual(listeners[0]);
      expect(process.listeners("SIGTERM")).toEqual(listeners[1]);
    },
  );

  it("確認が CancelledError を投げたら、exit 130", async () => {
    const dir = sampleApp();
    const s = setup(dir, { secretScan: () => Promise.reject(new CancelledError()) });
    const out = await runAdopt(options(), s.deps);
    expect(out.exitCode).toBe(130);
    expect(existsSync(path.join(dir, ".harness"))).toBe(false);
  });
});

describe("#17 設定ファイル", () => {
  it("確認の欄は、adopt のときだけ書く（config は読み直せる YAML）", async () => {
    const dir = sampleApp();
    const s = setup(dir, {
      secretScan: () => Promise.resolve({ kind: "clean", scope: "worktree" }),
    });
    await runAdopt(options(), s.deps);
    const text = readFileSync(path.join(dir, ".harness", "config.yaml"), "utf8");
    expect(text).toContain("secret_scan:");
    expect(text).not.toContain(DUMMY);
  });
});
