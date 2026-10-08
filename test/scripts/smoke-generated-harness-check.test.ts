// #18 PR-B smoke：生成した harness-check.yml の「秘密情報の確認」の run を、実際の Docker の gitleaks で動かす。
// Linux コンテナを動かせる Docker（と bash）があるときだけ動かす（SMOKE_REQUIRE_DOCKER=1 のときは、Docker が無ければ失敗にする）。
// 一時の Git リポジトリに、架空の値（gitleaks の標準のルールに当たる形。実行時に連結して作る）を置く。
// 実データ・個人名は使わない（架空の値だけ）。出力に値が出ないことも確かめる。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildHarnessCheck } from "../../src/adopt/ci.js";
import { findTemplatesDir } from "../../src/generate/templates-dir.js";
import { decideDockerStep } from "../../scripts/smoke-generated.js";
import { linuxDockerAvailable } from "./docker-helpers.js";

/** bash の場所。Windows では Git for Windows の bash（WSL の bash は使わない） */
function findBash(): string | undefined {
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Git\\bin\\bash.exe",
          "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
          path.join(process.env["LOCALAPPDATA"] ?? "", "Programs", "Git", "bin", "bash.exe"),
        ]
      : ["/bin/bash", "/usr/bin/bash"];
  return candidates.find((c) => c !== "" && existsSync(c));
}

const bash = findBash();
/** ワークフローの run が使う jq（GitHub の ubuntu ランナーにある） */
const hasJq = spawnSync("jq", ["--version"], { windowsHide: true }).status === 0;
const run =
  decideDockerStep(linuxDockerAvailable(), process.env) === "run" && bash !== undefined && hasJq;

/** GitHub のトークンの形の架空の値（連結して作る。ソースに直接書かない） */
const fakeToken = (tail: string): string => ["gh", "p_", tail].join("");
const TAIL_A = ["aB3dE5gH7j", "K9mN1pQ3sT", "5vW7yZ9bC1", "dE3fG5"].join("");
const TAIL_B = ["Zy8xW6vU4t", "S2rQ0pO8nM", "6lK4jI2hG0", "fE8dC6"].join("");

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});

const slash = (p: string): string => p.replace(/\\/g, "/");

function newRepo(files: Record<string, string>): { base: string; repo: string; temp: string } {
  const base = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "harness-smoke-check-")));
  roots.push(base);
  const repo = path.join(base, "repo");
  const temp = path.join(base, "runner-temp");
  mkdirSync(repo);
  mkdirSync(temp);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(repo, name), text);
  const git = (...args: string[]): void => {
    const r = spawnSync(
      "git",
      ["-c", "user.name=testuser_001", "-c", "user.email=testuser_001@example.com", ...args],
      { cwd: repo, stdio: "ignore", windowsHide: true },
    );
    if (r.status !== 0) throw new Error(`git ${args[0] ?? ""} に失敗しました`);
  };
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return { base, repo, temp };
}

/** 生成した harness-check.yml の「秘密情報の確認」の run を、bash で動かす（GitHub のランナーと同じ環境変数） */
function runStep(repo: string, temp: string): { code: number | null; output: string } {
  const text = buildHarnessCheck({ templatesDir: findTemplatesDir(), nodeDirs: [] });
  const wf = parse(text) as {
    jobs: Record<
      string,
      { steps: { name?: string; run?: string; env?: Record<string, string> }[] }
    >;
  };
  const step = wf.jobs["secret-scan"]?.steps.find((s) => s.name === "秘密情報の確認");
  if (step?.run === undefined) throw new Error("秘密情報の確認の段がありません");
  const script = path.join(temp, "step.sh");
  writeFileSync(script, step.run);
  const r = spawnSync(bash ?? "bash", ["-e", slash(script)], {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      ...step.env,
      GITHUB_WORKSPACE: slash(repo),
      RUNNER_TEMP: slash(temp),
      // Windows の Git Bash が、docker の引数のパスを変換しない
      MSYS_NO_PATHCONV: "1",
      MSYS2_ARG_CONV_EXCL: "*",
    },
  });
  return { code: r.status, output: `${r.stdout}\n${r.stderr}` };
}

describe.skipIf(!run)("#18-B smoke：生成した harness-check.yml の秘密情報の確認を実行する", () => {
  it("問題のないリポジトリ：終了コード 0。決まった文だけが出る", () => {
    const { repo, temp } = newRepo({ "README.md": "# 架空のアプリ\n" });
    const r = runStep(repo, temp);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("秘密情報は見つかりませんでした");
  }, 180_000);

  it("履歴にある値：終了コード 1。場所とルールが出て、値が出ない", () => {
    const { repo, temp } = newRepo({ "settings.txt": `token=${fakeToken(TAIL_A)}\n` });
    const r = runStep(repo, temp);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("秘密情報らしいものが見つかりました");
    expect(r.output).toContain("settings.txt");
    expect(r.output).not.toContain(TAIL_A);
    expect(r.output).not.toContain(fakeToken(TAIL_A));
  }, 180_000);

  it("設定の誤り・不正な .gitleaksignore の行（ダミーの値を含む）：終了コード 1。標準エラーを出さず、値が出ない", () => {
    const { repo, temp } = newRepo({
      "README.md": "# 架空のアプリ\n",
      // TOML として誤り。gitleaks の標準エラーに、行が出うる
      ".gitleaks.toml": `[extend\nuseDefault = true\nsecret = "${fakeToken(TAIL_B)}"\n`,
      ".gitleaksignore": `${fakeToken(TAIL_B)}:::not-a-fingerprint\n`,
    });
    const r = runStep(repo, temp);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("秘密情報の確認を完了できませんでした");
    expect(r.output).not.toContain(TAIL_B);
    expect(r.output).not.toContain(fakeToken(TAIL_B));
  }, 180_000);

  it("独自ルールの id に値を入れても（id に使える文字だけ・64文字以下でも）、値も種類も出ない", () => {
    const q3 = "'".repeat(3);
    const rule = (id: string, marker: string): string =>
      `[[rules]]\nid = "${id}"\ndescription = "架空のルール"\nregex = ${q3}${marker}_[a-z]{6}${q3}\n`;
    const { repo, temp } = newRepo({
      ".gitleaks.toml": `[extend]\nuseDefault = false\n\n${rule(fakeToken(TAIL_A), "zzmarkera")}\n${rule(`${fakeToken(TAIL_B)}=/x`, "zzmarkerb")}`,
      "a.txt": "zzmarkera_abcdef\n",
      "b.txt": "zzmarkerb_abcdef\n",
    });
    const r = runStep(repo, temp);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('"a.txt":1');
    expect(r.output).toContain('"b.txt":1');
    expect(r.output).not.toContain("種類");
    expect(r.output).not.toContain(TAIL_A);
    expect(r.output).not.toContain(TAIL_B);
  }, 180_000);
});
