// #35 harness status。gh は差し替える（本物の gh・ネットワークは使わない）。想定する型：src/commands/status.ts
import { rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runStatus, statusCommand, type StatusDeps } from "../../src/commands/status.js";
import type { RunGh } from "../../src/update/latest.js";
import {
  cleanupRoots,
  editConfig,
  freshProject,
  newRoot,
  snapshot,
  write,
} from "../update/helpers.js";

afterEach(cleanupRoots);

const CHANGELOG = [
  "# 変更履歴",
  "",
  "## 0.3.0",
  "- 三番目の変更",
  "",
  "## 0.2.0",
  "- 二番目の変更",
  "",
  "## 0.1.0",
  "- 最初の変更",
].join("\n");

const ghTag =
  (tag: string): RunGh =>
  async () => ({ code: 0, stdout: JSON.stringify({ tagName: tag }), stderr: "" });

function setup(dir: string, over: Partial<StatusDeps> = {}) {
  const outs: string[] = [];
  const errs: string[] = [];
  const calls: string[][] = [];
  const deps: StatusDeps = {
    cwd: dir,
    stdout: (s) => outs.push(s),
    stderr: (s) => errs.push(s),
    runGh: async (args, timeout) => {
      calls.push(args);
      return ghTag("v0.3.0")(args, timeout);
    },
    repository: () => "testowner/harness",
    changelog: () => CHANGELOG,
    harnessVersion: () => "0.2.0",
    ...over,
  };
  return { deps, out: () => outs.join(""), err: () => errs.join(""), calls };
}

async function project(version: string) {
  const dir = await freshProject();
  editConfig(dir, (doc) => {
    doc["harness_version"] = version;
  });
  return dir;
}

describe("#35 AC-5: harness status", () => {
  it("#35 AC-5: プロジェクトの版・インストール済みの版・最新の版・主な変更点（プロジェクトの版より新しい項目）を表示する", async () => {
    const dir = await project("0.1.0");
    const s = setup(dir);
    const out = await runStatus({}, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    const text = s.out();
    expect(text).toMatch(/プロジェクトのバージョン：0\.1\.0/);
    expect(text).toMatch(/インストール済みのバージョン：0\.2\.0/);
    expect(text).toMatch(/最新のバージョン：0\.3\.0/);
    expect(text).toContain("三番目の変更");
    expect(text).toContain("二番目の変更");
    expect(text).not.toContain("最初の変更");
    expect(s.calls).toEqual([
      ["release", "view", "--repo", "testowner/harness", "--json", "tagName"],
    ]);
  });

  it("#35 AC-5: 最新の版がプロジェクトの版より新しいときは、harness update の案内を出す。同じなら出さない", async () => {
    const newer = setup(await project("0.1.0"));
    await runStatus({}, newer.deps);
    expect(newer.out()).toContain("harness update");
    const same = setup(await project("0.3.0"), { harnessVersion: () => "0.3.0" });
    await runStatus({}, same.deps);
    expect(same.out()).not.toContain("harness update --");
    expect(same.out()).toContain("変更点はありません");
  });

  it("#35 gh が使えない・失敗のときは、「取得できません」と理由を表示し、終了コード0", async () => {
    for (const run of [
      (async () => ({ code: null, stdout: "", stderr: "spawn gh ENOENT" })) as RunGh,
      (async () => ({ code: 1, stdout: "", stderr: "release not found" })) as RunGh,
      (async () => {
        throw new Error("つながりません");
      }) as RunGh,
    ]) {
      const s = setup(await project("0.1.0"), { runGh: run });
      const out = await runStatus({}, s.deps);
      expect(out.exitCode).toBe(0);
      expect(s.out()).toMatch(/最新のバージョン：取得できません/);
      expect(s.out()).toMatch(/プロジェクトのバージョン：0\.1\.0/);
    }
  });

  it("#35 リポジトリが分からないときも、「取得できません」（gh は呼ばない）", async () => {
    const s = setup(await project("0.1.0"), { repository: () => undefined });
    const out = await runStatus({}, s.deps);
    expect(out.exitCode).toBe(0);
    expect(s.out()).toMatch(/最新のバージョン：取得できません/);
    expect(s.calls).toEqual([]);
  });

  it("#35 変更履歴（CHANGELOG.md）が無いときは、「変更履歴がありません」", async () => {
    const s = setup(await project("0.1.0"), { changelog: () => undefined });
    const out = await runStatus({}, s.deps);
    expect(out.exitCode).toBe(0);
    expect(s.out()).toContain("変更履歴がありません");
  });

  it("#35 書き換え済みの管理ファイルの件数（指紋の比較）と、そのパスを表示する。消えているものは別に数える", async () => {
    const dir = await project("0.1.0");
    write(dir, "CLAUDE.md", "# 利用者が書き換えた\n");
    rmSync(path.join(dir, "scripts", "env-check.mjs"));
    const before = snapshot(dir);
    const s = setup(dir);
    await runStatus({}, s.deps);
    expect(s.out()).toMatch(/書き換え済みの管理ファイル：1 件/);
    expect(s.out()).toContain("CLAUDE.md");
    expect(s.out()).toMatch(/消えている管理ファイル：1 件/);
    expect(s.out()).toContain("scripts/env-check.mjs");
    expect(snapshot(dir)).toEqual(before); // 何も書かない
  });

  it("#35 書き換えていなければ 0 件", async () => {
    const s = setup(await project("0.1.0"));
    await runStatus({}, s.deps);
    expect(s.out()).toMatch(/書き換え済みの管理ファイル：0 件/);
  });

  it("#35 config.yaml が無いフォルダでは、ハーネス（CLI）の情報だけを表示する。終了コード0", async () => {
    const root = newRoot();
    const s = setup(root);
    const out = await runStatus({}, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(s.out()).toMatch(/インストール済みのバージョン：0\.2\.0/);
    expect(s.out()).toMatch(/最新のバージョン：0\.3\.0/);
    expect(s.out()).toContain(".harness/config.yaml がありません");
    expect(s.out()).not.toContain("プロジェクトのバージョン");
  });

  it("#35 壊れた config.yaml はエラー（終了コード1）", async () => {
    const dir = await project("0.1.0");
    write(dir, ".harness/config.yaml", "harness_version: [\n");
    const s = setup(dir);
    const out = await runStatus({}, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("config.yaml");
  });

  it("#35 status の入口に --dir がある", () => {
    expect(statusCommand().options.map((o) => o.long)).toContain("--dir");
  });
});

describe("#15 R5: 導入したアプリ（mode: adopt）の状態は、印の中の本文の指紋で比べる", () => {
  const BEGIN = "<!-- harness:begin -->";

  async function adopted() {
    const { cpSync, readFileSync, writeFileSync } = await import("node:fs");
    const { stringify } = await import("yaml");
    const { runAdopt } = await import("../../src/commands/adopt.js");
    const { FakePrompter, baseAnswers } = await import("../questions/helpers.js");
    const { FIXED_NOW } = await import("../versions/helpers.js");
    const { cleanScan } = await import("../adopt/secret-scan-helpers.js");
    const fixture = path.resolve(import.meta.dirname, "..", "fixtures", "adopt-sample");
    const dir = path.join(newRoot(), "sample-app");
    cpSync(fixture, dir, { recursive: true });
    const answers: Record<string, unknown> = { ...baseAnswers() };
    delete answers["app_name"];
    const file = path.join(newRoot(), "answers.yaml");
    writeFileSync(file, stringify(answers));
    const errs: string[] = [];
    const out = await runAdopt(
      { answers: file, yes: true },
      {
        prompter: new FakePrompter(),
        cwd: dir,
        interactive: false,
        stderr: (s) => errs.push(s),
        stdout: () => undefined,
        now: () => FIXED_NOW,
        secretScan: cleanScan,
      },
    );
    if (out.exitCode !== 0) throw new Error(`導入に失敗しました：${errs.join("")}`);
    return { dir, readText: (rel: string) => readFileSync(path.join(dir, rel), "utf8") };
  }

  const modified = (out: string): string =>
    out.slice(
      out.indexOf("書き換え済みの管理ファイル"),
      out.indexOf("書き換え済みの管理ファイル") + 200,
    );

  it("#15 R5: 導入の直後は、書き換え無し", async () => {
    const { dir } = await adopted();
    const s = setup(dir);
    expect((await runStatus({}, s.deps)).exitCode).toBe(0);
    expect(s.out()).toContain("書き換え済みの管理ファイル：0 件");
    expect(s.out()).not.toContain("印が壊れている");
  });

  it("#15 R5: 印の外だけの編集は、書き換えに数えない", async () => {
    const { dir, readText } = await adopted();
    write(dir, "AGENTS.md", `${readText("AGENTS.md")}\n## 利用者が足した節\n\n- 追加の決まり\n`);
    write(dir, "CLAUDE.md", `# 利用者の前書き\n\n${readText("CLAUDE.md")}`);
    const s = setup(dir);
    await runStatus({}, s.deps);
    expect(s.out()).toContain("書き換え済みの管理ファイル：0 件");
  });

  it("#15 R5: 印の中の編集は、書き換えに数える", async () => {
    const { dir, readText } = await adopted();
    write(
      dir,
      "AGENTS.md",
      readText("AGENTS.md").replace(BEGIN, `${BEGIN}\n（利用者が書き足した）`),
    );
    const s = setup(dir);
    await runStatus({}, s.deps);
    expect(s.out()).toContain("書き換え済みの管理ファイル：1 件");
    expect(modified(s.out())).toContain("AGENTS.md");
  });

  it("#15 R5: 印が消えた・壊れたときは、印が壊れていると報告する", async () => {
    const { dir, readText } = await adopted();
    write(dir, "AGENTS.md", readText("AGENTS.md").replace(BEGIN, ""));
    const s = setup(dir);
    expect((await runStatus({}, s.deps)).exitCode).toBe(0);
    expect(s.out()).toContain("印が壊れている管理ファイル：1 件");
    expect(s.out()).toContain("AGENTS.md");
  });

  it("#15 R5: marked_files の無い既存の記録（create）は、これまでどおり全体の指紋で比べる", async () => {
    const dir = await freshProject();
    const s = setup(dir);
    await runStatus({}, s.deps);
    expect(s.out()).toContain("書き換え済みの管理ファイル：0 件");
    write(dir, "CLAUDE.md", "# 書き換えた\n");
    const s2 = setup(dir);
    await runStatus({}, s2.deps);
    expect(s2.out()).toContain("書き換え済みの管理ファイル：1 件");
  });
});
