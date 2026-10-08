// #20 harness adopt：差の一覧(docs/harness-adoption.md)と、新しいブランチ(--issue)。偽の git で確かめる(実際の git は adopt-branch.test.ts)。
// 架空の既存のアプリ(test/fixtures/adopt-sample/)を一時フォルダに写して実行する。実データ・個人名は使わない(架空の値だけ)。
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rename as realRename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { runAdopt as runAdoptReal, type AdoptDeps } from "../../src/commands/adopt.js";
import { fingerprint } from "../../src/generate/config.js";
import { cleanScan } from "../adopt/secret-scan-helpers.js";
import { fakeGit, type FakeGitState } from "../adopt/git-helpers.js";
import { FakePrompter, baseAnswers } from "../questions/helpers.js";
import { FIXED_NOW } from "../versions/helpers.js";
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
const DOC = "docs/harness-adoption.md";
const BRANCH = "chore/12-adopt-harness";
const SETTINGS = ".claude/settings.json";

function sampleApp(): string {
  const dir = path.join(newRoot(), "sample-app");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function answersFile(): string {
  const file = path.join(newRoot(), "answers.yaml");
  const answers: Record<string, unknown> = { ...baseAnswers() };
  delete answers["app_name"];
  writeFileSync(file, stringify(answers));
  return file;
}

function setup(
  dir: string,
  git: ReturnType<typeof fakeGit>,
  script: Record<string, unknown[]> = {},
  over: Partial<AdoptDeps> = {},
) {
  const errs: string[] = [];
  const outs: string[] = [];
  const prompter = new FakePrompter(script);
  const deps: AdoptDeps = {
    prompter,
    cwd: dir,
    interactive: false,
    stderr: (s) => errs.push(s),
    stdout: (s) => outs.push(s),
    now: () => FIXED_NOW,
    secretScan: cleanScan,
    runGit: git.runGit,
    ...over,
  };
  return { deps, prompter, err: () => errs.join(""), out: () => outs.join("") };
}

const read = (dir: string, rel: string): string =>
  readFileSync(path.join(dir, ...rel.split("/")), "utf8");
const has = (dir: string, rel: string): boolean => existsSync(path.join(dir, ...rel.split("/")));

describe("#20 AC-3: 適用すると、差の一覧(docs/harness-adoption.md)ができる", () => {
  it("#20 AC-3: 文書ができ、config.yaml の管理(指紋)には入らない。件数の要約と次の手順を表示する", async () => {
    const dir = sampleApp();
    const s = setup(dir, fakeGit());
    const out = await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    const doc = read(dir, DOC);
    expect(doc).toContain("# ハーネスの導入の差の一覧");
    expect(doc).toContain("| C-05 |");
    expect(doc).toMatch(/\| C-05 \| .* \| 満たしている \|/);
    expect(doc).toMatch(/\| C-61 \| .* \| 一部 \|/); // 既存の CI(ci.yml)と harness-check.yml
    expect(doc).toMatch(/\| C-01 \| .* \| 未確認 \|/);
    expect(readConfig(dir).managed_files[DOC]).toBeUndefined();
    expect(s.out()).toContain(DOC);
    expect(s.out()).toMatch(/未確認：\d+ 件/);
  });

  it("#20 AC-3: 同じ名前の設定を残すと「一部」、置き換えると「満たしている」(最終の選択のあとで判定する)", async () => {
    const mine = '{ "permissions": { "allow": [] } }\n';
    // 残す(--yes)
    const keep = sampleApp();
    write(keep, SETTINGS, mine);
    const k = setup(keep, fakeGit());
    expect(
      (await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, k.deps)).exitCode,
    ).toBe(0);
    expect(read(keep, SETTINGS)).toBe(mine);
    expect(read(keep, DOC)).toMatch(/\| C-68 \| .* \| 一部 \|/);
    // 置き換える(対話)
    const replace = sampleApp();
    write(replace, SETTINGS, mine);
    const r = setup(
      replace,
      fakeGit(),
      { [`adopt_conflict:${SETTINGS}`]: ["replace"], adopt_confirm: [true] },
      { interactive: true },
    );
    expect(
      (await runAdoptReal({ answers: answersFile(), issue: 12 }, r.deps)).exitCode,
      r.err(),
    ).toBe(0);
    expect(read(replace, SETTINGS)).not.toBe(mine);
    expect(read(replace, DOC)).toMatch(/\| C-68 \| .* \| 満たしている \|/);
    // 対話で残す
    const keep2 = sampleApp();
    write(keep2, SETTINGS, mine);
    const k2 = setup(
      keep2,
      fakeGit(),
      { [`adopt_conflict:${SETTINGS}`]: ["keep"], adopt_confirm: [true] },
      { interactive: true },
    );
    expect((await runAdoptReal({ answers: answersFile(), issue: 12 }, k2.deps)).exitCode).toBe(0);
    expect(read(keep2, DOC)).toMatch(/\| C-68 \| .* \| 一部 \|/);
  });

  it("#20 AC-3: 文書がすでにあって中身が違うとき、--yes は既存を残し、対話では選べる", async () => {
    const mine = "# 自分の文書\n";
    const yes = sampleApp();
    write(yes, DOC, mine);
    const y = setup(yes, fakeGit());
    expect(
      (await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, y.deps)).exitCode,
    ).toBe(0);
    expect(read(yes, DOC)).toBe(mine);
    expect(y.out()).toContain(DOC);

    const pick = sampleApp();
    write(pick, DOC, mine);
    const p = setup(
      pick,
      fakeGit(),
      { [`adopt_conflict:${DOC}`]: ["replace"], adopt_confirm: [true] },
      { interactive: true },
    );
    expect(
      (await runAdoptReal({ answers: answersFile(), issue: 12 }, p.deps)).exitCode,
      p.err(),
    ).toBe(0);
    expect(read(pick, DOC)).toContain("# ハーネスの導入の差の一覧");
    expect(p.prompter.notes.join("\n")).toContain("自分の文書");
  });

  it("#20 AC-3: 回答で対象外になる項目は「対象外」、未定のときは対象外にしない", async () => {
    const dir = sampleApp();
    const s = setup(dir, fakeGit());
    // 既定の回答(個人情報なし・認証は外部IdP)では、C-19(アプリ独自認証の試行制限)の条件は無効
    expect(
      (await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, s.deps)).exitCode,
    ).toBe(0);
    expect(read(dir, DOC)).toMatch(/\| C-19 \| .* \| 対象外 \|/);

    const undecided = sampleApp();
    const file = path.join(newRoot(), "answers.yaml");
    const answers: Record<string, unknown> = { ...baseAnswers({ personal_data: "undecided" }) };
    delete answers["app_name"];
    writeFileSync(file, stringify(answers));
    const u = setup(undecided, fakeGit());
    expect((await runAdoptReal({ answers: file, yes: true, issue: 12 }, u.deps)).exitCode).toBe(0);
    expect(read(undecided, DOC)).toMatch(/\| C-19 \| .* \| 未確認 \|/);
  });

  it("#20 AC-3: --dry-run は文書を書かず、件数の要約を表示する(選ぶ前の既定=既存を残す、で作る)", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const git = fakeGit();
    const s = setup(dir, git);
    const out = await runAdoptReal({ answers: answersFile(), dryRun: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(snapshot(dir)).toEqual(before);
    expect(has(dir, DOC)).toBe(false);
    expect(git.calls).toEqual([]);
    expect(s.out()).toContain(DOC);
    expect(s.out()).toMatch(/満たしている：\d+ 件/);
  });
});

describe("#20 AC-4: 新しいブランチ(--issue)", () => {
  it("#20 AC-4: 承認のあと、書く前に git switch -c chore/<番号>-adopt-harness を実行する", async () => {
    const dir = sampleApp();
    let docAtSwitch: boolean | undefined;
    let configAtSwitch: boolean | undefined;
    const git = fakeGit({
      onSwitch: () => {
        docAtSwitch = has(dir, DOC);
        configAtSwitch = has(dir, ".harness/config.yaml");
      },
    });
    const s = setup(dir, git);
    expect(
      (await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, s.deps)).exitCode,
      s.err(),
    ).toBe(0);
    expect(git.calls).toContainEqual(["switch", "-c", BRANCH]);
    expect(docAtSwitch).toBe(false);
    expect(configAtSwitch).toBe(false);
    expect(git.calls.some((c) => ["commit", "push", "add"].includes(c[0] ?? ""))).toBe(false);
    // ロックは終わると消える
    expect(has(dir, ".harness/.update-lock")).toBe(false);
  });

  it("#20 AC-4: 次の手順(add・commit・push と PR の例)と、ブランチの名前を表示する。GitHub なら gh pr create", async () => {
    const dir = sampleApp();
    const s = setup(dir, fakeGit());
    await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
    const out = s.out();
    expect(out).toContain(BRANCH);
    expect(out).toContain("git add");
    expect(out).toContain("git commit");
    expect(out).toContain("git push");
    expect(out).toContain("gh pr create");
    expect(out).toContain("main に直接入れません");
  });

  it("#20 AC-4: GitHub を使わない(local)ときは、gh ではなく取り込みのコマンド(C-83)を案内する", async () => {
    const dir = sampleApp();
    const file = path.join(newRoot(), "answers.yaml");
    const answers: Record<string, unknown> = {
      ...baseAnswers({ repository: "local", visibility: "private", check_location: "local" }),
    };
    delete answers["app_name"];
    writeFileSync(file, stringify(answers));
    const s = setup(dir, fakeGit());
    expect(
      (await runAdoptReal({ answers: file, yes: true, issue: 12 }, s.deps)).exitCode,
      s.err(),
    ).toBe(0);
    expect(s.out()).not.toContain("gh pr create");
    expect(s.out()).toContain("C-83");
  });

  it("#20 AC-4: 開始の表示は、ブランチを作ること・コミット・push・PR をしないことを伝える。main 以外なら、分ける元を表示する", async () => {
    const dir = sampleApp();
    const s = setup(dir, fakeGit({ branch: "feature/x-1" }));
    await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
    const notes = s.prompter.notes.join("\n");
    expect(notes).toContain("コミット・push・PR はしません");
    expect(notes).toContain("chore/<Issue番号>-adopt-harness");
    expect(notes).toContain("feature/x-1");
    expect(notes).toContain(BRANCH);
  });

  it("#20 AC-4: 適用するときに --issue が無ければ、何も書かず、git にも触れずに止まる", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const git = fakeGit();
    const s = setup(dir, git);
    const out = await runAdoptReal({ answers: answersFile(), yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("--issue");
    expect(snapshot(dir)).toEqual(before);
    expect(git.calls).toEqual([]);
  });

  it("#20 AC-4: --issue が正の整数でなければ、止まる(--dry-run でも)", async () => {
    for (const bad of [0, -1, "abc", "1.5", "12abc"]) {
      for (const dryRun of [false, true]) {
        const dir = sampleApp();
        const before = snapshot(dir);
        const git = fakeGit();
        const s = setup(dir, git);
        const out = await runAdoptReal(
          { answers: answersFile(), yes: true, dryRun, issue: bad },
          s.deps,
        );
        expect(out.exitCode, `${String(bad)} dryRun=${String(dryRun)}`).toBe(1);
        expect(s.err()).toContain("--issue");
        expect(snapshot(dir)).toEqual(before);
        expect(git.calls).toEqual([]);
      }
    }
  });

  it("#20 AC-4: --dry-run は --issue が無くてもよく、git に触れない", async () => {
    const dir = sampleApp();
    const git = fakeGit({ inside: false, dirty: " M a\n" });
    const s = setup(dir, git);
    expect(
      (await runAdoptReal({ answers: answersFile(), dryRun: true }, s.deps)).exitCode,
      s.err(),
    ).toBe(0);
    expect(git.calls).toEqual([]);
  });

  it("#20 AC-4: git のフォルダでない・作業ツリーが汚れている・同名のブランチがある→何も書かず、ブランチも作らずに止まる", async () => {
    const cases: FakeGitState[] = [
      { inside: false },
      { dirty: "?? memo.txt\n" },
      { existing: ["main", BRANCH] },
    ];
    for (const state of cases) {
      const dir = sampleApp();
      const before = snapshot(dir);
      const git = fakeGit(state);
      const s = setup(dir, git);
      const out = await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
      expect(out.exitCode, JSON.stringify(state)).toBe(1);
      expect(s.err()).toContain("エラー");
      expect(snapshot(dir)).toEqual(before);
      expect(git.calls.some((c) => c[0] === "switch")).toBe(false);
      expect(has(dir, ".harness")).toBe(false);
    }
  });

  it("#20 AC-4: 今いるブランチがちょうど同じ名前なら、作らずに続ける", async () => {
    const dir = sampleApp();
    const git = fakeGit({ branch: BRANCH, existing: [BRANCH] });
    const s = setup(dir, git);
    expect(
      (await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, s.deps)).exitCode,
      s.err(),
    ).toBe(0);
    expect(git.calls.some((c) => c[0] === "switch")).toBe(false);
    expect(has(dir, DOC)).toBe(true);
  });

  it("#20 AC-4: 確認で「いいえ」なら、ブランチを作らず、何も書かない", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const git = fakeGit();
    const s = setup(dir, git, { adopt_confirm: [false] }, { interactive: true });
    expect((await runAdoptReal({ answers: answersFile(), issue: 12 }, s.deps)).exitCode).toBe(0);
    expect(git.calls.some((c) => c[0] === "switch")).toBe(false);
    expect(snapshot(dir)).toEqual(before);
  });

  it("#20 AC-4: 検査のときは導入用ブランチでも、承認のあとに別のブランチへ移されていたら、何も書かずに止まる", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const git = fakeGit({ branch: BRANCH, existing: [BRANCH] });
    const s = setup(dir, git, { adopt_confirm: [true] }, { interactive: true });
    const confirm = s.prompter.confirm.bind(s.prompter);
    s.prompter.confirm = async (o) => {
      const r = await confirm(o);
      git.setBranch("main");
      return r;
    };
    const out = await runAdoptReal({ answers: answersFile(), issue: 12 }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain(BRANCH);
    expect(snapshot(dir)).toEqual(before);
  });

  it("#20 AC-4: 新しく作ったブランチから、書く直前に離れていたら、何も書かずに止まる", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const git = fakeGit({ onSwitch: () => git.setBranch("main") });
    const s = setup(dir, git);
    const out = await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain(BRANCH);
    expect(snapshot(dir)).toEqual(before);
    expect(has(dir, ".harness")).toBe(false);
  });

  it("#20 AC-4: ブランチを作れなければ、何も書かずに止まる", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const s = setup(dir, fakeGit({ switchCode: 128 }));
    const out = await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(snapshot(dir)).toEqual(before);
    expect(has(dir, ".harness")).toBe(false);
  });

  it("#20 AC-4: 書き込みに失敗したら、元に戻し、ブランチが空で残ることを伝える(ブランチは消さない)", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const git = fakeGit();
    const s = setup(
      dir,
      git,
      {},
      {
        fs: {
          rename: async (from, to) => {
            if (to === path.join(dir, ".harness", "config.yaml")) {
              throw new Error("書き込めません（テスト用の失敗）");
            }
            await realRename(from, to);
          },
        },
      },
    );
    const out = await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain(BRANCH);
    expect(git.calls.some((c) => c[0] === "branch" && c.includes("-D"))).toBe(false);
    expect(snapshot(dir)).toEqual(before);
  });
});

describe("#20 AC-5: 既存の記録", () => {
  it("#20 AC-5: 2回目(config.yaml がある)は止まり、文書を書き換えない", async () => {
    const dir = sampleApp();
    const s = setup(dir, fakeGit());
    expect(
      (await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, s.deps)).exitCode,
    ).toBe(0);
    const doc = read(dir, DOC);
    const again = setup(dir, fakeGit());
    expect(
      (await runAdoptReal({ answers: answersFile(), yes: true, issue: 13 }, again.deps)).exitCode,
    ).toBe(1);
    expect(read(dir, DOC)).toBe(doc);
    expect(fingerprint(doc)).toBe(fingerprint(read(dir, DOC)));
  });
});

describe("#21: 基準線の手順を表示する", () => {
  it("Node のアプリがある：次にすること に npm ci → --init → コミットの手順が出る。adopt は baseline.json を作らない", async () => {
    const dir = sampleApp();
    const s = setup(dir, fakeGit());
    const out = await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(s.out()).toContain("node .harness/scripts/baseline-check.mjs --init");
    expect(s.out()).toContain("npm ci");
    expect(s.out().indexOf("--init")).toBeLessThan(s.out().indexOf("git add -A"));
    expect(has(dir, ".harness/baseline.json")).toBe(false);
    expect(has(dir, ".harness/scripts/baseline-check.mjs")).toBe(true);
  });

  it("Node のアプリがない：基準線の手順は出ず、対象外と表示する。スクリプトも置かない", async () => {
    const dir = sampleApp();
    write(dir, "package.json", "");
    rmSync(path.join(dir, "package.json"));
    write(dir, "requirements.txt", "flask\n");
    const s = setup(dir, fakeGit());
    const out = await runAdoptReal({ answers: answersFile(), yes: true, issue: 12 }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(s.out()).not.toContain("--init");
    expect(has(dir, ".harness/scripts/baseline-check.mjs")).toBe(false);
  });
});
