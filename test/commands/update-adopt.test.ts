// #16 導入したアプリ（mode: adopt）の harness update：印の中だけを更新する。
// 架空の既存のアプリ（test/fixtures/adopt-sample/）に harness adopt を実行し、古いハーネスが書いた状態を作って試す。
// 本物のネットワーク・gh は使わない。実データ・個人名は使わない（架空の値だけ）。
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rename as realRename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { BEGIN, END } from "../../src/adopt/markers.js";
import type { AdoptDeps } from "../../src/commands/adopt.js";
import { runAdopt } from "../adopt/git-helpers.js";
import { runStatus } from "../../src/commands/status.js";
import { runUpdate } from "../../src/commands/update.js";
import { fingerprint } from "../../src/generate/config.js";
import { cleanScan } from "../adopt/secret-scan-helpers.js";
import { FakePrompter, baseAnswers } from "../questions/helpers.js";
import { FIXED_NOW } from "../versions/helpers.js";
import {
  cleanupRoots,
  editConfig,
  exists,
  newRoot,
  read,
  readConfig,
  sha,
  snapshot,
  updateSetup,
  write,
} from "../update/helpers.js";

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
const SKILL = ".claude/skills/testing/SKILL.md";
const OLD_BODY = "古いハーネスの本文（テスト）\n二行目";

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

/** 印の中を、古い本文に差し替えた全文（改行・印の外は変えない） */
function withBody(text: string, body: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const start = text.indexOf(BEGIN) + BEGIN.length;
  const end = text.indexOf(END);
  return `${text.slice(0, start)}${eol}${body.replace(/\n/g, eol)}${eol}${text.slice(end)}`;
}

const answersFile = (): string => {
  const file = path.join(newRoot(), "answers.yaml");
  const answers: Record<string, unknown> = baseAnswers();
  delete answers["app_name"];
  writeFileSync(file, stringify(answers));
  return file;
};

/**
 * harness adopt で導入したアプリを作り、古いハーネスが書いた状態にする：
 * AGENTS.md・CLAUDE.md の印の中と Skill を古い中身にし、記録の指紋もそれに合わせる（利用者は書き換えていない）。
 */
async function adoptedApp(
  prepare: (dir: string) => void = () => undefined,
  old = true,
): Promise<string> {
  const dir = path.join(newRoot(), "sample-app");
  cpSync(FIXTURE, dir, { recursive: true });
  prepare(dir);
  const deps: AdoptDeps = {
    prompter: new FakePrompter(),
    cwd: dir,
    interactive: false,
    stderr: () => undefined,
    stdout: () => undefined,
    now: () => FIXED_NOW,
    secretScan: cleanScan,
  };
  const out = await runAdopt({ answers: answersFile(), yes: true }, deps);
  if (out.exitCode !== 0) throw new Error("導入に失敗しました");
  if (old) makeOld(dir);
  return dir;
}

function makeOld(dir: string): void {
  for (const p of ["AGENTS.md", "CLAUDE.md"]) {
    write(dir, p, withBody(read(dir, p), OLD_BODY));
  }
  write(dir, SKILL, "# 古い Skill（テスト）\n");
  editConfig(dir, (doc) => {
    doc.managed_files["AGENTS.md"] = fingerprint(OLD_BODY);
    doc.managed_files["CLAUDE.md"] = fingerprint(OLD_BODY);
    doc.managed_files[SKILL] = fingerprint("# 古い Skill（テスト）\n");
  });
}

const bytes = (dir: string, rel: string): Buffer => readFileSync(path.join(dir, ...rel.split("/")));

/** 印の外（印の前と後）のバイト列 */
function outside(dir: string, rel: string): [Buffer, Buffer] {
  const b = bytes(dir, rel);
  const s = b.indexOf(BEGIN);
  const e = b.indexOf(END) + END.length;
  return [b.subarray(0, s), b.subarray(e)];
}

describe("#16 AC-1: adopt したアプリの update は、印の中だけを更新する", () => {
  it("#16 LF：印の外のバイト列が同じで、中だけが新しい。mode: adopt・marked_files が残り、指紋が新しい本文の指紋", async () => {
    const dir = await adoptedApp();
    write(dir, "AGENTS.md", `${read(dir, "AGENTS.md")}\n印の後の利用者の一行\n`);
    const beforeOutside = outside(dir, "AGENTS.md");
    const s = updateSetup(dir);
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    const [head, tail] = outside(dir, "AGENTS.md");
    expect(head.equals(beforeOutside[0])).toBe(true);
    expect(tail.equals(beforeOutside[1])).toBe(true);
    expect(blockBody(read(dir, "AGENTS.md"))).not.toBe(OLD_BODY);
    expect(blockBody(read(dir, "AGENTS.md"))).toContain("sample-app");
    const config = readConfig(dir);
    expect(config["mode"]).toBe("adopt");
    expect(config["marked_files"]).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(config.managed_files["AGENTS.md"]).toBe(fingerprint(blockBody(read(dir, "AGENTS.md"))));
    expect(config.managed_files[SKILL]).toBe(fingerprint(read(dir, SKILL)));
    expect(s.out()).toContain("AGENTS.md");
    expect(exists(dir, ".harness/.update-lock")).toBe(false);
  });

  it("#20 AC-5: 差の一覧(docs/harness-adoption.md)は導入のときの記録。update は書き換えず、記録(指紋)にも入れない", async () => {
    const dir = await adoptedApp();
    const DOC = "docs/harness-adoption.md";
    // 利用者(または AI)が「未確認」を埋めた状態にする
    write(dir, DOC, `${read(dir, DOC)}\n| 埋めた項目(テスト) |\n`);
    const before = sha(bytes(dir, DOC));
    expect(readConfig(dir).managed_files[DOC]).toBeUndefined();
    const s = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
    expect(sha(bytes(dir, DOC))).toBe(before);
    expect(exists(dir, `${DOC}.harness-new`)).toBe(false);
    expect(readConfig(dir).managed_files[DOC]).toBeUndefined();
  });

  it("#16 CRLF と BOM：BOM と CRLF が保たれ、印の外がバイト単位で同じ", async () => {
    const dir = await adoptedApp((d) => {
      const original = readFileSync(path.join(FIXTURE, "AGENTS.md"), "utf8").replace(/\n/g, "\r\n");
      writeFileSync(path.join(d, "AGENTS.md"), `${BOM}${original}`);
    });
    const raw = bytes(dir, "AGENTS.md");
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const beforeOutside = outside(dir, "AGENTS.md");
    const s = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
    const after = bytes(dir, "AGENTS.md");
    expect([...after.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const [head, tail] = outside(dir, "AGENTS.md");
    expect(head.equals(beforeOutside[0])).toBe(true);
    expect(tail.equals(beforeOutside[1])).toBe(true);
    const text = after.toString("utf8");
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(blockBody(text)).not.toBe(OLD_BODY);
  });

  it("#16 印の中を手で書き換えた：--yes は置き換えず .harness-new（全文）を作る。元と記録の指紋は変わらない", async () => {
    const dir = await adoptedApp();
    write(dir, "AGENTS.md", withBody(read(dir, "AGENTS.md"), "利用者が書き換えた本文"));
    const rawBefore = sha(bytes(dir, "AGENTS.md"));
    const fpBefore = readConfig(dir).managed_files["AGENTS.md"];
    const s = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
    expect(sha(bytes(dir, "AGENTS.md"))).toBe(rawBefore);
    expect(readConfig(dir).managed_files["AGENTS.md"]).toBe(fpBefore);
    const fresh = read(dir, "AGENTS.md.harness-new");
    expect(fresh).toContain("# sample-app のルール");
    expect(blockBody(fresh)).toContain("sample-app");
    expect(blockBody(fresh)).not.toBe("利用者が書き換えた本文");
  });

  it("#16 印の中を手で書き換えた：対話で置き換えを選べば、置き換わる（印の外は残る）", async () => {
    const dir = await adoptedApp();
    write(dir, "AGENTS.md", withBody(read(dir, "AGENTS.md"), "利用者が書き換えた本文"));
    const s = updateSetup(dir, { "update_conflict:AGENTS.md": ["replace"] }, { interactive: true });
    expect((await runUpdate({}, s.deps)).exitCode, s.err()).toBe(0);
    expect(blockBody(read(dir, "AGENTS.md"))).not.toBe("利用者が書き換えた本文");
    expect(read(dir, "AGENTS.md")).toContain("# sample-app のルール");
    expect(exists(dir, "AGENTS.md.harness-new")).toBe(false);
  });

  it("#16 印の外だけを編集した：replace になり、外の編集は残る", async () => {
    const dir = await adoptedApp();
    write(dir, "AGENTS.md", `先頭に足した利用者の行\n${read(dir, "AGENTS.md")}`);
    const s = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
    expect(read(dir, "AGENTS.md").startsWith("先頭に足した利用者の行\n")).toBe(true);
    expect(blockBody(read(dir, "AGENTS.md"))).not.toBe(OLD_BODY);
    expect(exists(dir, "AGENTS.md.harness-new")).toBe(false);
  });

  it("#16 印が無い・begin だけ・2組：終了コード1、全ファイルが同じ、ロックが残らない", async () => {
    const cases: Record<string, (t: string) => string> = {
      none: (t) => t.replace(BEGIN, "").replace(END, ""),
      "begin-only": (t) => t.replace(END, ""),
      two: (t) => `${t}\n${BEGIN}\n二組目\n${END}\n`,
    };
    for (const [name, edit] of Object.entries(cases)) {
      const dir = await adoptedApp();
      write(dir, "AGENTS.md", edit(read(dir, "AGENTS.md")));
      const before = snapshot(dir);
      for (const options of [{ yes: true }, { dryRun: true }]) {
        const s = updateSetup(dir);
        const out = await runUpdate(options, s.deps);
        expect(out.exitCode, name).toBe(1);
        expect(s.err(), name).toContain("AGENTS.md");
        expect(snapshot(dir), name).toEqual(before);
        expect(exists(dir, ".harness/.update-lock"), name).toBe(false);
      }
    }
  });

  it("#16 UTF-16LE の AGENTS.md：止まり、何も書かない", async () => {
    const dir = await adoptedApp();
    const text = read(dir, "AGENTS.md");
    writeFileSync(path.join(dir, "AGENTS.md"), Buffer.from(text, "utf16le"));
    const before = snapshot(dir);
    const s = updateSetup(dir);
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("UTF-8");
    expect(snapshot(dir)).toEqual(before);
    expect(exists(dir, ".harness/.update-lock")).toBe(false);
  });

  it("#16 adopt で既存を残した .claude/settings.json：変わらず、managed_files にも入らない。報告に出る", async () => {
    const dir = await adoptedApp((d) => {
      mkdirSync(path.join(d, ".claude"), { recursive: true });
      writeFileSync(path.join(d, ".claude", "settings.json"), '{"note":"既存の設定（テスト）"}\n');
    });
    expect(readConfig(dir).managed_files[".claude/settings.json"]).toBeUndefined();
    const before = sha(bytes(dir, ".claude/settings.json"));
    const s = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
    expect(sha(bytes(dir, ".claude/settings.json"))).toBe(before);
    expect(readConfig(dir).managed_files[".claude/settings.json"]).toBeUndefined();
    expect(s.out()).toContain("管理外のため触れない");
    expect(s.out()).toContain(".claude/settings.json");
  });

  it("#16 印のないファイル（SKILL.md）：未変更は replace、手で変更は conflict、削除は removed（今の update と同じ）", async () => {
    const dir = await adoptedApp();
    const s1 = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s1.deps)).exitCode, s1.err()).toBe(0);
    expect(read(dir, SKILL)).not.toContain("古い Skill（テスト）");

    const edited = await adoptedApp();
    write(edited, SKILL, "# 利用者が書き換えた\n");
    const s2 = updateSetup(edited);
    expect((await runUpdate({ yes: true }, s2.deps)).exitCode, s2.err()).toBe(0);
    expect(read(edited, SKILL)).toBe("# 利用者が書き換えた\n");
    expect(exists(edited, `${SKILL}.harness-new`)).toBe(true);

    const removed = await adoptedApp();
    rmSync(path.join(removed, ...SKILL.split("/")));
    const s3 = updateSetup(removed);
    expect((await runUpdate({ yes: true }, s3.deps)).exitCode, s3.err()).toBe(0);
    expect(exists(removed, SKILL)).toBe(false);
    expect(readConfig(removed).removed_files).toEqual([SKILL]);
  });

  it("#16 --dry-run：何も書かず、ロックも作らない。一覧を出す", async () => {
    const dir = await adoptedApp();
    const before = snapshot(dir);
    const s = updateSetup(dir);
    const out = await runUpdate({ dryRun: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(path.join(dir, ".harness", ".update-lock"))).toBe(false);
    expect(s.out()).toContain("AGENTS.md");
  });

  it("#16 書き込みの途中で失敗：AGENTS.md の全文が元に戻る", async () => {
    const dir = await adoptedApp();
    write(dir, "AGENTS.md", `${read(dir, "AGENTS.md")}\n利用者の追記\n`);
    const before = snapshot(dir);
    let failed = false;
    const s = updateSetup(
      dir,
      {},
      {
        fs: {
          rename: async (from, to) => {
            if (!failed && to.replace(/\\/g, "/").endsWith(".harness/config.yaml")) {
              failed = true;
              throw new Error("失敗（テスト）");
            }
            return realRename(from, to);
          },
        },
      },
    );
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(failed).toBe(true);
    expect(snapshot(dir)).toEqual(before);
    expect(exists(dir, ".harness/.update-lock")).toBe(false);
  });

  it("#16 status：update の後、書き換え済みは0件", async () => {
    const dir = await adoptedApp();
    const s = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
    const outs: string[] = [];
    const st = await runStatus(
      {},
      {
        cwd: dir,
        stdout: (t) => outs.push(t),
        stderr: () => undefined,
        runGh: async () => ({ code: 1, stdout: "", stderr: "なし" }),
        repository: () => undefined,
        changelog: () => undefined,
        harnessVersion: () => readConfig(dir)["harness_version"] as string,
      },
    );
    expect(st.exitCode).toBe(0);
    expect(outs.join("")).not.toMatch(/書き換え済みの管理ファイル：[1-9]/);
    expect(outs.join("")).not.toContain("壊れ");
  });

  it("#16 R1：CLAUDE.md を消した状態の update：印で囲んで追加し、status は0件、もう一度 update しても unchanged", async () => {
    const dir = await adoptedApp(undefined, false);
    rmSync(path.join(dir, "CLAUDE.md"));
    editConfig(dir, (doc) => {
      delete doc.managed_files["CLAUDE.md"];
      doc["marked_files"] = ["AGENTS.md"];
    });
    const s = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
    const claude = read(dir, "CLAUDE.md");
    expect(claude.startsWith(BEGIN)).toBe(true);
    expect(claude.endsWith(`${END}\n`)).toBe(true);
    const config = readConfig(dir);
    expect(config["marked_files"]).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(config.managed_files["CLAUDE.md"]).toBe(fingerprint(blockBody(claude)));

    const before = snapshot(dir);
    const s2 = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s2.deps)).exitCode, s2.err()).toBe(0);
    const after = snapshot(dir);
    for (const [rel, hash] of before) {
      if (rel === ".harness/config.yaml") continue;
      expect(after.get(rel), rel).toBe(hash);
    }
    expect(s2.out()).not.toContain("### 置き換え");
  });

  /** 復元した CLAUDE.md の確認：印で囲まれ、記録が正しく、status は0件、もう一度 update しても unchanged */
  async function expectRestored(dir: string): Promise<void> {
    const claude = read(dir, "CLAUDE.md");
    expect(claude.startsWith(BEGIN)).toBe(true);
    expect(
      claude.endsWith(`${END}
`),
    ).toBe(true);
    const config = readConfig(dir);
    expect(config["marked_files"]).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(config.managed_files["CLAUDE.md"]).toBe(fingerprint(blockBody(claude)));
    expect(config.removed_files ?? []).toEqual([]);
    const outs: string[] = [];
    await runStatus(
      {},
      {
        cwd: dir,
        stdout: (t) => outs.push(t),
        stderr: () => undefined,
        runGh: async () => ({ code: 1, stdout: "", stderr: "なし" }),
        repository: () => undefined,
        changelog: () => undefined,
        harnessVersion: () => config["harness_version"] as string,
      },
    );
    expect(outs.join("")).toContain("書き換え済みの管理ファイル：0 件");
    expect(outs.join("")).not.toContain("壊れ");
    const before = snapshot(dir);
    const again = updateSetup(dir);
    expect((await runUpdate({ yes: true }, again.deps)).exitCode, again.err()).toBe(0);
    const after = snapshot(dir);
    for (const [rel, hash] of before) {
      if (rel === ".harness/config.yaml") continue;
      expect(after.get(rel), rel).toBe(hash);
    }
    expect(again.out()).not.toContain("### 置き換え");
  }

  it("#16 記録を残したまま CLAUDE.md だけを消した：対話で復元を選ぶと、印で囲んで戻る", async () => {
    const dir = await adoptedApp(undefined, false);
    rmSync(path.join(dir, "CLAUDE.md"));
    const s = updateSetup(dir, { "update_restore:CLAUDE.md": [true] }, { interactive: true });
    expect((await runUpdate({}, s.deps)).exitCode, s.err()).toBe(0);
    await expectRestored(dir);
  });

  it("#16 記録を残したまま CLAUDE.md だけを消した：--yes は消したままにし、次の対話で復元できる", async () => {
    const dir = await adoptedApp(undefined, false);
    rmSync(path.join(dir, "CLAUDE.md"));
    const s1 = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s1.deps)).exitCode, s1.err()).toBe(0);
    expect(exists(dir, "CLAUDE.md")).toBe(false);
    expect(readConfig(dir).removed_files).toEqual(["CLAUDE.md"]);
    const s2 = updateSetup(dir, { "update_restore:CLAUDE.md": [true] }, { interactive: true });
    expect((await runUpdate({}, s2.deps)).exitCode, s2.err()).toBe(0);
    await expectRestored(dir);
  });
});

describe("#17 adopt で記録した秘密情報の確認は、harness update の後も残る", () => {
  it("passed（範囲・日付）が、更新の後も同じ", async () => {
    const dir = await adoptedApp();
    const before = readConfig(dir)["secret_scan"];
    expect(before).toEqual({
      status: "passed",
      scope: "history+worktree",
      checked_on: expect.any(String) as string,
    });
    const s = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
    expect(readConfig(dir)["updated_on"]).toBeDefined();
    expect(readConfig(dir)["secret_scan"]).toEqual(before);
  });

  it("skipped（確認していない）も、そのまま残る", async () => {
    const dir = await adoptedApp();
    editConfig(dir, (doc) => {
      doc["secret_scan"] = { status: "skipped", checked_on: "2026-10-01" };
    });
    const s = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
    expect(readConfig(dir)["secret_scan"]).toEqual({ status: "skipped", checked_on: "2026-10-01" });
  });
});
