// #61 AC-2：GitHub を使わないプロジェクトのフック（.githooks/pre-commit）と取り込みのコマンド（scripts/merge-check.mjs）を、
// 実際の git で確かめる。生成したプロジェクトを一時フォルダ（os.tmpdir）に書き、git init してから使う。終わったら一時フォルダを消す。
//   - Prettier・ESLint・gitleaks は、偽の道具（sh のスクリプト。BAD_FORMAT・BAD_LINT・FAKE_SECRET_FOR_TEST を含むと失敗）に置き換える。
//     本物の Prettier・ESLint での確かめは、smoke（npm run smoke:generated の local の通り）で行う
//   - npm run check は、作業ツリーに a.txt と b.txt が両方あると失敗する偽のスクリプト（scripts/fake-check.mjs）にする
//   - git がなければ飛ばす。メールアドレスは架空（test@example.invalid）
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildProject } from "../../src/generate/project.js";
import { writeProject } from "../../src/generate/write.js";
import { projectInput } from "./project-helpers.js";

const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;

const APP = "testapp-001";
const ISSUE_1 = "docs/issues/0001-replace-icons.md";

let baseRoot = "";
let baseProject = "";
const roots: string[] = [];

beforeAll(async () => {
  if (!gitAvailable) return;
  baseRoot = mkdtempSync(path.join(os.tmpdir(), "harness-q61-base-"));
  const input = await projectInput({
    repository: "local",
    visibility: "private",
    check_location: "local",
  });
  await writeProject({ cwd: baseRoot, appName: APP, files: buildProject(input).files });
  baseProject = path.join(baseRoot, APP);
});

afterAll(() => {
  if (baseRoot) rmSync(baseRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

type Result = { status: number | null; stdout: string; stderr: string };

/** gitleaks が PATH にない状態の PATH（本物の gitleaks が入っている PC でも、入っていない場合を確かめるため） */
function pathWithoutGitleaks(): string {
  const dirs = (process.env["PATH"] ?? "").split(path.delimiter);
  return dirs
    .filter((dir) => !["gitleaks", "gitleaks.exe"].some((name) => existsSync(path.join(dir, name))))
    .join(path.delimiter);
}

class Repo {
  readonly dir: string;
  readonly home: string;
  private extraPath = "";

  constructor(dir: string, home: string) {
    this.dir = dir;
    this.home = home;
  }

  /** 本物の npm を使わず、引数と実行時の package.json を記録する */
  useFakeNpm(failInstalls = false): void {
    this.extraPath = path.join(this.home, "fake-bin");
    mkdirSync(this.extraPath, { recursive: true });
    const script = path.join(this.extraPath, "fake-npm.cjs");
    writeFileSync(
      script,
      [
        'const fs = require("node:fs");',
        'const { spawnSync } = require("node:child_process");',
        "const args = process.argv.slice(2);",
        'const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));',
        `fs.appendFileSync(${JSON.stringify(path.join(this.home, "npm-calls.jsonl"))}, JSON.stringify({ args, version: pkg.version }) + "\\n");`,
        'if (args[0] === "run" && args[1] === "check") {',
        '  const result = spawnSync(pkg.scripts.check, { shell: true, stdio: "inherit", windowsHide: true });',
        "  process.exit(result.status ?? 1);",
        "}",
        `process.exit(${failInstalls ? 1 : 0});`,
        "",
      ].join("\n"),
    );
    const file = path.join(this.extraPath, process.platform === "win32" ? "npm.cmd" : "npm");
    writeFileSync(
      file,
      process.platform === "win32"
        ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
    );
    chmodSync(file, 0o755);
  }

  npmCalls(): { args: string[]; version: string }[] {
    return readFileSync(path.join(this.home, "npm-calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line) as { args: string[]; version: string });
  }

  /** gitleaks の偽物を PATH の先頭に置く */
  useFakeGitleaks(modern: boolean): void {
    this.extraPath = path.join(this.home, "fake-bin");
    mkdirSync(this.extraPath, { recursive: true });
    const file = path.join(this.extraPath, "gitleaks");
    writeFileSync(
      file,
      [
        "#!/bin/sh",
        'if [ "$1" = "git" ] && [ "$2" = "--help" ]; then',
        `  echo '${modern ? "Usage: gitleaks git --pre-commit --staged" : "Usage: gitleaks git --log-opts"}'`,
        "  exit 0",
        "fi",
        // 古い版でも git --help は成功する。検査の引数は全体を照合する。
        `[ "$*" = "${modern ? "git --pre-commit --staged" : "protect --staged"} --redact --no-banner" ] || { echo "unexpected gitleaks arguments: $*" >&2; exit 2; }`,
        "if git diff --cached | grep -q FAKE_SECRET_FOR_TEST; then",
        '  echo "fake gitleaks: leak found" >&2',
        "  exit 1",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(file, 0o755);
  }

  private env(cwd: string): NodeJS.ProcessEnv {
    const base = this.extraPath ? process.env["PATH"] : pathWithoutGitleaks();
    return {
      ...process.env,
      PATH: this.extraPath ? `${this.extraPath}${path.delimiter}${base ?? ""}` : (base ?? ""),
      GIT_CONFIG_GLOBAL: path.join(this.home, "empty-gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      PWD: cwd,
    };
  }

  run(command: string, args: string[], cwd = this.dir, shell = false): Result {
    const result = spawnSync(command, args, {
      cwd,
      env: this.env(cwd),
      encoding: "utf8",
      shell,
      windowsHide: true,
    });
    return {
      status: result.status,
      stdout: (result.stdout ?? "").trim(),
      stderr: (result.stderr ?? "").trim(),
    };
  }

  git(args: string[], cwd = this.dir): Result {
    return this.run("git", args, cwd);
  }

  /** 成功を前提にする git */
  mustGit(args: string[], cwd = this.dir): string {
    const r = this.git(args, cwd);
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} に失敗：${r.stderr}${r.stdout}`);
    return r.stdout;
  }

  write(rel: string, content: string, cwd = this.dir): void {
    const file = path.join(cwd, ...rel.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  read(rel: string, cwd = this.dir): string {
    return readFileSync(path.join(cwd, ...rel.split("/")), "utf8");
  }

  commit(message: string, cwd = this.dir): Result {
    this.mustGit(["add", "-A"], cwd);
    return this.git(["commit", "-m", message], cwd);
  }

  head(ref = "HEAD", cwd = this.dir): string {
    return this.mustGit(["rev-parse", ref], cwd);
  }

  branch(cwd = this.dir): string {
    return this.mustGit(["branch", "--show-current"], cwd);
  }

  status(cwd = this.dir): string {
    return this.mustGit(["status", "--porcelain"], cwd);
  }

  /** 取り込みのコマンドの印のファイルが残っていないか */
  markExists(cwd = this.dir): boolean {
    const mark = this.mustGit(["rev-parse", "--git-path", "harness-merge-check"], cwd);
    return existsSync(path.resolve(cwd, mark));
  }

  mergeCheck(args: string[] = [], cwd = this.dir): Result {
    return this.run("node", ["scripts/merge-check.mjs", ...args], cwd);
  }

  /** 作業のブランチ（今のブランチは main でなくなる）を作って、ファイルを1つ足してコミットする */
  newBranch(name: string, files: Record<string, string>, cwd = this.dir): void {
    this.mustGit(["switch", "-c", name], cwd);
    for (const [rel, content] of Object.entries(files)) this.write(rel, content, cwd);
    const r = this.commit(`feat: ${name}`, cwd);
    if (r.status !== 0) throw new Error(`作業のブランチのコミットに失敗：${r.stderr}`);
  }

  /** 取り込み前後の「何も変わっていない」ことの確認（main の HEAD・作業ツリー・今のブランチ・印） */
  expectUntouched(before: { main: string; branch: string }, cwd = this.dir): void {
    expect(this.head("main", cwd)).toBe(before.main);
    expect(this.status(cwd)).toBe("");
    expect(this.branch(cwd)).toBe(before.branch);
    expect(this.markExists(cwd)).toBe(false);
  }
}

/** 偽の Prettier・ESLint を node_modules/.bin に置く（node_modules は .gitignore に入っているので、作業ツリーごとに置く） */
function installFakeTools(dir: string): void {
  const bin = path.join(dir, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  const fakeTool = (name: string, word: string): void => {
    const file = path.join(bin, name);
    writeFileSync(
      file,
      [
        "#!/bin/sh",
        'if [ -f "$(git rev-parse --git-dir)/fail-' + name + '" ]; then',
        '  echo "fake ' + name + ': forced failure" >&2',
        "  exit 1",
        "fi",
        'for arg in "$@"; do',
        '  case "$arg" in',
        "    -*) ;;",
        "    *) if grep -q " + word + ' "$arg" 2>/dev/null; then',
        '         echo "fake ' + name + ": " + word + ' in $arg" >&2',
        "         exit 1",
        "       fi ;;",
        "  esac",
        "done",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(file, 0o755);
  };
  fakeTool("prettier", "BAD_FORMAT");
  fakeTool("eslint", "BAD_LINT");
}

/** 生成したプロジェクトを一時フォルダに写し、偽の道具を置き、git init して最初のコミットをする（README の手順と同じ並び） */
function setupRepo(options: { initialCommit?: boolean; fakeCheck?: string } = {}): Repo {
  const home = mkdtempSync(path.join(os.tmpdir(), "harness-q61-"));
  roots.push(home);
  writeFileSync(path.join(home, "empty-gitconfig"), "");
  const dir = path.join(home, APP);
  cpSync(baseProject, dir, { recursive: true });
  const repo = new Repo(dir, home);

  installFakeTools(dir);

  // 偽の npm run check：a.txt と b.txt が両方あると失敗する
  repo.write(
    "scripts/fake-check.mjs",
    options.fakeCheck ??
      [
        'import { existsSync } from "node:fs";',
        'process.exit(existsSync("a.txt") && existsSync("b.txt") ? 1 : 0);',
        "",
      ].join("\n"),
  );
  const pkgPath = path.join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts: Record<string, string> };
  pkg.scripts["check"] = "node scripts/fake-check.mjs";
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  repo.write("shared.txt", "line\n");
  chmodSync(path.join(dir, ".githooks", "pre-commit"), 0o755);

  // README の手順と同じ並び：git init -b main → hooksPath → 最初のコミット
  repo.mustGit(["init", "-b", "main"]);
  repo.mustGit(["config", "user.email", "test@example.invalid"]);
  repo.mustGit(["config", "user.name", "E2EUser A"]);
  repo.mustGit(["config", "commit.gpgsign", "false"]);
  repo.mustGit(["config", "core.autocrlf", "false"]);
  repo.mustGit(["config", "core.hooksPath", ".githooks"]);
  if (options.initialCommit !== false) {
    const r = repo.commit("chore: 生成した初期状態");
    if (r.status !== 0) throw new Error(`最初のコミットに失敗：${r.stderr}${r.stdout}`);
  }
  return repo;
}

describe.skipIf(!gitAvailable)("#61 AC-2: pre-commit のフック", { timeout: 60_000 }, () => {
  it("#61 AC-2: 最初のコミットは、main の上でも、HEAD がないので通る", () => {
    const repo = setupRepo();
    expect(repo.branch()).toBe("main");
    expect(repo.mustGit(["rev-list", "--count", "HEAD"])).toBe("1");
  });

  it("#61 AC-2: main の上のコミットは止まり、HEAD は変わらない", () => {
    const repo = setupRepo();
    const before = repo.head();
    repo.write("notes.txt", "メモ\n");
    const r = repo.commit("docs: メモ");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("main の上では直接コミットできません");
    expect(repo.head()).toBe(before);
  });

  it("#61 AC-2: feature/1-sample のコミットは通る", () => {
    const repo = setupRepo();
    repo.mustGit(["switch", "-c", "feature/1-sample"]);
    repo.write("notes.txt", "メモ\n");
    const r = repo.commit("feat: メモ");
    expect(r.status).toBe(0);
    expect(repo.mustGit(["log", "-1", "--format=%s"])).toBe("feat: メモ");
  });

  it("#61 AC-2: 整形の違反（偽の Prettier が失敗する）ファイルのコミットは止まる", () => {
    const repo = setupRepo();
    repo.mustGit(["switch", "-c", "feature/1-sample"]);
    const before = repo.head();
    repo.write("bad.md", "BAD_FORMAT\n");
    const r = repo.commit("docs: 整形の違反");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("整形が合っていない");
    expect(repo.head()).toBe(before);
  });

  it("#61 AC-2: Lint の違反（偽の ESLint が失敗する）ファイルのコミットは止まる", () => {
    const repo = setupRepo();
    repo.mustGit(["switch", "-c", "feature/1-sample"]);
    const before = repo.head();
    repo.write("bad.ts", "// BAD_LINT\n");
    const r = repo.commit("feat: Lint の違反");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Lint の違反");
    expect(repo.head()).toBe(before);
  });

  it("#61 AC-2: 整形・Lint の道具がなければ、npm install を案内して止まる", () => {
    const repo = setupRepo();
    rmSync(path.join(repo.dir, "node_modules"), { recursive: true, force: true });
    repo.mustGit(["switch", "-c", "feature/1-sample"]);
    repo.write("note.md", "メモ\n");
    const r = repo.commit("docs: メモ");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("npm install してください");
  });

  it("#61 AC-2: 部分的にステージしたファイルは、検査できないと表示して止まる", () => {
    const repo = setupRepo();
    repo.mustGit(["switch", "-c", "feature/1-sample"]);
    repo.write("part.txt", "1行目\n");
    repo.mustGit(["add", "part.txt"]);
    repo.write("part.txt", "1行目\n2行目\n");
    const r = repo.git(["commit", "-m", "feat: 部分"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("part.txt");
    expect(r.stderr).toContain("作業ファイルとステージの内容が違うため検査できません");
  });

  it.each([true, false])(
    "#61 AC-2: 秘密情報のコミットは止まり、値は表示しない（新しい gitleaks：%s）",
    (modern) => {
      const repo = setupRepo();
      repo.useFakeGitleaks(modern);
      repo.mustGit(["switch", "-c", "feature/1-sample"]);
      const before = repo.head();
      repo.write("secret.txt", "token=FAKE_SECRET_FOR_TEST\n");
      const r = repo.commit("feat: 秘密");
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("秘密情報らしいものが見つかりました");
      expect(r.stderr).not.toContain("FAKE_SECRET_FOR_TEST");
      expect(repo.head()).toBe(before);
      // 秘密情報を含まないコミットは通る
      repo.write("secret.txt", "token=changeme\n");
      expect(repo.commit("feat: 直した").status).toBe(0);
    },
  );

  it("#61 AC-2: gitleaks がないときは、警告を表示して続ける", () => {
    const repo = setupRepo();
    repo.mustGit(["switch", "-c", "feature/1-sample"]);
    repo.write("notes.txt", "メモ\n");
    const r = repo.commit("feat: メモ");
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("警告：gitleaks が入っていない");
  });
});

describe.skipIf(!gitAvailable)(
  "#61 AC-2: 取り込みのコマンド（merge-check）",
  { timeout: 60_000 },
  () => {
    it("依存のファイルが変わらないと、インストールせず check だけを実行する", () => {
      const repo = setupRepo();
      repo.useFakeNpm();
      repo.newBranch("feature/1-sample", { "notes.txt": "メモ\n" });
      const r = repo.mergeCheck();
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(repo.npmCalls().map((call) => call.args)).toEqual([["run", "check"]]);
    });

    it.each(["package.json", "package-lock.json"])(
      "%s が変わると、check の前に依存をインストールする",
      (file) => {
        const repo = setupRepo();
        repo.useFakeNpm();
        const content =
          file === "package.json"
            ? JSON.stringify({ ...JSON.parse(repo.read(file)), version: "1.2.3" }, null, 2) + "\n"
            : '{"lockfileVersion":3}\n';
        repo.newBranch("feature/1-sample", { [file]: content });
        const command = existsSync(path.join(repo.dir, "package-lock.json"))
          ? ["ci"]
          : ["install", "--no-package-lock"];
        repo.mustGit(["switch", "main"]);
        const r = repo.mergeCheck(["feature/1-sample"]);
        expect(r.status, r.stderr + r.stdout).toBe(0);
        expect(repo.npmCalls().map((call) => call.args)).toEqual([command, ["run", "check"]]);
      },
    );

    it("作業ブランチと squash 後の依存定義が同じなら、check が失敗してもインストール・復元しない", () => {
      const repo = setupRepo();
      repo.useFakeNpm();
      repo.newBranch("feature/1-sample", {
        "package.json":
          JSON.stringify({ ...JSON.parse(repo.read("package.json")), version: "1.2.3" }, null, 2) +
          "\n",
        "a.txt": "a\n",
        "b.txt": "b\n",
      });
      const before = { main: repo.head("main"), branch: "feature/1-sample" };
      expect(repo.mergeCheck().status).toBe(1);
      repo.expectUntouched(before);
      expect(repo.npmCalls()).toEqual([{ args: ["run", "check"], version: "1.2.3" }]);
    });

    it.each([false, true])(
      "作業ブランチを作った後に main の依存定義が変わると、check の前に npm ci を実行する（check 失敗：%s）",
      (failCheck) => {
        const repo = setupRepo();
        repo.useFakeNpm();
        repo.newBranch(
          "feature/1-sample",
          failCheck ? { "a.txt": "a\n", "b.txt": "b\n" } : { "notes.txt": "メモ\n" },
        );
        const version = (JSON.parse(repo.read("package.json")) as { version: string }).version;
        repo.mustGit(["switch", "main"]);
        repo.newBranch("chore/2-dependencies", {
          "package.json":
            JSON.stringify(
              { ...JSON.parse(repo.read("package.json")), version: "1.2.3" },
              null,
              2,
            ) + "\n",
          "package-lock.json": '{"lockfileVersion":3}\n',
        });
        repo.mustGit(["switch", "main"]);
        // main の保護フックを迂回せず、コミット済みの変更を fast-forward する。
        repo.mustGit(["merge", "--ff-only", "chore/2-dependencies"]);
        repo.mustGit(["switch", "feature/1-sample"]);
        const before = { main: repo.head("main"), branch: "feature/1-sample" };
        const r = repo.mergeCheck();
        expect(r.status, r.stderr + r.stdout).toBe(failCheck ? 1 : 0);
        expect(repo.npmCalls()).toEqual([
          { args: ["ci"], version: "1.2.3" },
          { args: ["run", "check"], version: "1.2.3" },
          ...(failCheck ? [{ args: ["install", "--no-package-lock"], version }] : []),
        ]);
        if (failCheck) repo.expectUntouched(before);
      },
    );

    it.each([false, true])(
      "依存の更新後に失敗すると、巻き戻して依存を復元する（install 失敗：%s）",
      (failInstalls) => {
        const repo = setupRepo();
        repo.useFakeNpm(failInstalls);
        const version = (JSON.parse(repo.read("package.json")) as { version: string }).version;
        repo.newBranch("feature/1-sample", {
          "package.json":
            JSON.stringify(
              { ...JSON.parse(repo.read("package.json")), version: "1.2.3" },
              null,
              2,
            ) + "\n",
          "a.txt": "a\n",
          "b.txt": "b\n",
        });
        repo.mustGit(["switch", "main"]);
        const before = { main: repo.head(), branch: "main" };
        const command = existsSync(path.join(repo.dir, "package-lock.json"))
          ? ["ci"]
          : ["install", "--no-package-lock"];
        const r = repo.mergeCheck(["feature/1-sample"]);
        expect(r.status).toBe(1);
        repo.expectUntouched(before);
        expect(repo.npmCalls()).toEqual([
          { args: command, version: "1.2.3" },
          ...(failInstalls ? [] : [{ args: ["run", "check"], version: "1.2.3" }]),
          { args: command, version },
        ]);
        if (failInstalls)
          expect(r.stderr).toContain("依存を元に戻せませんでした。npm install を実行してください");
      },
    );

    it("#61 AC-2: check が通ると、main に Squash のコミットが1つ増え、Issue が完了になり、印は残らない。その後 main の手のコミットは止まる", () => {
      const repo = setupRepo();
      const countBefore = Number(repo.mustGit(["rev-list", "--count", "main"]));
      repo.newBranch("feature/1-sample", { "notes.txt": "メモ\n" });
      repo.write("more.txt", "もう1つ\n");
      expect(repo.commit("feat: もう1つ").status).toBe(0); // 作業のブランチのコミットは2つ

      const r = repo.mergeCheck();
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(repo.branch()).toBe("main");
      expect(Number(repo.mustGit(["rev-list", "--count", "main"]))).toBe(countBefore + 1);
      expect(repo.mustGit(["log", "-1", "--format=%s", "main"])).toBe("feat: sample (#1)");
      expect(repo.mustGit(["show", "main:notes.txt"])).toBe("メモ");
      expect(repo.mustGit(["show", "main:more.txt"])).toBe("もう1つ");
      expect(repo.mustGit(["show", `main:${ISSUE_1}`])).toMatch(/^- 状態：完了$/m);
      expect(repo.mustGit(["show", `main:${ISSUE_1}`])).not.toMatch(/^- 状態：未着手$/m);
      expect(repo.status()).toBe("");
      expect(repo.markExists()).toBe(false);

      repo.write("hand.txt", "手のコミット\n");
      const hand = repo.commit("docs: 手のコミット");
      expect(hand.status).not.toBe(0);
      expect(repo.mustGit(["rev-list", "--count", "main"])).toBe(String(countBefore + 1));
    });

    it("#61 AC-2: npm run merge:check（package.json の scripts）でも取り込める", () => {
      const repo = setupRepo();
      repo.newBranch("fix/1-typo", { "notes.txt": "メモ\n" });
      const r = repo.run("npm run merge:check", [], repo.dir, true);
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(repo.mustGit(["log", "-1", "--format=%s", "main"])).toBe("fix: typo (#1)");
    });

    it("#61 AC-2: check が失敗すると、exit 1・main は変わらない・Issue の状態も変わらず、元のブランチに戻る", () => {
      const repo = setupRepo();
      repo.newBranch("feature/1-sample", { "a.txt": "a\n", "b.txt": "b\n" }); // a と b が両方あると偽の check が失敗する
      const before = { main: repo.head("main"), branch: "feature/1-sample" };
      const r = repo.mergeCheck();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("取り込みませんでした");
      repo.expectUntouched(before);
      expect(repo.mustGit(["show", `main:${ISSUE_1}`])).toMatch(/^- 状態：未着手$/m);
    });

    it.each([
      ["SIGINT", 130, false],
      ["SIGTERM", 143, false],
      ["SIGINT", 130, true],
      ["SIGTERM", 143, true],
    ])("#61 AC-2: %s で中断すると巻き戻し、exit %i（親への通知: %s）", (signal, code, parent) => {
      const repo = setupRepo();
      // OS に依存せず、spawnSync が子の中断を報告する場合を再現する。
      const script = repo
        .read("scripts/merge-check.mjs")
        .replace(
          'spawnSync("npm run check", { stdio: "inherit", shell: true, windowsHide: true })',
          parent
            ? `(setImmediate(() => process.emit("${signal}")), { status: 0 })`
            : `{ status: null, signal: "${signal}" }`,
        );
      expect(script).not.toBe(repo.read("scripts/merge-check.mjs"));
      repo.newBranch("feature/1-sample", {
        "notes.txt": "メモ\n",
        "scripts/merge-check.mjs": script,
      });
      const before = { main: repo.head("main"), branch: "feature/1-sample" };
      const r = repo.mergeCheck();
      expect(r.status, r.stderr + r.stdout).toBe(code);
      repo.expectUntouched(before);
      expect(repo.read(ISSUE_1)).toMatch(/^- 状態：未着手$/m);
    });

    it("#61 AC-2: 取り込んだ後の内容（main ＋ 変更）で check する：main 側の変更との組み合わせでだけ失敗する場合も止まる", () => {
      const repo = setupRepo();
      repo.newBranch("feature/1-sample", { "a.txt": "a\n" });
      repo.mustGit(["switch", "main"]);
      repo.newBranch("feature/2-other", {
        "b.txt": "b\n",
        "docs/issues/0002-other.md": "# 2：別の作業\n\n- 番号：2\n- 親：なし\n- 状態：未着手\n",
      });
      expect(repo.mergeCheck().status).toBe(0); // b.txt だけなら通る。main に b.txt が入る
      const before = { main: repo.head("main"), branch: "feature/1-sample" };
      repo.mustGit(["switch", "feature/1-sample"]);
      // feature/1-sample の作業ツリーには a.txt だけ。main に b.txt が入っているので、取り込んだ後の組み合わせは失敗する
      const r = repo.mergeCheck();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("品質チェックが失敗しました");
      repo.expectUntouched(before);
    });

    it("#61 AC-2: squash が競合すると、取り込まずに元のブランチへ戻る", () => {
      const repo = setupRepo();
      repo.newBranch("feature/1-sample", { "shared.txt": "line\n作業1\n" });
      repo.mustGit(["switch", "main"]);
      repo.newBranch("feature/2-other", {
        "shared.txt": "line\n作業2\n",
        "docs/issues/0002-other.md": "# 2：別の作業\n\n- 番号：2\n- 親：なし\n- 状態：未着手\n",
      });
      expect(repo.mergeCheck().status).toBe(0);
      repo.mustGit(["switch", "feature/1-sample"]);
      const before = { main: repo.head("main"), branch: "feature/1-sample" };
      const r = repo.mergeCheck();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("取り込みませんでした");
      repo.expectUntouched(before);
    });

    it("#61 AC-2: 該当する番号の Issue のファイルがないと、状態の更新を飛ばさず、取り込みを中止する", () => {
      const repo = setupRepo();
      repo.newBranch("feature/7-no-issue", { "notes.txt": "メモ\n" });
      const before = { main: repo.head("main"), branch: "feature/7-no-issue" };
      const r = repo.mergeCheck();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("0007-");
      repo.expectUntouched(before);
    });

    it("#61 AC-2: フックがコミットを拒否した場合も、元のブランチに戻り、main・作業ツリー・印は取り込み前のまま", () => {
      const repo = setupRepo();
      repo.newBranch("feature/1-sample", { "notes.txt": "メモ\n" });
      const before = { main: repo.head("main"), branch: "feature/1-sample" };
      // Issue のファイル（.md）がステージされるので、偽の Prettier がコミットのときだけ失敗する
      writeFileSync(path.join(repo.dir, ".git", "fail-prettier"), "");
      const r = repo.mergeCheck();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("整形が合っていない"); // フックが拒否した
      repo.expectUntouched(before);
    });

    it("#61 AC-2: 作業ツリーがきれいでないと、何も変えずに止まる", () => {
      const repo = setupRepo();
      repo.newBranch("feature/1-sample", { "notes.txt": "メモ\n" });
      repo.write("dirty.txt", "未コミット\n");
      const before = { main: repo.head("main"), branch: "feature/1-sample" };
      const r = repo.mergeCheck();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("コミットしていない変更");
      expect(repo.head("main")).toBe(before.main);
      expect(repo.branch()).toBe(before.branch);
    });

    it("#61 AC-2: ブランチ名の形が違う・main の上で引数がない場合は、取り込まない", () => {
      const repo = setupRepo();
      repo.newBranch("work-in-progress", { "notes.txt": "メモ\n" });
      const before = { main: repo.head("main"), branch: "work-in-progress" };
      const wrongName = repo.mergeCheck();
      expect(wrongName.status).toBe(1);
      expect(wrongName.stderr).toContain("<種類>/<番号>-<内容>");
      repo.expectUntouched(before);

      repo.mustGit(["switch", "main"]);
      const onMain = repo.mergeCheck();
      expect(onMain.status).toBe(1);
      expect(onMain.stderr).toContain("ブランチ名を指定してください");
      expect(repo.branch()).toBe("main");
    });

    it("#61 AC-2: README の手順と同じ並び（初回コミット → 作業のブランチ → merge:check）で、取り込める", () => {
      const repo = setupRepo({ initialCommit: false });
      expect(repo.commit("chore: 生成した初期状態").status).toBe(0); // HEAD がないので main でも通る
      expect(repo.mustGit(["switch", "-c", "feature/1-replace-icons"])).toBe("");
      repo.write("public/note.txt", "差し替えのメモ\n");
      expect(repo.commit("feat: アイコンを差し替える").status).toBe(0);
      const r = repo.mergeCheck();
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(repo.mustGit(["log", "-1", "--format=%s", "main"])).toBe("feat: replace icons (#1)");
      expect(repo.mustGit(["show", `main:${ISSUE_1}`])).toMatch(/^- 状態：完了$/m);
    });
  },
);

describe.skipIf(!gitAvailable)(
  "#61 AC-2: 複数の作業ツリー（git worktree）",
  { timeout: 60_000 },
  () => {
    /** 主の作業ツリーと、linked worktree（feature/3-wt の作業のブランチ付き）を作る */
    function setupWorktrees(): { repo: Repo; linked: string } {
      const repo = setupRepo();
      const linked = path.join(repo.home, "linked");
      repo.mustGit(["worktree", "add", linked, "-b", "feature/3-wt"]);
      repo.write(
        "docs/issues/0003-wt.md",
        "# 3：作業ツリー\n\n- 番号：3\n- 親：なし\n- 状態：未着手\n",
        linked,
      );
      repo.write("wt.txt", "作業ツリーのメモ\n", linked);
      installFakeTools(linked);
      const r = repo.commit("feat: 作業ツリー", linked);
      expect(r.status, r.stderr).toBe(0);
      return { repo, linked };
    }

    it("#61 AC-2: main が主の作業ツリーで使われているとき、linked worktree からは、何も変えずに止まる。案内どおり主の作業ツリー（main の上）で指定すると取り込める", () => {
      const { repo, linked } = setupWorktrees();
      const before = { main: repo.head("main"), branch: "feature/3-wt" };
      const r = repo.mergeCheck([], linked);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("main は");
      expect(r.stderr).toContain("で使用中です");
      expect(r.stderr).toContain("npm run merge:check -- feature/3-wt");
      repo.expectUntouched(before, linked);
      expect(repo.branch()).toBe("main"); // 主の作業ツリーも変わっていない

      // 案内どおり、主の作業ツリー（main の上）で、ブランチを指定して実行する
      const ok = repo.mergeCheck(["feature/3-wt"]);
      expect(ok.status, ok.stderr + ok.stdout).toBe(0);
      expect(repo.branch()).toBe("main");
      expect(repo.mustGit(["log", "-1", "--format=%s", "main"])).toBe("feat: wt (#3)");
      expect(repo.mustGit(["show", `main:docs/issues/0003-wt.md`])).toMatch(/^- 状態：完了$/m);
      expect(repo.markExists()).toBe(false);
    });

    it("#61 AC-2: 主の作業ツリーが別のブランチなら、linked worktree から取り込める。印は残らない", () => {
      const { repo, linked } = setupWorktrees();
      repo.mustGit(["switch", "-c", "feature/9-park"]); // 主の作業ツリーを main から外す
      const countBefore = Number(repo.mustGit(["rev-list", "--count", "main"]));
      const r = repo.mergeCheck([], linked);
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(Number(repo.mustGit(["rev-list", "--count", "main"]))).toBe(countBefore + 1);
      expect(repo.branch(linked)).toBe("main");
      expect(repo.markExists(linked)).toBe(false);
      expect(repo.markExists()).toBe(false);
    });

    it("#61 AC-2: main の上から指定して check が失敗した場合、main は変わらず、main のままでいる", () => {
      const repo = setupRepo();
      repo.newBranch("feature/1-sample", { "a.txt": "a\n", "b.txt": "b\n" });
      repo.mustGit(["switch", "main"]);
      const before = { main: repo.head("main"), branch: "main" };
      const r = repo.mergeCheck(["feature/1-sample"]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("品質チェックが失敗しました");
      repo.expectUntouched(before);
    });

    it("#61 AC-2: 指定したブランチが main・存在しない・形が違う場合は、取り込まない", () => {
      const repo = setupRepo();
      const before = { main: repo.head("main"), branch: "main" };
      for (const name of ["main", "feature/5-missing", "wrong-name"]) {
        const r = repo.mergeCheck([name]);
        expect(r.status, name).toBe(1);
        repo.expectUntouched(before);
      }
    });
  },
);
