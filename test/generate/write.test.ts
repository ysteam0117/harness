// 想定する型（実装は src/generate/write.ts をこれに合わせる）。一時的な場所での生成と移動（計画 7・R1・R2）
//
//   import type { Stats } from "node:fs";
//   /** ファイル操作の窓口。テストでは一部だけを差し替える（本物は node:fs/promises と setTimeout） */
//   export interface FsOps {
//     mkdir(dir: string, opts: { recursive: true }): Promise<unknown>;
//     writeFile(file: string, content: string): Promise<void>;      // 文字列は UTF-8 で、そのまま書く
//     lstat(p: string): Promise<Stats>;                             // リンクをたどらない。なければ code: "ENOENT" で失敗する
//     readdir(p: string): Promise<string[]>;
//     rmdir(p: string): Promise<void>;                              // 空でなければ失敗する操作。再帰の削除ではない
//     rename(from: string, to: string): Promise<void>;
//     rm(p: string, opts: { recursive: true; force: true }): Promise<void>;   // 一時的な場所を消す
//     sleep(ms: number): Promise<void>;                             // 移動の再試行の待ち
//   }
//   export interface WriteProjectInput {
//     cwd: string;                                  // 作業中のフォルダ。生成先は <cwd>/<appName>
//     appName: string;
//     files: { path: string; content: string }[];   // "/" 区切りの相対パス
//     fs?: Partial<FsOps>;                          // 差し替え（既定は本物）
//     signal?: AbortSignal;                         // 中断の要求（SIGINT を受けたら create が abort する）
//   }
//   export class GenerationInterrupted extends Error {}   // 移動の前に、中断の要求を受けて止めた（一時的な場所は消してある）
//   export function writeProject(input: WriteProjectInput): Promise<{ dir: string; interrupted: boolean }>;
//     - dir は <cwd>/<appName>。interrupted は、移動（rename）が成功した後に中断の要求が届いたとき true（生成は完了している）
//     - 生成先に中身のあるフォルダ・同じ名前のファイル・リンク（シンボリックリンク・ジャンクション）があれば GenerateError
//     - 一時的な場所：<cwd>/.<appName>.harness-tmp-<乱数>（生成先と同じフォルダの中）
//     - 書き込みの前と、移動の直前の2回、生成先を lstat で確かめる
//     - 生成先に空のフォルダがあれば rmdir だけで消してから、rename で移す。rename は生成先がない状態でだけ行う
//     - rename が EPERM・EBUSY で失敗したら、sleep を挟んで数回やり直す（生成先は削除しない）。上限を超えたら一時的な場所を消してエラー
//     - 途中の失敗・中断：一時的な場所を消してから、元のエラー（または GenerationInterrupted）で終わる。消せなければ場所を示す GenerateError
//     - 出力先の外へ出るパス（".."・絶対パス・"\\"）は GenerateError（何も作らない）
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  lstat as realLstat,
  mkdir as realMkdir,
  readdir as realReaddir,
  rename as realRename,
  rmdir as realRmdir,
  writeFile as realWriteFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GenerateError } from "../../src/generate/errors.js";
import { GenerationInterrupted, writeProject } from "../../src/generate/write.js";

const APP = "testapp-001";
const TMP_PREFIX = `.${APP}.harness-tmp-`;

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** 一時フォルダ（root）の中に、作業中のフォルダ（cwd）を作る */
function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-q34-write-"));
  roots.push(root);
  const cwd = path.join(root, "work");
  mkdirSync(cwd);
  return { root, cwd, target: path.join(cwd, APP) };
}

const FILES = [
  { path: "AGENTS.md", content: "# エージェント\r\nA\n" },
  { path: ".harness/config.yaml", content: "mode: create\n" },
  { path: "backend/src/lib/a.ts", content: "export const a = 1;\n" },
  { path: "backend/src/lib/b.ts", content: "export const b = 2;\n" },
  { path: "docs/adr/0001.md", content: "日本語の中身\n" },
  { path: "empty.txt", content: "" },
];

type Over = Parameters<typeof writeProject>[0]["fs"];
const run = (
  cwd: string,
  fs?: Over,
  extra: { signal?: AbortSignal; files?: { path: string; content: string }[] } = {},
) =>
  writeProject({
    cwd,
    appName: APP,
    files: extra.files ?? FILES,
    ...(fs ? { fs } : {}),
    ...(extra.signal ? { signal: extra.signal } : {}),
  });

const eperm = () =>
  Object.assign(new Error("EPERM: operation not permitted (fake)"), { code: "EPERM" });
const ebusy = () => Object.assign(new Error("EBUSY: resource busy (fake)"), { code: "EBUSY" });

const tree = (dir: string) => {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const full = path.join(dir, rel);
    if (lstatSync(full).isFile()) out[rel.split(path.sep).join("/")] = readFileSync(full, "utf8");
  }
  return out;
};
const same = (a: string, b: string) => path.resolve(a) === path.resolve(b);

describe("#34 AC-1: 生成先に中身がある場合は、エラーにして止める", () => {
  it("#34 AC-1: 正常：生成先ができて、すべてのファイルが中身のとおりに書かれる（一時的な場所は残らない）", async () => {
    const s = setup();
    const out = await run(s.cwd);
    expect(out).toEqual({ dir: s.target, interrupted: false });
    expect(readdirSync(s.cwd)).toEqual([APP]);
    const written = tree(s.target);
    for (const f of FILES) expect(written[f.path], f.path).toBe(f.content);
    expect(Object.keys(written).sort()).toEqual(FILES.map((f) => f.path).sort());
  });

  it("#34 AC-1: 中身のあるフォルダがあると、GenerateError。何も書かず、既存の中身は変わらない", async () => {
    const s = setup();
    mkdirSync(s.target);
    writeFileSync(path.join(s.target, "keep.txt"), "既存");
    await expect(run(s.cwd)).rejects.toThrow(GenerateError);
    expect(tree(s.target)).toEqual({ "keep.txt": "既存" });
    expect(readdirSync(s.cwd)).toEqual([APP]); // 一時的な場所も残らない
  });

  it("#34 AC-1: エラーのメッセージに、生成先のパスが入る", async () => {
    const s = setup();
    mkdirSync(s.target);
    writeFileSync(path.join(s.target, "keep.txt"), "既存");
    await expect(run(s.cwd)).rejects.toThrow(APP);
  });

  it("#34 AC-1: 同じ名前のファイルがあると、GenerateError。ファイルは変わらない", async () => {
    const s = setup();
    writeFileSync(s.target, "ファイルの中身");
    await expect(run(s.cwd)).rejects.toThrow(GenerateError);
    expect(readFileSync(s.target, "utf8")).toBe("ファイルの中身");
    expect(readdirSync(s.cwd)).toEqual([APP]);
  });

  it("#34 AC-1: 空のフォルダなら生成できる（空のフォルダの場所に、生成したものが入る）", async () => {
    const s = setup();
    mkdirSync(s.target);
    const out = await run(s.cwd);
    expect(out.interrupted).toBe(false);
    expect(Object.keys(tree(s.target)).sort()).toEqual(FILES.map((f) => f.path).sort());
    expect(readdirSync(s.cwd)).toEqual([APP]);
  });

  it("#34 AC-1: 失敗したとき、一時的な場所は残らず、生成先にファイルは置かれない（元からの空のフォルダは、あっても空）", async () => {
    const s = setup();
    mkdirSync(s.target);
    let n = 0;
    await expect(
      run(s.cwd, {
        writeFile: async (f, c) => {
          n += 1;
          if (n === 2) throw new Error("disk full (fake)");
          await realWriteFile(f, c, "utf8");
        },
      }),
    ).rejects.toThrow(/disk full/);
    expect(readdirSync(s.cwd).filter((name) => name.startsWith("."))).toEqual([]);
    if (existsSync(s.target)) expect(readdirSync(s.target)).toEqual([]);
  });

  it("#34 AC-1: 出力先の外へ出るパス（..・絶対パス）は、何も作らずにエラー", async () => {
    for (const bad of ["../evil.txt", "/abs/evil.txt", "a/../../evil.txt"]) {
      const s = setup();
      await expect(
        run(s.cwd, undefined, { files: [...FILES, { path: bad, content: "x" }] }),
        bad,
      ).rejects.toThrow(GenerateError);
      expect(readdirSync(s.cwd), bad).toEqual([]);
      expect(existsSync(path.join(s.root, "evil.txt")), bad).toBe(false);
    }
  });
});

describe("#34 AC-2: 途中で失敗・中断したとき、生成先にファイルが残らない", () => {
  it("#34 AC-2: 3つ目の書き込みで例外にすると、元のエラーで終わり、生成先も一時的な場所も残らない", async () => {
    const s = setup();
    let n = 0;
    await expect(
      run(s.cwd, {
        writeFile: async (f, c) => {
          n += 1;
          if (n === 3) throw new Error("disk full (fake)");
          await realWriteFile(f, c, "utf8");
        },
      }),
    ).rejects.toThrow(/disk full \(fake\)/);
    expect(n).toBe(3);
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it("#34 AC-2: 最後のファイルの書き込みで失敗しても、何も残らない", async () => {
    const s = setup();
    let n = 0;
    await expect(
      run(s.cwd, {
        writeFile: async (f, c) => {
          n += 1;
          if (n === FILES.length) throw new Error("disk full (fake)");
          await realWriteFile(f, c, "utf8");
        },
      }),
    ).rejects.toThrow(/disk full/);
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it("#34 AC-2: 書き込みは、生成先と同じフォルダの中の一時的な場所（.<アプリ名>.harness-tmp-<乱数>）に対して行う", async () => {
    const s = setup();
    const written: string[] = [];
    await run(s.cwd, {
      writeFile: async (f, c) => {
        written.push(f);
        await realWriteFile(f, c, "utf8");
      },
    });
    expect(written.length).toBe(FILES.length);
    for (const f of written) {
      const rel = path.relative(s.cwd, f);
      expect(rel.startsWith(TMP_PREFIX), f).toBe(true);
      expect(rel.length).toBeGreaterThan(TMP_PREFIX.length); // 乱数の部分がある
    }
  });

  it("#34 AC-2: 一時的な場所を消せないときは、その場所を示すエラーにする（もみ消さない）", async () => {
    const s = setup();
    let n = 0;
    await expect(
      run(s.cwd, {
        writeFile: async (f, c) => {
          n += 1;
          if (n === 2) throw new Error("disk full (fake)");
          await realWriteFile(f, c, "utf8");
        },
        rm: async () => {
          throw ebusy();
        },
      }),
    ).rejects.toThrow(new RegExp(TMP_PREFIX.replaceAll(".", "\\.")));
    // 消せなかったので、一時的な場所は残っている（生成先は作られていない）
    expect(readdirSync(s.cwd).filter((n2) => n2 === APP)).toEqual([]);
  });

  it("#34 AC-2: 成功したときに、一時的な場所を消す操作（rm）は不要（名前の変更で移すだけ）", async () => {
    const s = setup();
    const removed: string[] = [];
    await run(s.cwd, {
      rm: async (p) => {
        removed.push(p);
      },
    });
    expect(removed).toEqual([]);
  });
});

describe("#34 R1: 移動の安全（リンク・競合）", () => {
  it("#34 R1: 生成先の確認（lstat）は、書き込みを始める前に行う", async () => {
    const s = setup();
    const events: string[] = [];
    await run(s.cwd, {
      lstat: async (p) => {
        if (same(p, s.target)) events.push("lstat");
        return realLstat(p);
      },
      writeFile: async (f, c) => {
        events.push("write");
        await realWriteFile(f, c, "utf8");
      },
    });
    expect(events[0]).toBe("lstat");
    expect(events.indexOf("write")).toBeGreaterThan(0);
  });

  it("#34 R1: 確かめた後に、生成先に別のファイルが置かれたら、生成先には触らず、一時的な場所を消してエラー", async () => {
    const s = setup();
    let n = 0;
    await expect(
      run(s.cwd, {
        writeFile: async (f, c) => {
          n += 1;
          await realWriteFile(f, c, "utf8");
          if (n === FILES.length) {
            mkdirSync(s.target);
            writeFileSync(path.join(s.target, "other.txt"), "別のプロセスのファイル");
          }
        },
      }),
    ).rejects.toThrow(GenerateError);
    expect(tree(s.target)).toEqual({ "other.txt": "別のプロセスのファイル" });
    expect(readdirSync(s.cwd)).toEqual([APP]); // 一時的な場所は消えている
  });

  it("#34 R1: 生成先は mkdir（再帰なし）で作る。移すのは、一時的な場所の最上位の各項目を、生成先の中へ rename で（最後に空の一時的な場所を rmdir で消す）", async () => {
    const s = setup();
    const targetMkdirs: (boolean | undefined)[] = [];
    const moves: { from: string; to: string }[] = [];
    const rmdirs: string[] = [];
    await run(s.cwd, {
      mkdir: async (p, o) => {
        if (same(p, s.target)) targetMkdirs.push(o?.recursive);
        await realMkdir(p, o);
      },
      rename: async (from, to) => {
        moves.push({ from, to });
        await realRename(from, to);
      },
      rmdir: async (p) => {
        rmdirs.push(p);
        await realRmdir(p);
      },
    });
    expect(targetMkdirs).toHaveLength(1);
    expect(targetMkdirs[0]).not.toBe(true); // 再帰なし（あれば EEXIST で失敗する）
    const tops = [...new Set(FILES.map((f) => f.path.split("/")[0]))].sort();
    expect(moves.map((m) => path.basename(m.to)).sort()).toEqual(tops);
    for (const m of moves) {
      expect(same(path.dirname(m.to), s.target), m.to).toBe(true);
      expect(path.basename(path.dirname(m.from)).startsWith(TMP_PREFIX), m.from).toBe(true);
    }
    // 空になった一時的な場所は rmdir で消す（再帰の削除ではない）
    expect(rmdirs.some((p) => path.basename(p).startsWith(TMP_PREFIX))).toBe(true);
    expect(readdirSync(s.cwd)).toEqual([APP]);
    expect(Object.keys(tree(s.target)).sort()).toEqual(FILES.map((f) => f.path).sort());
  });

  it("#34 R1: 確かめた後に、生成先ができて mkdir が EEXIST になったら、生成先の中身は消さず、一時的な場所を消してエラー", async () => {
    const s = setup();
    await expect(
      run(s.cwd, {
        mkdir: async (p, o) => {
          if (same(p, s.target)) {
            await realMkdir(s.target); // 直前に別のプロセスが作った
            writeFileSync(path.join(s.target, "other.txt"), "別のプロセスのファイル");
            throw Object.assign(new Error("EEXIST: file already exists (fake)"), {
              code: "EEXIST",
            });
          }
          await realMkdir(p, o);
        },
      }),
    ).rejects.toThrow(GenerateError);
    expect(tree(s.target)).toEqual({ "other.txt": "別のプロセスのファイル" });
    expect(readdirSync(s.cwd)).toEqual([APP]); // 一時的な場所は消えている
  });

  it("#34 R1: 元からある空のフォルダを rmdir で消した後、mkdir の前に別のものが置かれたら、そのものには触らず、エラー", async () => {
    const s = setup();
    mkdirSync(s.target); // 元からの空のフォルダ
    await expect(
      run(s.cwd, {
        rmdir: async (p) => {
          await realRmdir(p);
          if (same(p, s.target)) {
            await realMkdir(s.target);
            writeFileSync(path.join(s.target, "other.txt"), "競合");
          }
        },
      }),
    ).rejects.toThrow(GenerateError);
    expect(tree(s.target)).toEqual({ "other.txt": "競合" });
    expect(readdirSync(s.cwd)).toEqual([APP]);
  });

  it("#34 R1: 元からある空のフォルダは、rmdir（再帰でない削除）だけで消す。rm は使わない", async () => {
    const s = setup();
    mkdirSync(s.target);
    const rmCalls: string[] = [];
    const rmdirs: string[] = [];
    await run(s.cwd, {
      rm: async (p) => {
        rmCalls.push(p);
      },
      rmdir: async (p) => {
        rmdirs.push(p);
        await realRmdir(p);
      },
    });
    expect(rmdirs.filter((p) => same(p, s.target))).toHaveLength(1);
    expect(rmCalls).toEqual([]);
    expect(Object.keys(tree(s.target)).length).toBe(FILES.length);
  });

  it("#34 R1: 生成先がシンボリックリンク（ジャンクション）のときは、中身が空でも拒否する。リンク先には何も書かない", async () => {
    const s = setup();
    const dest = path.join(s.root, "dest");
    mkdirSync(dest);
    symlinkSync(dest, s.target, "junction");
    await expect(run(s.cwd)).rejects.toThrow(GenerateError);
    expect(readdirSync(dest)).toEqual([]);
    expect(lstatSync(s.target).isSymbolicLink()).toBe(true);
    expect(readdirSync(s.cwd)).toEqual([APP]);
  });

  it("#34 R1: 書き込みの途中でリンクに置き換えられたときも、拒否する。リンク先には何も書かず、一時的な場所を消す", async () => {
    const s = setup();
    const dest = path.join(s.root, "dest");
    mkdirSync(dest);
    let n = 0;
    await expect(
      run(s.cwd, {
        writeFile: async (f, c) => {
          n += 1;
          await realWriteFile(f, c, "utf8");
          if (n === FILES.length) symlinkSync(dest, s.target, "junction");
        },
      }),
    ).rejects.toThrow(GenerateError);
    expect(readdirSync(dest)).toEqual([]);
    expect(lstatSync(s.target).isSymbolicLink()).toBe(true);
    expect(readdirSync(s.cwd)).toEqual([APP]);
  });

  it("#34 R1: 移動の再試行（EPERM・EBUSY）：少し待って数回やり直し、成功すれば生成できる。待ちは sleep を使う", async () => {
    for (const make of [eperm, ebusy]) {
      const s = setup();
      let calls = 0;
      const sleeps: number[] = [];
      const out = await run(s.cwd, {
        rename: async (a, b) => {
          calls += 1;
          if (calls <= 2) throw make();
          await realRename(a, b);
        },
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      });
      expect(out.interrupted).toBe(false);
      expect(calls).toBeGreaterThanOrEqual(3);
      expect(sleeps.length).toBeGreaterThanOrEqual(2);
      for (const ms of sleeps) expect(ms).toBeGreaterThan(0);
      expect(Object.keys(tree(s.target)).length).toBe(FILES.length);
      expect(readdirSync(s.cwd)).toEqual([APP]);
    }
  });

  it("#34 R1: 再試行のあいだに、生成先を削除しない（rmdir・rm で生成先を消さない。空のフォルダを消す rmdir は最初の1回だけ）", async () => {
    const s = setup();
    mkdirSync(s.target); // 空のフォルダ
    let calls = 0;
    const removed: string[] = [];
    await run(s.cwd, {
      rename: async (a, b) => {
        calls += 1;
        if (calls <= 3) throw eperm();
        await realRename(a, b);
      },
      sleep: async () => {},
      rm: async (p) => {
        removed.push(`rm:${p}`);
      },
      rmdir: async (p) => {
        if (same(p, s.target)) removed.push(`rmdir:${p}`);
        await realRmdir(p);
      },
    });
    expect(removed.filter((p) => p.startsWith("rmdir:"))).toHaveLength(1);
    expect(removed.filter((p) => p.startsWith("rm:"))).toEqual([]);
    expect(Object.keys(tree(s.target)).length).toBe(FILES.length);
  });

  it("#34 R1: 再試行の上限を超えたら、一時的な場所と、自分が作った生成先を消してエラー（回数は有限）", async () => {
    for (const make of [eperm, ebusy]) {
      const s = setup();
      let calls = 0;
      await expect(
        run(s.cwd, {
          rename: async () => {
            calls += 1;
            throw make();
          },
          sleep: async () => {},
        }),
      ).rejects.toThrow(GenerateError);
      expect(calls).toBeGreaterThanOrEqual(3);
      expect(calls).toBeLessThanOrEqual(20);
      expect(readdirSync(s.cwd)).toEqual([]);
    }
  });

  it("#34 R1: 再試行しないエラー（EACCES など）は、1回で諦めて、一時的な場所と自分が作った生成先を消してエラー", async () => {
    const s = setup();
    let calls = 0;
    await expect(
      run(s.cwd, {
        rename: async () => {
          calls += 1;
          throw Object.assign(new Error("EACCES (fake)"), { code: "EACCES" });
        },
        sleep: async () => {},
      }),
    ).rejects.toThrow(/EACCES/);
    expect(calls).toBe(1);
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it("#34 R1: 項目の移動の途中で失敗（3つ目の項目が EACCES）したら、移した項目と自分が作った生成先、一時的な場所のすべてが残らない", async () => {
    const s = setup();
    let calls = 0;
    await expect(
      run(s.cwd, {
        rename: async (a, b) => {
          calls += 1;
          if (calls === 3) throw Object.assign(new Error("EACCES (fake)"), { code: "EACCES" });
          await realRename(a, b);
        },
        sleep: async () => {},
      }),
    ).rejects.toThrow(/EACCES/);
    expect(calls).toBe(3);
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it("#34 R1: 項目の移動の途中の失敗でも、元からあった空のフォルダは「空のフォルダ」のまま（中身は何も残らない）", async () => {
    const s = setup();
    mkdirSync(s.target);
    let calls = 0;
    await expect(
      run(s.cwd, {
        rename: async (a, b) => {
          calls += 1;
          if (calls === 2) throw Object.assign(new Error("EACCES (fake)"), { code: "EACCES" });
          await realRename(a, b);
        },
      }),
    ).rejects.toThrow(/EACCES/);
    expect(readdirSync(s.cwd).filter((name) => name.startsWith("."))).toEqual([]);
    if (existsSync(s.target)) expect(readdirSync(s.target)).toEqual([]);
  });
});

describe("#34 R1: 生成先の確認が失敗したときは、その原因を伝える（言い換えない）", () => {
  const eacces = () =>
    Object.assign(new Error("EACCES: permission denied (fake)"), { code: "EACCES" });

  it("#34 R1: lstat が権限のエラー（EACCES）で失敗したら、そのエラーの内容が伝わる。「別のものが置かれた」にはしない。何も作らない", async () => {
    const s = setup();
    const err = (await run(s.cwd, {
      lstat: async (p) => {
        if (same(p, s.target)) throw eacces();
        return realLstat(p);
      },
    }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(GenerateError);
    expect(err.message).toContain("EACCES");
    expect(err.message).not.toMatch(/置かれ/);
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it("#34 R1: readdir が EACCES で失敗したときも、同じ（原因が伝わり、何も作らない）", async () => {
    const s = setup();
    mkdirSync(s.target);
    const err = (await run(s.cwd, {
      readdir: async () => {
        throw eacces();
      },
    }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(GenerateError);
    expect(err.message).toContain("EACCES");
    expect(err.message).not.toMatch(/置かれ/);
    expect(readdirSync(s.cwd).filter((name) => name.startsWith("."))).toEqual([]);
    expect(readdirSync(s.target)).toEqual([]);
  });

  it("#34 R1: 確認の失敗は、ENOENT（なし）のときだけ「生成先がない」と扱い、ほかのコードは伝える（EPERM・EBUSY も）", async () => {
    for (const make of [eperm, ebusy]) {
      const s = setup();
      const err = (await run(s.cwd, {
        lstat: async (p) => {
          if (same(p, s.target)) throw make();
          return realLstat(p);
        },
      }).catch((e: unknown) => e)) as Error;
      expect(err).toBeInstanceOf(GenerateError);
      expect(err.message).toMatch(/EPERM|EBUSY/);
      expect(readdirSync(s.cwd)).toEqual([]);
    }
  });
});

describe("#34 R2: 中断の要求（signal）", () => {
  /** rename の後に、一時的な場所に項目が残っていなければ「最後の項目」 */
  const isLastMove = async (from: string) => (await realReaddir(path.dirname(from))).length === 0;
  it("#34 R2: 書き込みの途中で要求を受けたら、進行中の書き込みが終わるのを待って止まり、何も残らない（GenerationInterrupted）", async () => {
    const s = setup();
    const ac = new AbortController();
    let n = 0;
    await expect(
      run(
        s.cwd,
        {
          writeFile: async (f, c) => {
            n += 1;
            await realWriteFile(f, c, "utf8");
            if (n === 2) ac.abort();
          },
        },
        { signal: ac.signal },
      ),
    ).rejects.toBeInstanceOf(GenerationInterrupted);
    expect(n).toBe(2); // 要求の後に、次の書き込みは始めない
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it("#34 R2: 書き込みが始まる前から要求がある場合も、何も作らずに止まる", async () => {
    const s = setup();
    const ac = new AbortController();
    ac.abort();
    let n = 0;
    await expect(
      run(
        s.cwd,
        {
          writeFile: async (f, c) => {
            n += 1;
            await realWriteFile(f, c, "utf8");
          },
        },
        { signal: ac.signal },
      ),
    ).rejects.toBeInstanceOf(GenerationInterrupted);
    expect(n).toBe(0);
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it("#34 R2: 移動の再試行の途中（待ちの間）で要求を受けたら、それ以上 rename せずに、一時的な場所を消して止まる", async () => {
    const s = setup();
    const ac = new AbortController();
    let calls = 0;
    await expect(
      run(
        s.cwd,
        {
          rename: async () => {
            calls += 1;
            throw eperm();
          },
          sleep: async () => {
            ac.abort();
          },
        },
        { signal: ac.signal },
      ),
    ).rejects.toBeInstanceOf(GenerationInterrupted);
    expect(calls).toBe(1);
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it("#34 R2: 元からある空のフォルダを rmdir で消している最中に要求を受けたら、移動は始まらず、一時的な場所が片付く", async () => {
    const s = setup();
    mkdirSync(s.target);
    const ac = new AbortController();
    let renames = 0;
    await expect(
      run(
        s.cwd,
        {
          rmdir: async (p) => {
            await realRmdir(p);
            if (same(p, s.target)) ac.abort();
          },
          rename: async (a, b) => {
            renames += 1;
            await realRename(a, b);
          },
        },
        { signal: ac.signal },
      ),
    ).rejects.toBeInstanceOf(GenerationInterrupted);
    expect(renames).toBe(0);
    expect(readdirSync(s.cwd).filter((name) => name.startsWith("."))).toEqual([]);
    if (existsSync(s.target)) expect(readdirSync(s.target)).toEqual([]);
  });

  it("#34 R2: 移動の再試行の各試行の直前にも、要求を確かめる（失敗した rename の中で要求を受けたら、待ちの後に rename し直さない）", async () => {
    const s = setup();
    const ac = new AbortController();
    let calls = 0;
    await expect(
      run(
        s.cwd,
        {
          rename: async () => {
            calls += 1;
            ac.abort();
            throw eperm();
          },
          sleep: async () => {},
        },
        { signal: ac.signal },
      ),
    ).rejects.toBeInstanceOf(GenerationInterrupted);
    expect(calls).toBe(1);
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it("#34 R2: 項目の移動の途中（最初の項目の移動の後）で要求を受けたら、移した項目と自分が作った生成先、一時的な場所のすべてが残らない。それ以上は移さない", async () => {
    const s = setup();
    const ac = new AbortController();
    let renames = 0;
    await expect(
      run(
        s.cwd,
        {
          rename: async (a, b) => {
            renames += 1;
            await realRename(a, b);
            if (renames === 1) ac.abort();
          },
        },
        { signal: ac.signal },
      ),
    ).rejects.toBeInstanceOf(GenerationInterrupted);
    expect(renames).toBe(1);
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it("#34 R2: 元からある空のフォルダがあるときの、項目の移動の途中の中断：移した項目は残らない（フォルダは空かなし）。一時的な場所も残らない", async () => {
    const s = setup();
    mkdirSync(s.target);
    const ac = new AbortController();
    let renames = 0;
    await expect(
      run(
        s.cwd,
        {
          rename: async (a, b) => {
            renames += 1;
            await realRename(a, b);
            if (renames === 2) ac.abort();
          },
        },
        { signal: ac.signal },
      ),
    ).rejects.toBeInstanceOf(GenerationInterrupted);
    expect(readdirSync(s.cwd).filter((name) => name.startsWith("."))).toEqual([]);
    if (existsSync(s.target)) expect(readdirSync(s.target)).toEqual([]);
  });

  it("#34 R2: 最後の項目の移動が成功した直後に要求を受けたら、生成は完了したものとして、生成先を消さない（interrupted: true）。一時的な場所は消えている", async () => {
    const s = setup();
    const ac = new AbortController();
    const out = await run(
      s.cwd,
      {
        rename: async (a, b) => {
          await realRename(a, b);
          if (await isLastMove(a)) ac.abort();
        },
      },
      { signal: ac.signal },
    );
    expect(out).toEqual({ dir: s.target, interrupted: true });
    expect(Object.keys(tree(s.target)).sort()).toEqual(FILES.map((f) => f.path).sort());
    expect(readdirSync(s.cwd)).toEqual([APP]);
  });

  it("#34 R2: 最後の項目の移動の後の、空になった一時的な場所の rmdir の最中に要求を受けても、完成として残る", async () => {
    const s = setup();
    const ac = new AbortController();
    const out = await run(
      s.cwd,
      {
        rmdir: async (p) => {
          await realRmdir(p);
          ac.abort();
        },
      },
      { signal: ac.signal },
    );
    expect(out.interrupted).toBe(true);
    expect(Object.keys(tree(s.target)).sort()).toEqual(FILES.map((f) => f.path).sort());
    expect(readdirSync(s.cwd)).toEqual([APP]);
  });

  it("#34 R2: 要求がなければ interrupted は false", async () => {
    const s = setup();
    const ac = new AbortController();
    expect((await run(s.cwd, undefined, { signal: ac.signal })).interrupted).toBe(false);
  });

  it("#34 R2: 中断で止めたとき、一時的な場所を消せなければ、その場所を示すエラーにする", async () => {
    const s = setup();
    const ac = new AbortController();
    let n = 0;
    await expect(
      run(
        s.cwd,
        {
          writeFile: async (f, c) => {
            n += 1;
            await realWriteFile(f, c, "utf8");
            if (n === 2) ac.abort();
          },
          rm: async () => {
            throw ebusy();
          },
        },
        { signal: ac.signal },
      ),
    ).rejects.toThrow(new RegExp(TMP_PREFIX.replaceAll(".", "\\.")));
  });
});
