// #18 PR-B：harness adopt が、当てたプロファイルの Skill と harness-check.yml を導入する。
// 架空のアプリ（test/fixtures/adopt-*/）を一時フォルダに写して実行する。本物のネットワーク・gh・Docker は使わない。
// 秘密らしいダミーの値は、実行時に連結して作る。
import { cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import type { AdoptDeps } from "../../src/commands/adopt.js";
import { runAdopt } from "../adopt/git-helpers.js";
import { runUpdate } from "../../src/commands/update.js";
import { realUpdateFs } from "../../src/update/fs.js";
import { gitleaksImage } from "../../src/adopt/secret-scan.js";
import { dummySecret } from "../adopt/detect-helpers.js";
import { cleanScan } from "../adopt/secret-scan-helpers.js";
import { FakePrompter, baseAnswers } from "../questions/helpers.js";
import { FIXED_NOW } from "../versions/helpers.js";
import {
  cleanupRoots,
  exists,
  newRoot,
  read,
  readConfig,
  snapshot,
  updateSetup,
  write,
} from "../update/helpers.js";

afterEach(() => {
  cleanupRoots();
  vi.restoreAllMocks();
});

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const CHECK = ".github/workflows/harness-check.yml";

function app(fixture: string): string {
  const dir = path.join(newRoot(), "sample-app");
  cpSync(path.join(FIXTURES, fixture), dir, { recursive: true });
  return dir;
}

function answersFile(over: Record<string, unknown> = {}): string {
  const file = path.join(newRoot(), "answers.yaml");
  const answers: Record<string, unknown> = { ...baseAnswers(over) };
  delete answers["app_name"];
  writeFileSync(file, stringify(answers));
  return file;
}

function setup(dir: string, over: Partial<AdoptDeps> = {}) {
  const errs: string[] = [];
  const outs: string[] = [];
  const deps: AdoptDeps = {
    prompter: new FakePrompter({}),
    cwd: dir,
    interactive: false,
    stderr: (s) => errs.push(s),
    stdout: (s) => outs.push(s),
    now: () => FIXED_NOW,
    secretScan: cleanScan,
    fs: { readFile: (p) => realUpdateFs.readFile(p) },
    ...over,
  };
  return { deps, err: () => errs.join(""), out: () => outs.join("") };
}

async function adopt(dir: string, over: Record<string, unknown> = {}, yes = true) {
  const s = setup(dir);
  const out = await runAdopt({ answers: answersFile(over), yes }, s.deps);
  expect(out.exitCode, s.err()).toBe(0);
  return s;
}

/** Skill のフォルダの名前（.claude/skills の直下） */
const skillDirs = (dir: string): string[] =>
  readdirSync(path.join(dir, ".claude", "skills")).sort();

const COMMON = [
  "backend",
  "env-deploy",
  "error-api",
  "frontend",
  "implementation-process",
  "knowledge",
  "review",
  "security",
  "testing",
];
const SIX = [
  "backend-hono",
  "data-access-drizzle",
  "frontend-build",
  "logger",
  "quality-tools",
  "test-tools",
];

describe("#18-B adopt：TypeScript（Hono・React）に、当てた6つのプロファイルの Skill を入れる", () => {
  it("Skill が両 AI のフォルダに入り、プロファイルの files・設定は入らない。既存のファイルはバイト単位で変わらない", async () => {
    const dir = app("adopt-hono-react");
    const before = snapshot(dir);
    const s = await adopt(dir, { ais: ["claude", "codex"] });
    expect(skillDirs(dir)).toEqual([...COMMON, ...SIX].sort());
    for (const name of SIX) expect(exists(dir, `.agents/skills/${name}/SKILL.md`), name).toBe(true);
    // 入れないもの：コード・設定
    for (const p of [
      "backend/src/lib/app-error.ts",
      "backend/src/rules-examples/controller.test.ts",
      "tsconfig.json",
      "eslint.config.mjs",
      ".prettierrc",
      "scripts/security-check.mjs",
      ".gitleaks.toml",
    ]) {
      expect(exists(dir, p), p).toBe(false);
    }
    // 既存のファイル：.eslintrc.json・ci.yml・package.json・.env.example はバイト単位で同じ
    const after = snapshot(dir);
    for (const [rel, hash] of before) expect(after.get(rel), rel).toBe(hash);
    // 増えたのは、AI 向けのファイル・harness-check.yml・.harness だけ
    const added = [...after.keys()].filter((rel) => !before.has(rel));
    const allowed = (rel: string): boolean =>
      rel === "AGENTS.md" ||
      rel === "CLAUDE.md" ||
      rel === CHECK ||
      rel === "docs/harness-adoption.md" ||
      rel.startsWith(".claude/") ||
      rel.startsWith(".agents/") ||
      rel.startsWith(".codex/") ||
      rel.startsWith(".harness/");
    expect(added.filter((rel) => !allowed(rel))).toEqual([]);
    expect(s.out()).not.toContain("当てる予定");
    expect(s.out()).toContain("当てたプロファイル");
  });

  it("AGENTS.md の必読の表に行があり、表の Skill はすべて出力にある。どのフォルダに当たるかが書かれる", async () => {
    const dir = app("adopt-hono-react");
    await adopt(dir);
    const agents = read(dir, "AGENTS.md");
    expect(agents).toContain("`backend-hono`（`backend/` のみ）");
    expect(agents).toContain("`frontend-build`（`frontend/` のみ）");
    const start = agents.indexOf("## コードを書く前に、ルールを読んで従う（必須）");
    const end = agents.indexOf("## 実装の進め方");
    const named = new Set<string>();
    for (const row of agents.slice(start, end).split("\n")) {
      if (!row.startsWith("| ") || row.startsWith("| ---")) continue;
      for (const m of (row.split("|")[2] ?? "").matchAll(/`([a-z0-9_-]+)`/g)) {
        named.add(m[1] as string);
      }
    }
    for (const name of SIX) expect(named, name).toContain(name);
    for (const name of named)
      expect(exists(dir, `.claude/skills/${name}/SKILL.md`), name).toBe(true);
  });

  it("config の managed_files に、Skill と harness-check.yml が入る。プロファイルの記録は変わらない", async () => {
    const dir = app("adopt-hono-react");
    await adopt(dir);
    const config = readConfig(dir);
    for (const name of SIX) {
      expect(config.managed_files[`.claude/skills/${name}/SKILL.md`], name).toBeDefined();
    }
    expect(config.managed_files[CHECK]).toBeDefined();
    expect((config["profiles"] as { applied: unknown[] }).applied.length, "applied の記録").toBe(6);
  });

  it("harness-check.yml：固定の gitleaks のイメージ・--network none・--redact・npm audit の job がある", async () => {
    const dir = app("adopt-hono-react");
    await adopt(dir);
    const text = read(dir, CHECK);
    expect(text).toContain(gitleaksImage());
    expect(text).toContain("--network none");
    expect(text).toContain("--redact");
    expect(text).toContain("2>/dev/null");
    const jobs = Object.keys((parse(text) as { jobs: object }).jobs);
    expect(jobs).toEqual(["secret-scan", "npm-audit", "baseline"]);
    expect(text).toContain("npm audit --omit=dev --audit-level=high");
  });

  it("npm audit は、記録したアプリのフォルダだけ。対象外のフォルダに package-lock.json があっても、確かめない", async () => {
    const dir = app("adopt-hono-react");
    write(dir, "tools/package-lock.json", "{}");
    write(dir, "backend/package-lock.json", "{}");
    await adopt(dir);
    const wf = parse(read(dir, CHECK)) as {
      jobs: Record<string, { strategy: { matrix: { dir: string[] } } }>;
    };
    expect(wf.jobs["npm-audit"]?.strategy.matrix.dir).toEqual([".", "backend", "frontend"]);
    expect(read(dir, CHECK)).not.toContain("tools");
  });

  it("日本語・括弧・スペースのフォルダは npm audit の対象になる。対象にできないフォルダは、理由つきで表示する（adopt・update）", async () => {
    const dir = app("adopt-hono-react");
    for (const name of ["顧客(legacy) 管理", "a${{ x }}"]) {
      write(
        dir,
        `apps/${name}/package.json`,
        JSON.stringify({ name: "sample-extra", private: true }),
      );
    }
    const s = await adopt(dir);
    const wf = parse(read(dir, CHECK)) as {
      jobs: Record<string, { strategy: { matrix: { dir: string[] } } }>;
    };
    expect(wf.jobs["npm-audit"]?.strategy.matrix.dir).toContain("apps/顧客(legacy) 管理");
    expect(read(dir, CHECK)).not.toContain("a${{ x }}");
    expect(s.out()).toContain("npm audit の対象にできないフォルダ：apps/a${{ x }}（");
    expect(s.out()).toContain("GitHub Actions の式");
    // update でも、同じく表示する
    const u = updateSetup(dir);
    expect((await runUpdate({ yes: true }, u.deps)).exitCode, u.err()).toBe(0);
    expect(u.err() + u.out()).toContain("npm audit の対象にできないフォルダ：apps/a${{ x }}（");
  });

  it("--dry-run：何も書かない。harness-check.yml の追加と、当てたプロファイルを表示する", async () => {
    const dir = app("adopt-hono-react");
    write(dir, ".env", `DATABASE_URL=${dummySecret()}\n`);
    const before = snapshot(dir);
    const s = setup(dir);
    const out = await runAdopt({ answers: answersFile(), dryRun: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(s.out()).toContain(CHECK);
    expect(s.out()).toContain("当てたプロファイル");
    expect(s.out()).toContain("backend-framework/hono");
    expect(s.out()).not.toContain(dummySecret());
    expect(snapshot(dir)).toEqual(before);
  });
});

describe("#18-B adopt：プロファイルのないアプリ・一部だけのアプリ", () => {
  it("Python：プロファイルの Skill は入らず、harness-check.yml は秘密情報の確認だけ", async () => {
    const dir = app("adopt-django");
    await adopt(dir);
    expect(skillDirs(dir)).toEqual([...COMMON].sort());
    const text = read(dir, CHECK);
    expect(Object.keys((parse(text) as { jobs: object }).jobs)).toEqual(["secret-scan"]);
    expect(text).not.toContain("npm audit");
    expect(read(dir, "AGENTS.md")).toContain("該当する技術のSkillはない");
  });

  it("Hono のバックエンド＋Vue のフロント：hono の Skill だけ入り、対象のフォルダが書かれる", async () => {
    const dir = app("adopt-mixed");
    await adopt(dir);
    expect(skillDirs(dir)).toEqual([...COMMON, "backend-hono", "logger"].sort());
    expect(read(dir, "AGENTS.md")).toContain("`backend-hono`（`backend/` のみ）");
    expect(Object.keys((parse(read(dir, CHECK)) as { jobs: object }).jobs)).toEqual([
      "secret-scan",
      "npm-audit",
      "baseline",
    ]);
  });
});

describe("#18-B adopt：harness-check.yml を出さない・既にある", () => {
  it("repository: local：出さない（managed にも入らない）", async () => {
    const dir = app("adopt-hono-react");
    await adopt(dir, { repository: "local", check_location: "local" });
    expect(exists(dir, CHECK)).toBe(false);
    expect(readConfig(dir).managed_files[CHECK]).toBeUndefined();
  });

  it("check_location: local：出さない", async () => {
    const dir = app("adopt-hono-react");
    await adopt(dir, { check_location: "local" });
    expect(exists(dir, CHECK)).toBe(false);
  });

  it("既に harness-check.yml がある（中身が違う）：--yes では既存を残し、管理に入れない。報告に出る", async () => {
    const dir = app("adopt-hono-react");
    write(dir, CHECK, "name: 利用者の確認\non: [push]\njobs: {}\n");
    const s = await adopt(dir);
    expect(read(dir, CHECK)).toBe("name: 利用者の確認\non: [push]\njobs: {}\n");
    expect(readConfig(dir).managed_files[CHECK]).toBeUndefined();
    expect(s.out()).toContain("残した");
    expect(s.out()).toContain(CHECK);
  });

  it("既に harness-check.yml がある（中身が違う）：対話で、差分を見せて選ばせる", async () => {
    const dir = app("adopt-hono-react");
    write(dir, CHECK, "name: 利用者の確認\non: [push]\njobs: {}\n");
    const prompter = new FakePrompter({
      [`adopt_conflict:${CHECK}`]: ["replace"],
      adopt_confirm: [true],
    });
    const s = setup(dir, { prompter, interactive: true });
    const out = await runAdopt({ answers: answersFile() }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(prompter.askedIds).toContain(`adopt_conflict:${CHECK}`);
    expect(read(dir, CHECK)).toContain("secret-scan");
    expect(readConfig(dir).managed_files[CHECK]).toBeDefined();
  });
});

describe("#18-B update：記録した applied で組み直す（判定し直さない）", () => {
  it("adopt の後に依存を変えても、update は記録した applied で組み直す", async () => {
    const dir = app("adopt-hono-react");
    await adopt(dir);
    const skills = skillDirs(dir);
    const before = snapshot(dir, (rel) => rel.startsWith(".claude/skills/"));
    // 依存を変える（hono を消す）。判定し直すなら、hono の Skill が消えるはず
    write(dir, "backend/package.json", JSON.stringify({ name: "sample-backend", private: true }));
    const u = updateSetup(dir);
    expect((await runUpdate({ yes: true }, u.deps)).exitCode, u.err()).toBe(0);
    expect(skillDirs(dir)).toEqual(skills);
    expect(snapshot(dir, (rel) => rel.startsWith(".claude/skills/"))).toEqual(before);
    expect((readConfig(dir)["profiles"] as { applied: unknown[] }).applied.length).toBe(6);
  });

  it("テンプレートのプロファイルの Skill を変えると、update で Skill が更新される", async () => {
    const dir = app("adopt-hono-react");
    await adopt(dir);
    const skill = ".claude/skills/backend-hono/SKILL.md";
    // 古いハーネスが書いた状態にする（記録の指紋も合わせる）
    const old = "# 古い Skill（テスト）\n";
    write(dir, skill, old);
    const { fingerprint } = await import("../../src/generate/config.js");
    const config = readConfig(dir);
    config.managed_files[skill] = fingerprint(old);
    write(dir, ".harness/config.yaml", stringify(config, { lineWidth: 0 }));
    const u = updateSetup(dir);
    expect((await runUpdate({ yes: true }, u.deps)).exitCode, u.err()).toBe(0);
    expect(read(dir, skill)).not.toBe(old);
    expect(read(dir, skill)).toContain("Hono");
  });

  it("記録に、今のハーネスに無いプロファイルがある：止めずに報告して飛ばす。連鎖して除いたものも報告する", async () => {
    const dir = app("adopt-hono-react");
    await adopt(dir);
    const config = readConfig(dir);
    const profiles = config["profiles"] as { applied: { profile: string; apps: string[] }[] };
    // logger が無くなった状態にする（hono は logger を requires している）
    profiles.applied = profiles.applied.map((a) =>
      a.profile === "logger/structured-logger"
        ? { profile: "logger/removed-in-future", apps: a.apps }
        : a,
    );
    write(dir, ".harness/config.yaml", stringify(config, { lineWidth: 0 }));
    const u = updateSetup(dir);
    const out = await runUpdate({ yes: true }, u.deps);
    expect(out.exitCode, u.err()).toBe(0);
    const report = u.err() + u.out();
    expect(report).toContain("logger/removed-in-future");
    expect(report).toContain("backend-framework/hono");
    // 残りのプロファイルの Skill は更新（維持）される
    expect(exists(dir, ".claude/skills/frontend-build/SKILL.md")).toBe(true);
    expect(exists(dir, ".claude/skills/quality-tools/SKILL.md")).toBe(true);
  });

  it("記録の無い古い config（profiles が無い）：プロファイルの Skill は入れず、成功する", async () => {
    const dir = app("adopt-hono-react");
    await adopt(dir);
    const config = readConfig(dir);
    delete config["profiles"];
    delete config["detected_stack"];
    write(dir, ".harness/config.yaml", stringify(config, { lineWidth: 0 }));
    const u = updateSetup(dir);
    expect((await runUpdate({ yes: true }, u.deps)).exitCode, u.err()).toBe(0);
  });

  it("update の dry-run：何も書かない", async () => {
    const dir = app("adopt-hono-react");
    await adopt(dir);
    const before = snapshot(dir);
    const u = updateSetup(dir);
    expect((await runUpdate({ dryRun: true }, u.deps)).exitCode, u.err()).toBe(0);
    expect(snapshot(dir)).toEqual(before);
  });

  it("harness-check.yml の npm audit の job は、記録した技術の判定（Node のアプリ）で決まる", async () => {
    const dir = app("adopt-django");
    await adopt(dir);
    const u = updateSetup(dir);
    expect((await runUpdate({ yes: true }, u.deps)).exitCode, u.err()).toBe(0);
    expect(read(dir, CHECK)).not.toContain("npm audit");
    const hr = app("adopt-hono-react");
    await adopt(hr);
    const u2 = updateSetup(hr);
    expect((await runUpdate({ yes: true }, u2.deps)).exitCode, u2.err()).toBe(0);
    expect(read(hr, CHECK)).toContain("npm audit");
  });
});

describe("#18-B 値が出る経路を作らない", () => {
  it("導入の出力・ファイル・config にダミーの値が出ない（.env に置いた値）", async () => {
    const dir = app("adopt-hono-react");
    write(dir, ".env", `API_TOKEN=${dummySecret()}\n`);
    write(dir, ".env.local", `DATABASE_URL=${dummySecret()}\n`);
    const s = await adopt(dir);
    expect(s.out() + s.err()).not.toContain(dummySecret());
    for (const rel of [CHECK, ".harness/config.yaml", "AGENTS.md"]) {
      expect(readFileSync(path.join(dir, rel), "utf8"), rel).not.toContain(dummySecret());
    }
  });
});
