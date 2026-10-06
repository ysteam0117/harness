// #35 原子的な適用（applyUpdate）。一時フォルダだけで試す。想定する型：src/update/apply.ts
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { rename as realRename } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyUpdate,
  ChangedAfterJudgment,
  RollbackIncomplete,
  UpdateInterrupted,
  rawSha,
  type ApplyOp,
  type UpdateFs,
} from "../../src/update/apply.js";
import { cleanupRoots, newRoot } from "./helpers.js";

afterEach(cleanupRoots);

const ORIGINAL = {
  "a.txt": "元の A\n",
  "b.txt": "元の B\n",
  "c.txt": "触らない C\n",
  ".harness/config.yaml": "元の設定\n",
} as const;

function setup(): { root: string; ops: ApplyOp[] } {
  const root = newRoot();
  for (const [rel, text] of Object.entries(ORIGINAL)) {
    const full = path.join(root, ...rel.split("/"));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  const replace = (rel: keyof typeof ORIGINAL, content: string): ApplyOp => ({
    kind: "replace",
    path: rel,
    content,
    expected: rawSha(ORIGINAL[rel]),
  });
  return {
    root,
    ops: [
      replace("a.txt", "新しい A\n"),
      replace("b.txt", "新しい B\n"),
      { kind: "create", path: "sub/d.txt", content: "新しい D\n" },
      replace(".harness/config.yaml", "新しい設定\n"),
    ],
  };
}

const read = (root: string, rel: string): string =>
  readFileSync(path.join(root, ...rel.split("/")), "utf8");

/** 元のまま（一時的な場所も退避も残っていない） */
function expectUntouched(root: string): void {
  for (const [rel, text] of Object.entries(ORIGINAL)) expect(read(root, rel), rel).toBe(text);
  expect(existsSync(path.join(root, "sub", "d.txt"))).toBe(false);
  expect(readdirSync(path.join(root, ".harness"))).toEqual(["config.yaml"]);
}

function renameFailing(
  shouldFail: (from: string, to: string) => boolean,
  before?: (from: string, to: string) => void,
): { fs: Partial<UpdateFs>; count: () => number } {
  let count = 0;
  return {
    fs: {
      rename: async (from, to) => {
        count += 1;
        before?.(from, to);
        if (shouldFail(from, to))
          throw Object.assign(new Error("名前の変更に失敗（テスト）"), { code: "EIO" });
        await realRename(from, to);
      },
    },
    count: () => count,
  };
}

describe("#35 適用：成功", () => {
  it("#35 AC-1: 置き換え・新規の作成ができ、config.yaml も入れ替わり、一時的な場所と退避が残らない", async () => {
    const { root, ops } = setup();
    const result = await applyUpdate({ root, ops });
    expect(result.cleanupWarnings).toEqual([]);
    expect(read(root, "a.txt")).toBe("新しい A\n");
    expect(read(root, "b.txt")).toBe("新しい B\n");
    expect(read(root, "sub/d.txt")).toBe("新しい D\n");
    expect(read(root, ".harness/config.yaml")).toBe("新しい設定\n");
    expect(read(root, "c.txt")).toBe(ORIGINAL["c.txt"]);
    expect(readdirSync(path.join(root, ".harness"))).toEqual(["config.yaml"]);
  });

  it.skipIf(process.platform === "win32")(
    "#35 R4: executable の置き換え・新規は、書いた後に実行権限（0o755）が付く",
    async () => {
      const { root } = setup();
      await applyUpdate({
        root,
        ops: [
          {
            kind: "replace",
            path: "a.txt",
            content: "#!/bin/sh\n",
            executable: true,
            expected: rawSha(ORIGINAL["a.txt"]),
          },
          { kind: "create", path: "hooks/pre-commit", content: "#!/bin/sh\n", executable: true },
        ],
      });
      expect(statSync(path.join(root, "a.txt")).mode & 0o111).toBe(0o111);
      expect(statSync(path.join(root, "hooks", "pre-commit")).mode & 0o111).toBe(0o111);
    },
  );
});

describe("#35 適用：途中で失敗しても元に戻る", () => {
  it("#35 AC-4: どの rename で失敗させても、すべてのファイルが元のバイト列のまま。一時的な場所も退避も残らない", async () => {
    const probe = setup();
    const counter = renameFailing(() => false);
    await applyUpdate({ root: probe.root, ops: probe.ops, fs: counter.fs });
    const total = counter.count();
    expect(total).toBeGreaterThanOrEqual(7);
    for (let n = 1; n <= total; n += 1) {
      const { root, ops } = setup();
      let calls = 0;
      const failing = renameFailing(() => (calls += 1) === n);
      await expect(
        applyUpdate({ root, ops, fs: failing.fs }),
        `rename ${String(n)} 回目`,
      ).rejects.toThrow(/元に戻しました/);
      expectUntouched(root);
    }
  });

  it("#35 どの writeFile で失敗させても、元のまま", async () => {
    const probe = setup();
    let total = 0;
    await applyUpdate({
      root: probe.root,
      ops: probe.ops,
      fs: {
        writeFile: async (file, content) => {
          total += 1;
          const { writeFile } = await import("node:fs/promises");
          await writeFile(file, content);
        },
      },
    });
    expect(total).toBe(4);
    for (let n = 1; n <= total; n += 1) {
      const { root, ops } = setup();
      let calls = 0;
      await expect(
        applyUpdate({
          root,
          ops,
          fs: {
            writeFile: async (file, content) => {
              if ((calls += 1) === n) throw new Error("書き込みに失敗（テスト）");
              const { writeFile } = await import("node:fs/promises");
              await writeFile(file, content);
            },
          },
        }),
        `writeFile ${String(n)} 回目`,
      ).rejects.toThrow(/元に戻しました/);
      expectUntouched(root);
    }
  });

  it("#35 中断（AbortSignal）でも、どの時点でも、元のまま（UpdateInterrupted）", async () => {
    const probe = setup();
    const counter = renameFailing(() => false);
    await applyUpdate({ root: probe.root, ops: probe.ops, fs: counter.fs });
    const total = counter.count();
    for (let n = 1; n <= total; n += 1) {
      const { root, ops } = setup();
      const controller = new AbortController();
      let calls = 0;
      const fs = renameFailing(
        () => false,
        () => {
          if ((calls += 1) === n) controller.abort();
        },
      );
      // n 回目の rename の後に中断が検知される。最後の rename の後の中断は完了として扱ってよい
      const run = applyUpdate({ root, ops, fs: fs.fs, signal: controller.signal });
      if (n === total) {
        await run.catch((e: unknown) => expect(e).toBeInstanceOf(UpdateInterrupted));
      } else {
        await expect(run, `中断 ${String(n)}`).rejects.toBeInstanceOf(UpdateInterrupted);
        expectUntouched(root);
      }
    }
  });

  it("#35 R3: 失敗の後の復元（rename）も失敗したら、退避を消さずに残し、元の内容の場所を案内して、RollbackIncomplete", async () => {
    const { root, ops } = setup();
    let calls = 0;
    const fs = renameFailing((from, to) => {
      calls += 1;
      // b の新しい内容を置く rename で失敗させ、さらに a を退避から戻す rename も失敗させる
      const isRestoreOfA = from.includes(".update-backup-") && to.endsWith("a.txt");
      return isRestoreOfA || calls === 4;
    });
    const error = await applyUpdate({ root, ops, fs: fs.fs }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RollbackIncomplete);
    const message = (error as RollbackIncomplete).message;
    expect(message).toContain("元に戻せなかったファイル");
    expect(message).toContain("a.txt");
    const backupDir = (error as RollbackIncomplete).backupDir;
    expect(message).toContain(backupDir);
    expect(readFileSync(path.join(backupDir, "a.txt"), "utf8")).toBe(ORIGINAL["a.txt"]);
    // 一時的な場所（新しい内容）は消えている。ほかのファイルは元に戻っている
    expect(
      readdirSync(path.join(root, ".harness")).filter((n) => n.includes("update-tmp")),
    ).toEqual([]);
    expect(read(root, "b.txt")).toBe(ORIGINAL["b.txt"]);
    expect(read(root, "c.txt")).toBe(ORIGINAL["c.txt"]);
    expect(read(root, ".harness/config.yaml")).toBe(ORIGINAL[".harness/config.yaml"]);
  });
});

describe("#35 適用：判定の後・適用の途中・復元の直前の編集を失わない", () => {
  it("#35 R5: 適用の直前に、置き換える対象が変わっていれば、何も書かずに止まる（ChangedAfterJudgment）", async () => {
    const { root, ops } = setup();
    writeFileSync(path.join(root, "b.txt"), "判定の後に利用者が編集\n");
    await expect(applyUpdate({ root, ops })).rejects.toBeInstanceOf(ChangedAfterJudgment);
    expect(read(root, "a.txt")).toBe(ORIGINAL["a.txt"]);
    expect(read(root, "b.txt")).toBe("判定の後に利用者が編集\n");
    expect(readdirSync(path.join(root, ".harness"))).toEqual(["config.yaml"]);
  });

  it("#35 R5: 新しく作る場所に、判定の後にファイルができていたら、止まる（上書きしない）", async () => {
    const { root, ops } = setup();
    mkdirSync(path.join(root, "sub"));
    writeFileSync(path.join(root, "sub", "d.txt"), "利用者が作った\n");
    await expect(applyUpdate({ root, ops })).rejects.toBeInstanceOf(ChangedAfterJudgment);
    expect(read(root, "sub/d.txt")).toBe("利用者が作った\n");
    expectUntouchedExceptSub(root);
  });

  it("#35 R5: 残すことにしたファイル（checks）が判定の後に変わったときも、止まる", async () => {
    const { root, ops } = setup();
    await expect(
      applyUpdate({ root, ops, checks: [{ path: "c.txt", sha: rawSha("別の中身\n") }] }),
    ).rejects.toBeInstanceOf(ChangedAfterJudgment);
    expectUntouched(root);
  });

  it("#35 R7: 改行だけ（LF→CRLF）の変更も、生のバイト列の指紋で検知して止まる。変えた中身が残る", async () => {
    const { root, ops } = setup();
    writeFileSync(path.join(root, "a.txt"), "元の A\r\n");
    await expect(applyUpdate({ root, ops })).rejects.toBeInstanceOf(ChangedAfterJudgment);
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("元の A\r\n");
  });

  it("#35 R6(a): 入れ替えの途中（2つ目の対象を退避する直前）に、その対象を編集 → 適用が止まり、編集が残り、1つ目は元に戻る", async () => {
    const { root, ops } = setup();
    let calls = 0;
    const fs = renameFailing(
      () => false,
      () => {
        if ((calls += 1) === 3) writeFileSync(path.join(root, "b.txt"), "途中の編集\n");
      },
    );
    await expect(applyUpdate({ root, ops, fs: fs.fs })).rejects.toBeInstanceOf(
      ChangedAfterJudgment,
    );
    expect(read(root, "b.txt")).toBe("途中の編集\n");
    expect(read(root, "a.txt")).toBe(ORIGINAL["a.txt"]);
    expect(read(root, ".harness/config.yaml")).toBe(ORIGINAL[".harness/config.yaml"]);
    expect(existsSync(path.join(root, "sub", "d.txt"))).toBe(false);
    expect(readdirSync(path.join(root, ".harness"))).toEqual(["config.yaml"]);
  });

  it("#35 R6(b): 失敗の後の復元の直前に、入れ替え済みのファイルを編集 → 上書きせず、退避を残し、両方の場所を案内する", async () => {
    const { root, ops } = setup();
    let calls = 0;
    const fs = renameFailing(
      () => calls === 4,
      () => {
        calls += 1;
        if (calls === 4) writeFileSync(path.join(root, "a.txt"), "復元の直前の編集\n");
      },
    );
    const error = await applyUpdate({ root, ops, fs: fs.fs }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RollbackIncomplete);
    const e = error as RollbackIncomplete;
    expect(read(root, "a.txt")).toBe("復元の直前の編集\n");
    expect(readFileSync(path.join(e.backupDir, "a.txt"), "utf8")).toBe(ORIGINAL["a.txt"]);
    expect(e.message).toContain("a.txt");
    expect(e.message).toContain(e.backupDir);
    expect(read(root, "b.txt")).toBe(ORIGINAL["b.txt"]);
  });

  it("#35 R6(c): config.yaml も同じ。置く rename で失敗し、元の場所に利用者のファイルができていたら、上書きせず、退避に元の内容が残る", async () => {
    const { root, ops } = setup();
    const fs = renameFailing(
      (from, to) => from.includes(".update-tmp-") && to.endsWith("config.yaml"),
      (from, to) => {
        if (from.includes(".update-tmp-") && to.endsWith("config.yaml")) {
          writeFileSync(path.join(root, ".harness", "config.yaml"), "利用者が保存した設定\n");
        }
      },
    );
    const error = await applyUpdate({ root, ops, fs: fs.fs }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RollbackIncomplete);
    const e = error as RollbackIncomplete;
    expect(read(root, ".harness/config.yaml")).toBe("利用者が保存した設定\n");
    expect(readFileSync(path.join(e.backupDir, ".harness", "config.yaml"), "utf8")).toBe(
      ORIGINAL[".harness/config.yaml"],
    );
    // 先に入れ替えた a・b は元に戻る
    expect(read(root, "a.txt")).toBe(ORIGINAL["a.txt"]);
    expect(read(root, "b.txt")).toBe(ORIGINAL["b.txt"]);
  });
});

function expectUntouchedExceptSub(root: string): void {
  for (const [rel, text] of Object.entries(ORIGINAL)) expect(read(root, rel), rel).toBe(text);
  expect(readdirSync(path.join(root, ".harness"))).toEqual(["config.yaml"]);
}

describe("#35 適用：安全（生成先の外に書かない）", () => {
  it("#35 安全: ../ を含むパス・絶対パスの操作は、何も書かずにエラー", async () => {
    for (const bad of ["../evil.txt", "/evil.txt", "a/../../evil.txt"]) {
      const { root } = setup();
      await expect(
        applyUpdate({ root, ops: [{ kind: "create", path: bad, content: "x\n" }] }),
        bad,
      ).rejects.toThrow();
      expect(existsSync(path.join(path.dirname(root), "evil.txt"))).toBe(false);
    }
  });

  it("#35 安全: 途中のフォルダがリンク（ジャンクション）なら、拒む。リンクの先には何も書かない", async () => {
    const { root } = setup();
    const outside = newRoot();
    writeFileSync(path.join(outside, "keep.txt"), "外の中身\n");
    symlinkSync(outside, path.join(root, "linked"), "junction");
    await expect(
      applyUpdate({ root, ops: [{ kind: "create", path: "linked/new.txt", content: "x\n" }] }),
    ).rejects.toThrow(/リンク/);
    expect(readdirSync(outside)).toEqual(["keep.txt"]);
  });
});
