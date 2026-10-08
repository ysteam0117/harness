// #17 コードレビュー3回目の指摘：gitleaks は読めないファイル・フォルダを黙って飛ばすため、作業フォルダの確認の前に、
// 同じイメージ・同じマウントで、読めないものが無いかを調べる。本物の docker・git は使わない（実行役を差し替える）。
// ダミーの値は、実行時に連結して作る。実データ・個人名は使わない（架空の値だけ）。
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UNREADABLE_SCRIPT, scanSecrets } from "../../src/adopt/secret-scan.js";
import { DUMMY, fakeRunner, ok } from "./secret-scan-helpers.js";

const tmpRoots: string[] = [];
const tmp = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harness-scan-r3-"));
  tmpRoots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const clean = { worktree: { exit: 0, report: "[]" } } as const;

describe("#17 R3-1：読めないファイル・フォルダの調べ", () => {
  it("無し（0 件）：続けて、作業フォルダの確認をする", async () => {
    const { runner, calls } = fakeRunner({ ...clean, readable: ok({ stdout: "0" }) });
    const result = await scanSecrets(tmp(), { runner });
    expect(result).toMatchObject({ kind: "clean" });
    expect(calls.filter((c) => c.args.includes("--entrypoint"))).toHaveLength(1);
  });

  it("あり：unreadable（件数だけ）。作業フォルダの確認は始めない。名前は出ない", async () => {
    const { runner, calls } = fakeRunner({ ...clean, readable: ok({ stdout: "3" }) });
    const result = await scanSecrets(tmp(), { runner });
    expect(result).toEqual({ kind: "unreadable", count: 3 });
    expect(calls.some((c) => c.args.includes("dir"))).toBe(false);
  });

  it("調べの出力に名前（値）が混ざっても、結果に出ない", async () => {
    const { runner } = fakeRunner({ ...clean, readable: ok({ stdout: `2\n${DUMMY}` }) });
    const result = await scanSecrets(tmp(), { runner });
    expect(result.kind).toBe("failed");
    expect(JSON.stringify(result)).not.toContain(DUMMY);
  });

  const failures: [string, ReturnType<typeof ok>][] = [
    ["起動失敗", ok({ failedToStart: true, exitCode: null })],
    ["時間切れ", ok({ timedOut: true, exitCode: null })],
    ["終了コード 1", ok({ exitCode: 1, stdout: "0" })],
    ["件数が読めない", ok({ stdout: "abc" })],
    ["出力が空", ok({ stdout: "" })],
    ["負の数", ok({ stdout: "-1" })],
  ];
  it.each(failures)("調べ自体の失敗（%s）：failed", async (_n, readable) => {
    const { runner } = fakeRunner({ ...clean, readable });
    const result = await scanSecrets(tmp(), { runner });
    expect(result.kind).toBe("failed");
  });

  it("調べの失敗でも、コンテナを探して消す。正常なら探さない", async () => {
    const a = fakeRunner({ ...clean, readable: ok({ exitCode: 125 }) });
    await scanSecrets(tmp(), { runner: a.runner });
    expect(a.calls.some((c) => c.args[0] === "ps")).toBe(true);
    const b = fakeRunner({ ...clean });
    await scanSecrets(tmp(), { runner: b.runner });
    expect(b.calls.some((c) => c.args[0] === "ps")).toBe(false);
  });

  it("同じ条件：ネットワークなし・読み取り専用・同じイメージ。一時フォルダは残らない", async () => {
    const parent = tmp();
    const { runner, calls } = fakeRunner(clean);
    await scanSecrets(tmp(), { runner, tmpDir: parent });
    const check = calls.find((c) => c.args.includes("--entrypoint"));
    const scan = calls.find((c) => c.args.includes("dir"));
    expect(check?.args[check.args.indexOf("--network") + 1]).toBe("none");
    expect(check?.args.some((a) => a.endsWith(":/src:ro"))).toBe(true);
    const image = scan?.args[scan.args.indexOf("dir") - 1];
    expect(check?.args).toContain(image);
    expect(check?.args.some((a) => a.endsWith(":/out"))).toBe(false);
    expect(readdirSync(parent)).toEqual([]);
  });

  it("調べのスクリプトは、.git を除き、名前を出さない（件数だけ）", () => {
    expect(UNREADABLE_SCRIPT).toContain("/src/.git");
    expect(UNREADABLE_SCRIPT).toContain("wc -l");
    // find の出力（-print）は wc にだけつなぐ。標準エラーも名前を含むため、捨てるか wc にだけつなぐ
    expect(UNREADABLE_SCRIPT).not.toMatch(/cat |echo "?\$[a-z]*"?$/m);
  });
});
