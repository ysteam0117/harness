// #17 smoke：実際の Docker の gitleaks で、harness adopt の秘密情報の確認を通す。
// Docker が使えなければ飛ばす（SMOKE_REQUIRE_DOCKER=1 のときは失敗にする）。
// 一時の Git リポジトリに、架空の値（gitleaks の標準のルールに当たる形。実行時に連結して作る）を置く。
// 実データ・個人名は使わない（架空の値だけ）。値が出力・ファイルのどこにも出ないことも確かめる。
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { decideDockerStep } from "../../scripts/smoke-generated.js";
import { linuxDockerAvailable } from "./docker-helpers.js";
import { scanSecrets } from "../../src/adopt/secret-scan.js";
import type { AdoptDeps } from "../../src/commands/adopt.js";
import { runAdopt } from "../adopt/git-helpers.js";
import { FakePrompter, baseAnswers } from "../questions/helpers.js";
import { FIXED_NOW } from "../versions/helpers.js";
import { readConfig, snapshot } from "../update/helpers.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "adopt-sample",
);

const run = decideDockerStep(linuxDockerAvailable(), process.env) === "run";

/** GitHub のトークンの形の架空の値（連結して作る。ソースに直接書かない） */
const fakeToken = (tail: string): string => ["gh", "p_", tail].join("");
const TAIL_HISTORY = ["aB3dE5gH7j", "K9mN1pQ3sT", "5vW7yZ9bC1", "dE3fG5"].join("");
const TAIL_UNTRACKED = ["Zy8xW6vU4t", "S2rQ0pO8nM", "6lK4jI2hG0", "fE8dC6"].join("");

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots)
    rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
});

function newApp(): string {
  const base = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "harness-smoke-scan-")));
  roots.push(base);
  const dir = path.join(base, "sample-app");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function git(dir: string, ...args: string[]): void {
  const r = spawnSync(
    "git",
    ["-c", "user.name=testuser_001", "-c", "user.email=testuser_001@example.com", ...args],
    { cwd: dir, stdio: "ignore", windowsHide: true },
  );
  if (r.status !== 0) throw new Error(`git ${args[0] ?? ""} に失敗しました`);
}

function initRepo(dir: string): void {
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
}

async function adoptIn(dir: string) {
  const answers: Record<string, unknown> = baseAnswers();
  delete answers["app_name"];
  const file = path.join(path.dirname(dir), "answers.yaml");
  writeFileSync(file, stringify(answers));
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
  };
  const out = await runAdopt({ answers: file, yes: true }, deps);
  return { out, all: [...errs, ...outs, ...prompter.notes].join("\n"), err: errs.join("") };
}

describe.skipIf(!run)("#17 smoke：実際の gitleaks で秘密情報を確認する", () => {
  it("履歴だけにある値：exit 1。場所とコミットが出て、値が出ない。何も書かない", async () => {
    const dir = newApp();
    writeFileSync(path.join(dir, "settings.txt"), `token=${fakeToken(TAIL_HISTORY)}\n`);
    initRepo(dir);
    writeFileSync(path.join(dir, "settings.txt"), "token=\n");
    git(dir, "commit", "-q", "-am", "remove");
    const before = snapshot(dir);
    const { out, all, err } = await adoptIn(dir);
    expect(out.exitCode, err).toBe(1);
    expect(err).toMatch(/settings\.txt:1（コミット [0-9a-f]{7}）/);
    expect(all).not.toContain(TAIL_HISTORY);
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(path.join(dir, ".harness"))).toBe(false);
  }, 180_000);

  it("未追跡のファイルだけにある値：exit 1。値が出ない", async () => {
    const dir = newApp();
    initRepo(dir);
    writeFileSync(path.join(dir, "memo.txt"), `x=${fakeToken(TAIL_UNTRACKED)}\n`);
    const { out, all, err } = await adoptIn(dir);
    expect(out.exitCode, err).toBe(1);
    expect(err).toContain("memo.txt:1");
    expect(all).not.toContain(TAIL_UNTRACKED);
    expect(existsSync(path.join(dir, ".harness"))).toBe(false);
  }, 180_000);

  it("問題のない Git のリポジトリ：導入でき、config に履歴＋作業フォルダの確認を記録する", async () => {
    const dir = newApp();
    initRepo(dir);
    const { out, err } = await adoptIn(dir);
    expect(out.exitCode, err).toBe(0);
    expect(readConfig(dir)["secret_scan"]).toMatchObject({
      status: "passed",
      scope: "history+worktree",
    });
  }, 180_000);

  it("Git でないフォルダ：作業フォルダだけを調べ、値があれば止まる", async () => {
    const dir = newApp();
    writeFileSync(path.join(dir, "memo.txt"), `x=${fakeToken(TAIL_UNTRACKED)}\n`);
    const { out, all, err } = await adoptIn(dir);
    expect(out.exitCode, err).toBe(1);
    expect(err).toContain("memo.txt:1");
    expect(all).not.toContain(TAIL_UNTRACKED);
  }, 180_000);
});

describe.skipIf(!run)(
  "#17 R1 smoke：コミットメッセージにも値があるとき、レポートに値が残らない",
  () => {
    it("削除の前の一時レポートに、許可した4項目だけがあり、値が無い", async () => {
      const dir = newApp();
      writeFileSync(path.join(dir, "settings.txt"), `token=${fakeToken(TAIL_HISTORY)}\n`);
      git(dir, "init", "-q");
      git(dir, "add", "-A");
      // コミットメッセージにも値を入れる（--redact は Message を伏せない）
      git(dir, "commit", "-q", "-m", `add ${fakeToken(TAIL_UNTRACKED)}`);
      let report = "";
      let files: string[] = [];
      const result = await scanSecrets(dir, {
        removeDir: async (tmpDir) => {
          report = readFileSync(path.join(tmpDir, "report.json"), "utf8");
          files = readdirSync(tmpDir);
          rmSync(tmpDir, { recursive: true, force: true });
        },
      });
      expect(result.kind).toBe("leaks");
      expect(report).not.toContain(TAIL_HISTORY);
      expect(report).not.toContain(TAIL_UNTRACKED);
      const parsed = JSON.parse(report) as Record<string, unknown>[];
      expect(parsed.length).toBeGreaterThan(0);
      for (const item of parsed) {
        expect(Object.keys(item).sort()).toEqual(["Commit", "File", "StartLine"]);
      }
      // 一時フォルダに残るのは、テンプレートと最後の実行のレポートだけ（どちらにも値が無い）
      expect(files.sort()).toEqual(["report.json", "report.tmpl"]);
      expect(JSON.stringify(result)).not.toContain(TAIL_HISTORY);
      expect(JSON.stringify(result)).not.toContain(TAIL_UNTRACKED);
    }, 180_000);
  },
);
