// #20 harness adopt の新しいブランチを、実際の git で確かめる(偽の git は adopt-report.test.ts)。
// 架空の既存のアプリ(test/fixtures/adopt-sample/)を一時フォルダに写し、git init -b main と最初のコミットをしてから実行する。
// 実際の git を使うテストは、まれに環境の要因で失敗するため、やり直しは2回まで(local-git.test.ts と同じ。#77)。
// git がなければ飛ばす。名前・メールアドレスは架空(example.com)。
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { runAdopt, type AdoptDeps } from "../../src/commands/adopt.js";
import { cleanScan } from "../adopt/secret-scan-helpers.js";
import { FakePrompter, baseAnswers } from "../questions/helpers.js";
import { FIXED_NOW } from "../versions/helpers.js";

const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const GIT_TEST_OPTIONS = { timeout: 60_000, retry: 2 };
const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "adopt-sample",
);
const BRANCH = "chore/12-adopt-harness";
const DOC = "docs/harness-adoption.md";

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
});

function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} が失敗しました：${r.stderr}`);
  return r.stdout.trim();
}

/** 既存のアプリ(架空)を、アプリ名と同じ名前のフォルダに写し、最初のコミットまで作る */
function repoApp(init = true): string {
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "harness-q20-")));
  roots.push(root);
  const dir = path.join(root, "sample-app");
  cpSync(FIXTURE, dir, { recursive: true });
  if (init) {
    git(dir, "init", "-b", "main");
    git(dir, "config", "user.name", "testuser_001");
    git(dir, "config", "user.email", "testuser_001@example.com");
    git(dir, "config", "core.autocrlf", "false");
    git(dir, "add", "-A");
    git(dir, "commit", "-m", "chore: 最初のコミット");
  }
  return dir;
}

function answersFile(): string {
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "harness-q20-ans-")));
  roots.push(root);
  const file = path.join(root, "answers.yaml");
  const answers: Record<string, unknown> = { ...baseAnswers() };
  delete answers["app_name"];
  writeFileSync(file, stringify(answers));
  return file;
}

function setup(dir: string, script: Record<string, unknown[]> = {}, interactive = false) {
  const errs: string[] = [];
  const outs: string[] = [];
  const deps: AdoptDeps = {
    prompter: new FakePrompter(script),
    cwd: dir,
    interactive,
    stderr: (s) => errs.push(s),
    stdout: (s) => outs.push(s),
    now: () => FIXED_NOW,
    secretScan: cleanScan, // runGit は差し替えない(実際の git)
  };
  return { deps, err: () => errs.join(""), out: () => outs.join("") };
}

const has = (dir: string, rel: string): boolean => existsSync(path.join(dir, ...rel.split("/")));

describe.skipIf(!gitAvailable)("#20 AC-4: 実際の git で、新しいブランチに導入する", () => {
  it(
    "#20 AC-4: 適用すると新しいブランチに移り、main は変わらず、コミットは増えず、文書と導入物ができ、ロックは消える",
    GIT_TEST_OPTIONS,
    async () => {
      const dir = repoApp();
      const mainBefore = git(dir, "rev-parse", "main");
      const countBefore = git(dir, "rev-list", "--count", "--all");
      const s = setup(dir);
      const out = await runAdopt({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
      expect(out.exitCode, s.err()).toBe(0);
      expect(git(dir, "branch", "--show-current")).toBe(BRANCH);
      expect(git(dir, "rev-parse", "main")).toBe(mainBefore);
      expect(git(dir, "rev-parse", "HEAD")).toBe(mainBefore);
      expect(git(dir, "rev-list", "--count", "--all")).toBe(countBefore);
      expect(has(dir, DOC)).toBe(true);
      expect(has(dir, ".harness/config.yaml")).toBe(true);
      expect(has(dir, ".harness/.update-lock")).toBe(false);
      // main の木に、導入物は入っていない
      expect(git(dir, "ls-tree", "-r", "--name-only", "main")).not.toContain("harness-adoption");
      expect(git(dir, "status", "--porcelain")).toContain("docs/");
    },
  );

  it("#20 AC-4: --dry-run は、ブランチも作業ツリーも変えない", GIT_TEST_OPTIONS, async () => {
    const dir = repoApp();
    const s = setup(dir);
    const out = await runAdopt({ answers: answersFile(), dryRun: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(git(dir, "branch", "--show-current")).toBe("main");
    expect(git(dir, "branch", "--list")).not.toContain("chore/");
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(has(dir, DOC)).toBe(false);
    expect(has(dir, ".harness")).toBe(false);
  });

  it("#20 AC-4: 確認で取り消すと、ブランチを作らず、何も変えない", GIT_TEST_OPTIONS, async () => {
    const dir = repoApp();
    const s = setup(dir, { adopt_confirm: [false] }, true);
    const out = await runAdopt({ answers: answersFile(), issue: 12 }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(git(dir, "branch", "--show-current")).toBe("main");
    expect(git(dir, "branch", "--list")).not.toContain("chore/");
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  it(
    "#20 AC-4: 別のブランチに同じ名前があれば、止まり、何も書かない",
    GIT_TEST_OPTIONS,
    async () => {
      const dir = repoApp();
      git(dir, "branch", BRANCH);
      const s = setup(dir);
      const out = await runAdopt({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
      expect(out.exitCode).toBe(1);
      expect(s.err()).toContain(BRANCH);
      expect(git(dir, "branch", "--show-current")).toBe("main");
      expect(git(dir, "status", "--porcelain")).toBe("");
      expect(has(dir, DOC)).toBe(false);
    },
  );

  it("#20 AC-4: 作業ツリーが汚れていれば、止まり、何も書かない", GIT_TEST_OPTIONS, async () => {
    const dir = repoApp();
    mkdirSync(path.join(dir, "notes"));
    writeFileSync(path.join(dir, "notes", "memo.txt"), "テスト用のメモ\n");
    const s = setup(dir);
    const out = await runAdopt({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(git(dir, "branch", "--show-current")).toBe("main");
    expect(has(dir, DOC)).toBe(false);
    expect(has(dir, ".harness")).toBe(false);
  });

  it("#20 AC-4: git のフォルダでなければ、止まり、何も書かない", GIT_TEST_OPTIONS, async () => {
    const dir = repoApp(false);
    const s = setup(dir);
    const out = await runAdopt({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("Git");
    expect(has(dir, DOC)).toBe(false);
    expect(has(dir, ".harness")).toBe(false);
  });

  it(
    "#20 AC-4: サブフォルダから実行しても、兄弟フォルダの未コミットの変更を見逃さず、止まる",
    GIT_TEST_OPTIONS,
    async () => {
      const top = repoApp(false);
      // 一時フォルダ全体をリポジトリの根にし、アプリを apps/sample-app に置く
      const repo = path.dirname(top);
      const nested = path.join(repo, "apps");
      mkdirSync(nested);
      const dir = path.join(nested, "sample-app");
      renameSync(top, dir);
      git(repo, "init", "-b", "main");
      git(repo, "config", "user.name", "testuser_001");
      git(repo, "config", "user.email", "testuser_001@example.com");
      git(repo, "config", "core.autocrlf", "false");
      git(repo, "add", "-A");
      git(repo, "commit", "-m", "chore: 最初のコミット");
      mkdirSync(path.join(repo, "other"));
      writeFileSync(path.join(repo, "other", "memo.txt"), "テスト用のメモ\n");
      const s = setup(dir);
      const out = await runAdopt({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
      expect(out.exitCode).toBe(1);
      expect(git(repo, "branch", "--show-current")).toBe("main");
      expect(has(dir, DOC)).toBe(false);
      expect(has(dir, ".harness")).toBe(false);
    },
  );

  it(
    "#20 R2: status.showUntrackedFiles=no の設定でも、未追跡のファイルがあれば止まる",
    GIT_TEST_OPTIONS,
    async () => {
      const dir = repoApp(true);
      git(dir, "config", "status.showUntrackedFiles", "no");
      writeFileSync(path.join(dir, "memo.txt"), "テスト用のメモ\n");
      const s = setup(dir);
      const out = await runAdopt({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
      expect(out.exitCode).toBe(1);
      expect(git(dir, "branch", "--show-current")).toBe("main");
      expect(has(dir, DOC)).toBe(false);
      expect(has(dir, ".harness")).toBe(false);
    },
  );

  it(
    "#20 AC-4: main 以外のブランチにいても、今の HEAD から分けて続ける",
    GIT_TEST_OPTIONS,
    async () => {
      const dir = repoApp();
      git(dir, "switch", "-c", "feature/x-1");
      const head = git(dir, "rev-parse", "HEAD");
      const s = setup(dir);
      const out = await runAdopt({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
      expect(out.exitCode, s.err()).toBe(0);
      expect(git(dir, "branch", "--show-current")).toBe(BRANCH);
      expect(git(dir, "rev-parse", "HEAD")).toBe(head);
      expect(readFileSync(path.join(dir, DOC), "utf8")).toContain("# ハーネスの導入の差の一覧");
    },
  );
});
