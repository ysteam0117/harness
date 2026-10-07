// #15 harness adopt。架空の既存のアプリ（test/fixtures/adopt-sample/）を一時フォルダに写して実行する。
// 本物のネットワーク・gh は使わない。実データ・個人名は使わない（架空の値だけ）。
// 想定する型：src/commands/adopt.ts（AdoptDeps・AdoptOptions・runAdopt）
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rename as realRename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { BEGIN, END } from "../../src/adopt/markers.js";
import { runAdopt, type AdoptDeps } from "../../src/commands/adopt.js";
import { fingerprint } from "../../src/generate/config.js";
import { CancelledError } from "../../src/questions/prompter.js";
import { FakePrompter, baseAnswers } from "../questions/helpers.js";
import { FIXED_DAY, FIXED_NOW } from "../versions/helpers.js";
import { cleanupRoots, newRoot, readConfig, sha, snapshot, write } from "../update/helpers.js";

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
const BOM = String.fromCharCode(0xfeff);
const EXISTING_AGENTS = readFileSync(path.join(FIXTURE, "AGENTS.md"), "utf8");

/** 既存のアプリ（架空）を、アプリ名と同じ名前のフォルダに写す */
function sampleApp(folder = "sample-app"): string {
  const dir = path.join(newRoot(), folder);
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

/** --answers のファイル（app_name は書かない。フォルダの名前から決まる） */
function answersFile(over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const file = path.join(newRoot(), "answers.yaml");
  const answers: Record<string, unknown> = { ...baseAnswers(over), ...extra };
  if (!("app_name" in over)) delete answers["app_name"];
  writeFileSync(file, stringify(answers));
  return file;
}

interface Setup {
  deps: AdoptDeps;
  prompter: FakePrompter;
  errs: string[];
  outs: string[];
  err: () => string;
  out: () => string;
}

function setup(
  dir: string,
  script: Record<string, unknown[]> = {},
  over: Partial<AdoptDeps> = {},
  prompter: FakePrompter = new FakePrompter(script),
): Setup {
  const errs: string[] = [];
  const outs: string[] = [];
  const deps: AdoptDeps = {
    prompter,
    cwd: dir,
    interactive: false,
    stderr: (s) => errs.push(s),
    stdout: (s) => outs.push(s),
    now: () => FIXED_NOW,
    ...over,
  };
  return { deps, prompter, errs, outs, err: () => errs.join(""), out: () => outs.join("") };
}

const read = (dir: string, rel: string): string =>
  readFileSync(path.join(dir, ...rel.split("/")), "utf8");
const rawHash = (dir: string, rel: string): string =>
  sha(readFileSync(path.join(dir, ...rel.split("/"))));

/** 印の中の本文（LF） */
function blockBody(text: string): string {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  return text
    .slice(start + BEGIN.length, end)
    .replace(/\r\n/g, "\n")
    .replace(/^\n/, "")
    .replace(/\n$/, "");
}

const count = (text: string, word: string): number => text.split(word).length - 1;

const GUARDED = [".eslintrc.json", ".github/workflows/ci.yml", "package.json"];

describe("#15 AC-1: 既存のアプリに、AI 向けのルールを印で囲んで追加する", () => {
  it("#15 AC-1: AGENTS.md は印の外が1文字も変わらず、eslint・ci.yml・package.json は変わらない。新しいファイルが足される", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const hashes = GUARDED.map((p) => rawHash(dir, p));
    const s = setup(dir);
    const out = await runAdopt({ answers: answersFile(), yes: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);

    const agents = read(dir, "AGENTS.md");
    expect(count(agents, BEGIN)).toBe(1);
    expect(count(agents, END)).toBe(1);
    expect(agents.startsWith(EXISTING_AGENTS)).toBe(true);
    expect(agents.slice(0, agents.indexOf(BEGIN)).trimEnd()).toBe(EXISTING_AGENTS.trimEnd());
    expect(GUARDED.map((p) => rawHash(dir, p))).toEqual(hashes);

    const claude = read(dir, "CLAUDE.md");
    expect(claude.startsWith(BEGIN)).toBe(true);
    expect(claude.endsWith(`${END}\n`)).toBe(true);

    // 変わったのは、AGENTS.md と、新しく足したファイルと、.harness だけ
    const after = snapshot(dir);
    for (const [rel, hash] of before) {
      if (rel === "AGENTS.md") continue;
      expect(after.get(rel), rel).toBe(hash);
    }
    const added = [...after.keys()].filter((rel) => !before.has(rel));
    expect(added).toContain("CLAUDE.md");
    expect(added).toContain(".claude/skills/testing/SKILL.md");
    expect(added).toContain(".claude/agents/planner.md");
    expect(added).toContain(".claude/settings.json");
    expect(added).toContain(".harness/config.yaml");
    expect(
      added.every(
        (rel) =>
          rel === "CLAUDE.md" ||
          rel.startsWith(".claude/") ||
          rel === ".harness/config.yaml" ||
          rel === ".harness/baseline.json",
      ),
    ).toBe(true);
    // 技術プロファイルの Skill は入らない
    expect(added.some((rel) => rel.includes("backend-hono"))).toBe(false);
    expect(existsSync(path.join(dir, ".harness", ".update-lock"))).toBe(false);
    expect(readdirSync(path.join(dir, ".harness"))).toEqual(["config.yaml"]);
  });

  it("#15 AC-1: config.yaml に mode: adopt・marked_files・印の中の本文の指紋が記録される", async () => {
    const dir = sampleApp();
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode, s.err()).toBe(
      0,
    );
    const config = readConfig(dir);
    expect(config["mode"]).toBe("adopt");
    expect(config["generated_on"]).toBe(FIXED_DAY);
    expect(config["marked_files"]).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect((config.answers as Record<string, unknown>)["app_name"]).toBe("sample-app");
    expect(config.managed_files["AGENTS.md"]).toBe(fingerprint(blockBody(read(dir, "AGENTS.md"))));
    expect(config.managed_files["CLAUDE.md"]).toBe(fingerprint(blockBody(read(dir, "CLAUDE.md"))));
    expect(config.managed_files[".claude/skills/testing/SKILL.md"]).toBe(
      fingerprint(read(dir, ".claude/skills/testing/SKILL.md")),
    );
    // 既存のファイルや、導入していないものは、管理に入れない
    for (const p of [".eslintrc.json", "package.json", ".github/workflows/ci.yml"]) {
      expect(config.managed_files[p], p).toBeUndefined();
    }
    expect(Object.keys(config.managed_files).some((p) => p.includes("backend-hono"))).toBe(false);
  });

  it("#15 AC-1: 既存の AGENTS.md が CRLF なら、足す部分も CRLF。印の外は変わらない", async () => {
    const dir = sampleApp();
    const crlf = EXISTING_AGENTS.replace(/\n/g, "\r\n");
    writeFileSync(path.join(dir, "AGENTS.md"), crlf);
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode, s.err()).toBe(
      0,
    );
    const agents = read(dir, "AGENTS.md");
    expect(agents.startsWith(crlf)).toBe(true);
    expect(agents.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("#15 AC-1: BOM 付きの UTF-8 の既存の AGENTS.md は、BOM が残る", async () => {
    const dir = sampleApp();
    writeFileSync(path.join(dir, "AGENTS.md"), `${BOM}${EXISTING_AGENTS}`);
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode, s.err()).toBe(
      0,
    );
    const bytes = readFileSync(path.join(dir, "AGENTS.md"));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(read(dir, "AGENTS.md").startsWith(`${BOM}${EXISTING_AGENTS}`)).toBe(true);
  });

  it("#15 AC-1: 既存の AGENTS.md に印が1組あれば、中だけを置き換える（印の外は変わらない）", async () => {
    const dir = sampleApp();
    const text = `前の文章\n\n${BEGIN}\n古い本文\n${END}\n\n後ろの文章`;
    writeFileSync(path.join(dir, "AGENTS.md"), text);
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode, s.err()).toBe(
      0,
    );
    const agents = read(dir, "AGENTS.md");
    expect(agents.startsWith("前の文章\n\n")).toBe(true);
    expect(agents.endsWith(`${END}\n\n後ろの文章`)).toBe(true);
    expect(agents).not.toContain("古い本文");
    expect(count(agents, BEGIN)).toBe(1);
  });

  it("#15 AC-1: 既存の AGENTS.md の印が壊れていれば、何も書かずに止まる", async () => {
    const dir = sampleApp();
    writeFileSync(path.join(dir, "AGENTS.md"), `${BEGIN}\n途中で切れている\n`);
    const before = snapshot(dir);
    const s = setup(dir);
    const out = await runAdopt({ answers: answersFile(), yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("AGENTS.md");
    expect(s.err()).toContain("印");
    expect(snapshot(dir)).toEqual(before);
  });

  it.each([
    ["Shift_JIS", Buffer.from([0x82, 0xa0, 0x82, 0xa2, 0x0a])],
    ["UTF-16 LE（BOM 付き）", Buffer.from(`${BOM}あいう\n`, "utf16le")],
  ])(
    "#15 AC-1: 既存の AGENTS.md が %s なら、何も書かずに止まる（文字コードの案内）",
    async (_name, bytes) => {
      const dir = sampleApp();
      writeFileSync(path.join(dir, "AGENTS.md"), bytes);
      const before = snapshot(dir);
      const s = setup(dir);
      const out = await runAdopt({ answers: answersFile(), yes: true }, s.deps);
      expect(out.exitCode).toBe(1);
      expect(s.err()).toContain("UTF-8");
      expect(snapshot(dir)).toEqual(before);
      expect(existsSync(path.join(dir, ".harness"))).toBe(false);
    },
  );

  it("#15 AC-1: 2回目は config.yaml があるので止まる（印が二重にならない）", async () => {
    const dir = sampleApp();
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode).toBe(0);
    const after = snapshot(dir);
    const s2 = setup(dir);
    const out = await runAdopt({ answers: answersFile(), yes: true }, s2.deps);
    expect(out.exitCode).toBe(1);
    expect(s2.err()).toContain(".harness/config.yaml");
    expect(snapshot(dir)).toEqual(after);
    expect(count(read(dir, "AGENTS.md"), BEGIN)).toBe(1);
  });

  it("#15 AC-1: 秘密情報の確認はまだ行わないことを、始めに表示する（#17 で追加予定）", async () => {
    const dir = sampleApp();
    const s = setup(dir);
    await runAdopt({ answers: answersFile(), yes: true }, s.deps);
    const notes = s.prompter.notes.join("\n");
    expect(notes).toContain("秘密情報の確認（履歴を含む）はまだ行いません");
    expect(notes).toContain("#17");
    expect(notes).toContain("導入の前に、秘密情報が含まれていないことを確かめてください");
  });

  it("#15 AC-1: --dry-run でも、始めの表示は出る", async () => {
    const dir = sampleApp();
    const s = setup(dir);
    await runAdopt({ answers: answersFile(), dryRun: true }, s.deps);
    expect(s.prompter.notes.join("\n")).toContain("秘密情報の確認（履歴を含む）はまだ行いません");
  });
});

describe("#15 AC-2: 同じ名前の Skill 等は上書きせず、選ばせる", () => {
  const SKILL = ".claude/skills/testing/SKILL.md";
  const MINE = "# 利用者のテストの Skill\n";

  function withOwnSkill(): string {
    const dir = sampleApp();
    write(dir, SKILL, MINE);
    return dir;
  }

  it("#15 AC-2: --yes では、既存を残す（中身が変わらず、管理にも入れない）", async () => {
    const dir = withOwnSkill();
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode, s.err()).toBe(
      0,
    );
    expect(read(dir, SKILL)).toBe(MINE);
    expect(readConfig(dir).managed_files[SKILL]).toBeUndefined();
    expect(s.out()).toContain(SKILL);
  });

  it("#15 AC-2: 対話で「置き換える」を選べば、置き換わる。差分を見せる", async () => {
    const dir = withOwnSkill();
    const s = setup(
      dir,
      { [`adopt_conflict:${SKILL}`]: ["replace"], adopt_confirm: [true] },
      { interactive: true },
    );
    expect((await runAdopt({ answers: answersFile() }, s.deps)).exitCode, s.err()).toBe(0);
    expect(read(dir, SKILL)).not.toBe(MINE);
    expect(read(dir, SKILL)).toContain("テスト");
    expect(readConfig(dir).managed_files[SKILL]).toBe(fingerprint(read(dir, SKILL)));
    expect(s.prompter.notes.join("\n")).toContain("利用者のテストの Skill");
  });

  it("#15 AC-2: 対話で「残す」を選べば、残る", async () => {
    const dir = withOwnSkill();
    const s = setup(
      dir,
      { [`adopt_conflict:${SKILL}`]: ["keep"], adopt_confirm: [true] },
      { interactive: true },
    );
    expect((await runAdopt({ answers: answersFile() }, s.deps)).exitCode, s.err()).toBe(0);
    expect(read(dir, SKILL)).toBe(MINE);
  });

  it("#15 AC-2: 同じ中身の Skill は、そのままにして管理に入れる", async () => {
    const dir = sampleApp();
    const first = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, first.deps)).exitCode).toBe(0);
    const text = read(dir, SKILL);
    // 導入をやり直す状況：記録（.harness）だけを消す
    rmSync(path.join(dir, ".harness"), { recursive: true });
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode, s.err()).toBe(
      0,
    );
    expect(read(dir, SKILL)).toBe(text);
    expect(readConfig(dir).managed_files[SKILL]).toBe(fingerprint(text));
    expect(count(read(dir, "AGENTS.md"), BEGIN)).toBe(1);
  });
});

describe("#15 AC-2: 同じ名前のファイルの差分が長くても、全体を見て選べる", () => {
  const SKILL = ".claude/skills/testing/SKILL.md";
  const LAST = "利用者の長い Skill の最後の行";

  function withLongSkill(): string {
    const dir = sampleApp();
    const lines = Array.from({ length: 400 }, (_, i) => `利用者の行 ${String(i + 1)}`);
    write(dir, SKILL, [...lines, LAST, ""].join("\n"));
    return dir;
  }

  it("#15 AC-2: 対話の差分は省かず、存在しない .harness-new を案内しない", async () => {
    const dir = withLongSkill();
    const s = setup(
      dir,
      { [`adopt_conflict:${SKILL}`]: ["keep"], adopt_confirm: [true] },
      { interactive: true },
    );
    expect((await runAdopt({ answers: answersFile() }, s.deps)).exitCode, s.err()).toBe(0);
    const notes = s.prompter.notes.join("\n");
    expect(notes).toContain(LAST);
    expect(notes).not.toContain("harness-new");
  });

  it("#15 AC-2: --dry-run の差分も省かず、.harness-new を案内しない", async () => {
    const dir = withLongSkill();
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), dryRun: true }, s.deps)).exitCode).toBe(0);
    expect(s.out()).toContain(LAST);
    expect(s.out()).not.toContain("harness-new");
  });

  it("#15 AC-2: 文書（AGENTS.md）の統合の差分が長くて省くときも、.harness-new を案内しない", async () => {
    const dir = sampleApp();
    const s = setup(dir);
    await runAdopt({ answers: answersFile(), dryRun: true }, s.deps);
    expect(s.out()).not.toContain("harness-new");
  });
});

describe("#15 AC-4: 確認・取り消し・dry-run", () => {
  it("#15 AC-4: --dry-run は何も書かない。一覧と差分を出す", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const s = setup(dir);
    const out = await runAdopt({ answers: answersFile(), dryRun: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(path.join(dir, ".harness"))).toBe(false);
    expect(s.out()).toContain("--dry-run");
    expect(s.out()).toContain("AGENTS.md");
    expect(s.out()).toContain("CLAUDE.md");
    expect(s.out()).toContain(".claude/skills/testing/SKILL.md");
    expect(s.out()).toContain(BEGIN);
  });

  it("#15 AC-4: 確認で「いいえ」なら何も書かない（終了コード0）", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const s = setup(dir, { adopt_confirm: [false] }, { interactive: true });
    const out = await runAdopt({ answers: answersFile() }, s.deps);
    expect(out.exitCode).toBe(0);
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(path.join(dir, ".harness"))).toBe(false);
  });

  it("#15 AC-4: 確認の途中で取り消し（Ctrl+C）なら何も書かない（終了コード130）", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const s = setup(dir, { adopt_confirm: [new CancelledError()] }, { interactive: true });
    const out = await runAdopt({ answers: answersFile() }, s.deps);
    expect(out.exitCode).toBe(130);
    expect(s.err()).toContain("中断しました");
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(path.join(dir, ".harness"))).toBe(false);
  });

  it("#15 AC-4: 端末でなく --yes もなければ、確認できないので止まる", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const s = setup(dir);
    const out = await runAdopt({ answers: answersFile() }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("--yes");
    expect(snapshot(dir)).toEqual(before);
  });
});

describe("#15 AC-5: 回答とアプリ名", () => {
  it("#15 AC-5: --answers が無ければ止まる", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const s = setup(dir);
    const out = await runAdopt({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("--answers");
    expect(snapshot(dir)).toEqual(before);
  });

  it("#15 AC-5: 回答ファイルに問題があれば、何も書かずに止まる", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const file = path.join(newRoot(), "bad.yaml");
    writeFileSync(file, "database: oracle\n");
    const s = setup(dir);
    const out = await runAdopt({ answers: file, yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("database");
    expect(snapshot(dir)).toEqual(before);
  });

  it("#15 AC-5: 端末でなく回答が足りなければ、足りない項目を示して止まる", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const file = path.join(newRoot(), "short.yaml");
    writeFileSync(file, stringify({ ais: ["claude"] }));
    const s = setup(dir);
    const out = await runAdopt({ answers: file, yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("database");
    expect(s.err()).not.toContain("app_name");
    expect(snapshot(dir)).toEqual(before);
  });

  it("#15 AC-5: 端末なら、足りない項目だけ質問する（app_name は聞かない）", async () => {
    const dir = sampleApp();
    const file = path.join(newRoot(), "short.yaml");
    const answers = { ...baseAnswers() } as Record<string, unknown>;
    delete answers["app_name"];
    delete answers["check_location"];
    writeFileSync(file, stringify(answers));
    const s = setup(
      dir,
      { check_location: ["local"], adopt_confirm: [true] },
      { interactive: true },
    );
    const out = await runAdopt({ answers: file }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(s.prompter.askedIds).toEqual(["check_location", "adopt_confirm"]);
    expect((readConfig(dir).answers as Record<string, unknown>)["check_location"]).toBe("local");
  });

  it("#15 AC-5: フォルダの名前がアプリ名として正しくなければ、何も書かずに案内して止まる", async () => {
    const dir = sampleApp("Sample_App");
    const before = snapshot(dir);
    const s = setup(dir);
    const out = await runAdopt({ answers: answersFile(), yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("Sample_App");
    expect(s.err()).toContain("アプリ名");
    expect(snapshot(dir)).toEqual(before);
  });

  it("#15 AC-5: 回答ファイルの app_name がフォルダの名前と違えば、何も書かずに案内して止まる", async () => {
    const dir = sampleApp();
    const before = snapshot(dir);
    const s = setup(dir);
    const out = await runAdopt(
      { answers: answersFile({ app_name: "other-app" }), yes: true },
      s.deps,
    );
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("other-app");
    expect(s.err()).toContain("sample-app");
    expect(snapshot(dir)).toEqual(before);
  });

  it("#15 AC-5: 回答ファイルの app_name がフォルダの名前と同じなら、導入できる", async () => {
    const dir = sampleApp();
    const s = setup(dir);
    const out = await runAdopt(
      { answers: answersFile({ app_name: "sample-app" }), yes: true },
      s.deps,
    );
    expect(out.exitCode, s.err()).toBe(0);
  });

  it("#15 AC-5: --dir で別のフォルダを指定できる", async () => {
    const dir = sampleApp();
    const s = setup(path.dirname(dir));
    const out = await runAdopt({ answers: answersFile(), yes: true, dir: "sample-app" }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(existsSync(path.join(dir, ".harness", "config.yaml"))).toBe(true);
  });
});

describe("#15 AC-6: 書き込みは一括で、失敗・中断では元に戻る（R1）", () => {
  it("#15 AC-6: config.yaml の書き込みに失敗すると、AGENTS.md・Skill は元のバイト列に戻り、config.yaml・ロック・一時ファイルが残らない", async () => {
    const dir = sampleApp();
    write(dir, ".claude/skills/testing/SKILL.md", "# 利用者のテストの Skill\n");
    const before = snapshot(dir);
    const s = setup(
      dir,
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
    const out = await runAdopt({ answers: answersFile(), yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("元に戻しました");
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(path.join(dir, ".harness"))).toBe(false);
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "#15 AC-6: 適用中の %s は元に戻し、ロックも一時ファイルも残さない（終了コード130）",
    async (signal) => {
      const dir = sampleApp();
      const before = snapshot(dir);
      const listeners = [process.listeners("SIGINT"), process.listeners("SIGTERM")];
      let interrupted = false;
      const s = setup(
        dir,
        {},
        {
          fs: {
            rename: async (from, to) => {
              await realRename(from, to);
              if (!interrupted) {
                interrupted = true;
                process.emit(signal);
              }
            },
          },
        },
      );
      const out = await runAdopt({ answers: answersFile(), yes: true }, s.deps);
      expect(out.exitCode).toBe(130);
      expect(interrupted).toBe(true);
      expect(snapshot(dir)).toEqual(before);
      expect(existsSync(path.join(dir, ".harness"))).toBe(false);
      expect(process.listeners("SIGINT")).toEqual(listeners[0]);
      expect(process.listeners("SIGTERM")).toEqual(listeners[1]);
    },
  );

  it("#15 AC-6: 判定の後に AGENTS.md が書き換えられたら、何も書かずに止まる", async () => {
    const dir = sampleApp();
    const prompter = new FakePrompter({ adopt_confirm: [true] });
    const original = prompter.confirm.bind(prompter);
    prompter.confirm = async (o) => {
      write(dir, "AGENTS.md", "# 確認の最中に、別のエディタで書き換えた\n");
      return original(o);
    };
    const s = setup(dir, {}, { interactive: true }, prompter);
    const out = await runAdopt({ answers: answersFile() }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(read(dir, "AGENTS.md")).toBe("# 確認の最中に、別のエディタで書き換えた\n");
    expect(existsSync(path.join(dir, ".harness", "config.yaml"))).toBe(false);
    expect(existsSync(path.join(dir, "CLAUDE.md"))).toBe(false);
  });
});
