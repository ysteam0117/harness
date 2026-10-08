// #20 harness adopt のブランチ作成(src/adopt/git.ts)。偽の git で、止める条件と、続ける条件を確かめる。
import { describe, expect, it } from "vitest";
import {
  branchNameFor,
  createBranch,
  ensureOnBranch,
  parseIssue,
  prepareBranch,
} from "../../src/adopt/git.js";
import { fakeGit } from "./git-helpers.js";

const ROOT = "/proj/sample-app";

describe("#20 AC-4: --issue と、ブランチの名前", () => {
  it("#20 AC-4: 正の整数だけを受け取る(数字の文字列も可)", () => {
    expect(parseIssue(12)).toBe(12);
    expect(parseIssue("12")).toBe(12);
    expect(parseIssue("007")).toBe(7);
    for (const bad of [
      0,
      -1,
      1.5,
      "0",
      "-3",
      "abc",
      "12abc",
      "1e3",
      "",
      " ",
      "1.5",
      NaN,
      null,
      undefined,
    ]) {
      expect(parseIssue(bad), String(bad)).toBeUndefined();
    }
  });

  it("#20 AC-4: 名前は chore/<番号>-adopt-harness", () => {
    expect(branchNameFor(12)).toBe("chore/12-adopt-harness");
  });
});

describe("#20 AC-4: prepareBranch(書く前の検査)", () => {
  it("#20 AC-4: きれいな main なら、続ける。何も書き換える git は実行しない", async () => {
    const g = fakeGit();
    const r = await prepareBranch(g.runGit, ROOT, 12);
    expect(r).toEqual({
      ok: true,
      plan: { name: "chore/12-adopt-harness", from: "main", alreadyOn: false },
    });
    expect(g.calls.some((c) => c[0] === "switch" || c[0] === "checkout" || c[0] === "commit")).toBe(
      false,
    );
  });

  it("#20 AC-4: git のフォルダでなければ止める", async () => {
    const r = await prepareBranch(fakeGit({ inside: false }).runGit, ROOT, 12);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("Git");
  });

  it("#20 AC-4: 作業ツリーが汚れていれば止める(変更したファイルの名前は出さない)", async () => {
    const r = await prepareBranch(fakeGit({ dirty: " M src/a.ts\n?? b.txt\n" }).runGit, ROOT, 12);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("コミット");
      expect(r.message).not.toContain("a.ts");
    }
  });

  it("#20 AC-4: 同じ名前のブランチが別にあれば止める", async () => {
    const g = fakeGit({ existing: ["main", "chore/12-adopt-harness"] });
    const r = await prepareBranch(g.runGit, ROOT, 12);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("chore/12-adopt-harness");
  });

  it("#20 AC-4: 今いるブランチがちょうど同じ名前なら、続ける(作り直さない)", async () => {
    const g = fakeGit({
      branch: "chore/12-adopt-harness",
      existing: ["main", "chore/12-adopt-harness"],
    });
    const r = await prepareBranch(g.runGit, ROOT, 12);
    expect(r).toEqual({
      ok: true,
      plan: { name: "chore/12-adopt-harness", from: "chore/12-adopt-harness", alreadyOn: true },
    });
  });

  it("#20 AC-4: main 以外にいても続ける。分ける元を返す", async () => {
    const r = await prepareBranch(fakeGit({ branch: "feature/x-1" }).runGit, ROOT, 12);
    expect(r).toEqual({
      ok: true,
      plan: { name: "chore/12-adopt-harness", from: "feature/x-1", alreadyOn: false },
    });
  });

  it("#20 AC-4: HEAD が切り離されていても続ける(元は未設定)", async () => {
    const r = await prepareBranch(fakeGit({ branch: "" }).runGit, ROOT, 12);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.from).toBeUndefined();
  });
});

describe("#20 AC-4: 検査の範囲と、書く直前の確認", () => {
  it("#20 AC-4: 作業ツリーの検査は、リポジトリ全体(パス指定なし)", async () => {
    const g = fakeGit();
    await prepareBranch(g.runGit, ROOT, 12);
    const status = g.calls.find((c) => c[0] === "status") ?? [];
    expect(status).not.toContain("--");
    expect(status).not.toContain(".");
    // 利用者の設定（status.showUntrackedFiles=no）に左右されず、未追跡のファイルも見る
    expect(status).toContain("--untracked-files=all");
  });

  it("#20 AC-4: ensureOnBranch：今のブランチが導入用ブランチなら続け、違えば理由を返す", async () => {
    const on = fakeGit({ branch: "chore/12-adopt-harness" });
    expect(await ensureOnBranch(on.runGit, ROOT, "chore/12-adopt-harness")).toEqual({ ok: true });
    const off = fakeGit({ branch: "main" });
    const r = await ensureOnBranch(off.runGit, ROOT, "chore/12-adopt-harness");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("chore/12-adopt-harness");
  });
});

describe("#20 AC-4: createBranch", () => {
  it("#20 AC-4: git switch -c <名前> を実行する", async () => {
    const g = fakeGit();
    const r = await createBranch(g.runGit, ROOT, {
      name: "chore/12-adopt-harness",
      from: "main",
      alreadyOn: false,
    });
    expect(r).toEqual({ ok: true });
    expect(g.calls).toContainEqual(["switch", "-c", "chore/12-adopt-harness"]);
  });

  it("#20 AC-4: すでにそのブランチにいれば、何も実行しない", async () => {
    const g = fakeGit();
    const r = await createBranch(g.runGit, ROOT, {
      name: "chore/12-adopt-harness",
      from: "chore/12-adopt-harness",
      alreadyOn: true,
    });
    expect(r).toEqual({ ok: true });
    expect(g.calls).toEqual([]);
  });

  it("#20 AC-4: 失敗したら理由を返す", async () => {
    const g = fakeGit({ switchCode: 128 });
    const r = await createBranch(g.runGit, ROOT, {
      name: "chore/12-adopt-harness",
      from: "main",
      alreadyOn: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("chore/12-adopt-harness");
  });
});
