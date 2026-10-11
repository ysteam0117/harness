// #35 harness status。gh は差し替える（本物の gh・ネットワークは使わない）。想定する型：src/commands/status.ts
import { rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { fakeFetch, offlineFetch } from "../versions/helpers.js";

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
    fetch: offlineFetch().fn,
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
    const { runAdopt } = await import("../adopt/git-helpers.js");
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

// #6 PR-C（AC-5）：採用した技術の新しい大きな版と、範囲を緩められる候補。偽の fetch・架空の値だけを使う
describe("#6 AC-5: harness status の登録情報の節", () => {
  const POOL = "@cloudflare/vitest-pool-workers";

  async function withVersions(entries: { name: string; version: string }[]) {
    const dir = await project("0.1.0");
    editConfig(dir, (doc) => {
      doc.versions = entries.map((e) => ({ ...e, reason: "テスト用" }));
    });
    return dir;
  }

  async function adoptProject(
    profiles: unknown,
    versions: { name: string; version: string }[] = [],
  ) {
    const dir = await project("0.1.0");
    editConfig(dir, (doc) => {
      const d = doc as unknown as Record<string, unknown>;
      d["mode"] = "adopt";
      if (profiles !== undefined) d["profiles"] = profiles;
      doc.versions = versions.map((e) => ({ ...e, reason: "テスト用" }));
    });
    return dir;
  }

  const registry = (over: Parameters<typeof fakeFetch>[0] = {}) =>
    fakeFetch({
      npm: {
        vitest: ["4.1.11", "4.2.0", "5.0.2", "6.0.0-beta.1"],
        [POOL]: ["0.9.0"],
      },
      npmFallback: () => ["1.0.0"],
      peers: { [POOL]: { "0.9.0": { vitest: "^4 || ^5" } } },
      node: [
        { version: "v25.1.0", lts: false },
        { version: "v24.19.0", lts: "Krypton" },
      ],
      ...over,
    });

  it("#6 AC-5: 採用した版より大きな版が新しいものを「採用 → 最新」で表示する。試験版は無視し、stderr に待ち時間の案内を出す", async () => {
    const dir = await withVersions([{ name: "vitest", version: "4.1.11" }]);
    const s = setup(dir, { fetch: registry().fn });
    const out = await runStatus({}, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(s.out()).toContain("採用した技術の新しい大きな版：");
    expect(s.out()).toContain("- vitest：採用 4.1.11 → 最新 5.0.2");
    expect(s.out()).not.toContain("6.0.0-beta.1");
    expect(s.err()).toContain("登録情報（npm・Node.js）を確かめています");
  });

  it("#6 AC-5: 同じ大きな版の新しい版だけなら「ありません」", async () => {
    const dir = await withVersions([{ name: "vitest", version: "4.1.11" }]);
    const f = registry({ npm: { vitest: ["4.1.11", "4.2.0"], [POOL]: ["0.9.0"] } });
    const s = setup(dir, { fetch: f.fn });
    await runStatus({}, s.deps);
    expect(s.out()).toContain("採用した技術の新しい大きな版：ありません");
  });

  it("#6 AC-5: Node.js は nodejs.org の index（LTS）で比べ、npm に node を問い合わせない", async () => {
    const dir = await withVersions([{ name: "node", version: "22.20.0" }]);
    const f = registry({
      node: [
        { version: "v25.1.0", lts: false },
        { version: "v24.19.0", lts: "Krypton" },
        { version: "v22.20.0", lts: "Jod" },
      ],
    });
    const s = setup(dir, { fetch: f.fn });
    await runStatus({}, s.deps);
    expect(s.out()).toContain("- node：採用 22.20.0 → 最新 24.19.0");
    expect(f.npmNames()).not.toContain("node");
  });

  it("#6 AC-5: 一方が HTTP 500・Error・応答なしでも、固定の理由で「取得できません」と表示し、他は表示し、終了コード0", async () => {
    for (const bad of [500, new Error("接続の本文 /secret/path")]) {
      const dir = await withVersions([
        { name: "vitest", version: "4.1.11" },
        { name: "fake-lib", version: "1.0.0" },
      ]);
      const f = registry({
        npm: { vitest: ["4.1.11", "5.0.2"], "fake-lib": bad, [POOL]: ["0.9.0"] },
      });
      const s = setup(dir, { fetch: f.fn });
      const out = await runStatus({}, s.deps);
      expect(out.exitCode).toBe(0);
      expect(s.out()).toContain("- vitest：採用 4.1.11 → 最新 5.0.2");
      expect(s.out()).toMatch(/取得できません（fake-lib：(HTTP 500|接続できません)）/);
      expect(s.out()).not.toContain("secret");
    }
  });

  it("#6 AC-5: 応答がないものは「時間切れ」にして、他は表示し、終了コード0", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const dir = await withVersions([
        { name: "vitest", version: "4.1.11" },
        { name: "fake-lib", version: "1.0.0" },
      ]);
      const f = registry({
        npm: { vitest: ["4.1.11", "5.0.2"], "fake-lib": "hang", [POOL]: ["0.9.0"] },
      });
      const s = setup(dir, { fetch: f.fn });
      let finished = false;
      const running = runStatus({}, s.deps).finally(() => {
        finished = true;
      });
      // 取得の準備（ファイルの読み込み）が済んで時間切れの計時が始まるまで、時計を進め続ける
      for (let i = 0; i < 2000 && !finished; i++) await vi.advanceTimersByTimeAsync(1000);
      expect((await running).exitCode).toBe(0);
      expect(s.out()).toContain("- vitest：採用 4.1.11 → 最新 5.0.2");
      expect(s.out()).toContain("取得できません（fake-lib：時間切れ）");
    } finally {
      vi.useRealTimers();
    }
  });

  it("#6 AC-5: 記録された版が semver でなければ飛ばす。versions が空なら「記録がありません」", async () => {
    const odd = setup(await withVersions([{ name: "vitest", version: "latest-build" }]), {
      fetch: registry().fn,
    });
    await runStatus({}, odd.deps);
    expect(odd.out()).toContain("取得できません（vitest：版の形ではありません）");
    const none = setup(await withVersions([]), { fetch: registry().fn });
    await runStatus({}, none.deps);
    expect(none.out()).toContain("調べる版の記録がありません");
  });

  it("#6 AC-5: 範囲を緩められる候補（範囲・候補・原因）を表示する", async () => {
    const s = setup(await withVersions([]), { fetch: registry().fn });
    const out = await runStatus({}, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    const text = s.out();
    expect(text).toContain("ハーネスの使える範囲を緩められる候補：");
    expect(text).toContain(
      `- vitest：範囲 ^4 → 候補 5.0.2（${POOL} 0.9.0 が対応。まだ試していません）`,
    );
    // 新しい節は、管理ファイルの節の後、更新の案内の前
    expect(text.indexOf("書き換え済みの管理ファイル")).toBeLessThan(
      text.indexOf("採用した技術の新しい大きな版"),
    );
    expect(text.indexOf("ハーネスの使える範囲を緩められる候補")).toBeLessThan(
      text.indexOf("新しいバージョンがあります"),
    );
  });

  it("#6 AC-5: 原因が対応していなければ「ありません」", async () => {
    const s = setup(await withVersions([]), {
      fetch: registry({ peers: { [POOL]: { "0.9.0": { vitest: "^4" } } } }).fn,
    });
    await runStatus({}, s.deps);
    expect(s.out()).toContain("ハーネスの使える範囲を緩められる候補：ありません");
  });

  it("#6 AC-5: 取得の失敗の理由に、例外の本文（message・cause）のパス・秘密らしい文字列を出さない", async () => {
    const leak = new Error("token=SECRET-AAA /home/someone/app", {
      cause: new Error("/home/someone/SECRET-BBB"),
    });
    const dir = await withVersions([{ name: "vitest", version: "4.1.11" }]);
    const f = registry({ npm: { vitest: leak, [POOL]: leak }, npmFallback: () => undefined });
    const s = setup(dir, { fetch: f.fn });
    const out = await runStatus({}, s.deps);
    expect(out.exitCode).toBe(0);
    expect(s.out()).toContain("取得できません（vitest：接続できません）");
    for (const word of ["SECRET", "someone", "token="]) {
      expect(s.out()).not.toContain(word);
      expect(s.err()).not.toContain(word);
    }
  });

  it("#6 AC-5: 全部つながらなくても終了コード0。既存の行は変わらない", async () => {
    const dir = await withVersions([{ name: "vitest", version: "4.1.11" }]);
    const s = setup(dir, { fetch: offlineFetch().fn });
    const out = await runStatus({}, s.deps);
    expect(out.exitCode).toBe(0);
    expect(s.out()).toMatch(/プロジェクトのバージョン：0\.1\.0/);
    expect(s.out()).toMatch(/最新のバージョン：0\.3\.0/);
    expect(s.out()).toContain("採用した技術の新しい大きな版：取得できません（vitest：HTTP 404）");
    expect(s.out()).toContain("ハーネスの使える範囲を緩められる候補：取得できません（");
  });

  it("#6 AC-5: config.yaml が無いフォルダでは、fetch を呼ばず、新しい節も出さない", async () => {
    const f = registry();
    const s = setup(newRoot(), { fetch: f.fn });
    await runStatus({}, s.deps);
    expect(f.calls).toEqual([]);
    expect(s.out()).not.toContain("新しい大きな版");
    expect(s.out()).not.toContain("緩められる候補");
    expect(s.err()).toBe("");
  });

  it("#6 AC-5: 同時の取得は 6 以下", async () => {
    const names = Array.from({ length: 12 }, (_, i) => `fake-lib-${String(i)}`);
    const dir = await adoptProject(
      { applied: [], none: [] },
      names.map((name) => ({ name, version: "1.0.0" })),
    );
    const f = registry({ delayMs: 5, npmFallback: () => ["1.0.0", "2.0.0"] });
    const s = setup(dir, { fetch: f.fn });
    await runStatus({}, s.deps);
    expect(s.out()).toContain("fake-lib-11：採用 1.0.0 → 最新 2.0.0");
    expect(f.maxInFlight).toBeGreaterThan(1);
    expect(f.maxInFlight).toBeLessThanOrEqual(6);
  });

  it("#6 AC-5: create の版と範囲を並行して調べても、同時の取得は合計 6 以下", async () => {
    const names = Array.from({ length: 12 }, (_, i) => `fake-lib-${String(i)}`);
    const dir = await withVersions([
      { name: "node", version: "22.20.0" },
      ...names.map((name) => ({ name, version: "1.0.0" })),
    ]);
    const f = registry({ delayMs: 20, npmFallback: () => ["1.0.0", "2.0.0"] });
    const s = setup(dir, { fetch: f.fn });
    expect((await runStatus({}, s.deps)).exitCode, s.err()).toBe(0);
    expect(s.out()).toContain("fake-lib-11：採用 1.0.0 → 最新 2.0.0");
    expect(s.out()).toContain("- node：採用 22.20.0 → 最新 24.19.0");
    expect(s.out()).toContain("- vitest：範囲 ^4 → 候補 5.0.2");
    expect(f.npmNames()).toContain(POOL);
    expect(f.maxInFlight).toBeGreaterThan(1);
    expect(f.maxInFlight).toBeLessThanOrEqual(6);
  });

  it("#6 AC-5: adopt は、記録された applied のプロファイルで判定する。versions は空なので「記録がありません」", async () => {
    const dir = await adoptProject({
      applied: [{ profile: "test-framework/vitest-playwright", apps: ["."] }],
      none: [],
    });
    const s = setup(dir, { fetch: registry().fn });
    const out = await runStatus({}, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(s.out()).toContain("harness adopt では版を記録しません");
    expect(s.out()).toContain("- vitest：範囲 ^4 → 候補 5.0.2");
  });

  it("#6 AC-5: adopt でプロファイルの記録が無ければ「取得できません（導入のときのプロファイルの記録がありません）」", async () => {
    const s = setup(await adoptProject(undefined), { fetch: registry().fn });
    const out = await runStatus({}, s.deps);
    expect(out.exitCode).toBe(0);
    expect(s.out()).toContain("取得できません（導入のときのプロファイルの記録がありません）");
  });

  it("#6 AC-5: adopt で記録のプロファイルが全部・一部読めないときは、範囲の制限なしとは言わない", async () => {
    for (const applied of [
      [{ profile: "lib/nothing", apps: ["."] }],
      [
        { profile: "test-framework/vitest-playwright", apps: ["."] },
        { profile: "lib/nothing", apps: ["."] },
      ],
    ]) {
      const s = setup(await adoptProject({ applied, none: [] }), { fetch: registry().fn });
      const out = await runStatus({}, s.deps);
      expect(out.exitCode).toBe(0);
      expect(s.out()).toContain("取得できません（記録されたプロファイルの一部を読めませんでした）");
      expect(s.out()).not.toContain("範囲の制限はありません");
    }
  });

  it("#6 AC-5: adopt で範囲を持つ対象が無ければ「範囲の制限はありません」", async () => {
    const dir = await adoptProject({
      applied: [{ profile: "http-client/axios", apps: ["."] }],
      none: [],
    });
    const s = setup(dir, { fetch: registry().fn });
    await runStatus({}, s.deps);
    expect(s.out()).toContain("範囲の制限はありません");
  });
});
