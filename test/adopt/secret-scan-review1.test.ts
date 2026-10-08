// #17 コードレビュー1回目の指摘（R1〜R4）。本物の docker・git は使わない（実行役を差し替える）。
// ダミーの値は、実行時に連結して作る。実データ・個人名は使わない（架空の値だけ）。
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPORT_TEMPLATE, parseLeakReport, scanSecrets } from "../../src/adopt/secret-scan.js";
import { CancelledError } from "../../src/questions/prompter.js";
import { DUMMY, fakeRunner, NOT_GIT, ok, reportItem, reportOf } from "./secret-scan-helpers.js";

const tmpRoots: string[] = [];
const tmp = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harness-scan-r1-"));
  tmpRoots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("#17 R1：レポートの生成の時点で、許可した4項目だけを出す", () => {
  it("テンプレートが参照するのは File・StartLine・Commit・RuleID だけ", () => {
    const used = [...REPORT_TEMPLATE.matchAll(/\$f\.(\w+)/g)].map((m) => m[1] ?? "");
    expect([...new Set(used)].sort()).toEqual(["Commit", "File", "RuleID", "StartLine"]);
    // テンプレートの中で、$f の項目はこの4つ以外に出てこない
    const dots = [...REPORT_TEMPLATE.matchAll(/\.(\w+)/g)].map((m) => m[1] ?? "");
    for (const name of dots) {
      expect(["Commit", "File", "RuleID", "StartLine"]).toContain(name);
    }
    for (const banned of [
      "Secret",
      "Match",
      "Message",
      "Author",
      "Email",
      "Description",
      "Line\b",
    ]) {
      expect(REPORT_TEMPLATE).not.toMatch(new RegExp(banned));
    }
  });

  it("scanSecrets は、テンプレートを一時フォルダ（/out 側）に置いてから実行する", async () => {
    const root = tmp();
    const parent = tmp();
    let seen = "";
    const { runner } = fakeRunner({ worktree: { exit: 0, report: "[]" } });
    await scanSecrets(root, {
      tmpDir: parent,
      runner: (command, args, options) => {
        const out = args.find((a) => a.endsWith(":/out"))?.slice(0, -":/out".length);
        if (out !== undefined) seen = readFileSync(path.join(out, "report.tmpl"), "utf8");
        return runner(command, args, options);
      },
    });
    expect(seen).toBe(REPORT_TEMPLATE);
  });
});

describe("#17 R2：git の判定の失敗を「git ではない」と扱わない", () => {
  const cases: [string, ReturnType<typeof ok>][] = [
    ["起動失敗", ok({ failedToStart: true, exitCode: null })],
    ["時間切れ", ok({ timedOut: true, exitCode: null })],
    [
      "所有権の拒否",
      ok({ exitCode: 128, stderr: `fatal: detected dubious ownership in repository ${DUMMY}` }),
    ],
    ["アクセス権の拒否", ok({ exitCode: 128, stderr: "fatal: Permission denied" })],
    ["想定外の終了コード", ok({ exitCode: 1, stderr: NOT_GIT })],
    ["終了コード 0 で出力が空", ok({ exitCode: 0, stdout: "" })],
    ["終了コード 0 で出力が複数行", ok({ exitCode: 0, stdout: "a\nb\n" })],
    ["128 だが理由が読めない", ok({ exitCode: 128, stderr: "" })],
    [
      "リポジトリではないが、所有権の拒否も含む",
      ok({ exitCode: 128, stderr: `${NOT_GIT} dubious ownership` }),
    ],
  ];
  it.each(cases)("%s：failed（docker run を始めない。文に出力を入れない）", async (_name, top) => {
    const { runner, calls } = fakeRunner({ top });
    const result = await scanSecrets(tmp(), { runner });
    expect(result.kind).toBe("failed");
    expect(calls.some((c) => c.args[0] === "run")).toBe(false);
    expect(JSON.stringify(result)).not.toContain(DUMMY);
    expect(JSON.stringify(result)).not.toContain("dubious");
  });

  it("「リポジトリではない」と確かめられたときだけ worktree", async () => {
    const { runner } = fakeRunner({
      top: ok({ exitCode: 128, stderr: NOT_GIT }),
      worktree: { exit: 0, report: "[]" },
    });
    expect(await scanSecrets(tmp(), { runner })).toMatchObject({
      kind: "clean",
      scope: "worktree",
    });
  });

  it("git の判定は、英語のメッセージで読む（LC_ALL=C を渡す）", async () => {
    const seen: Record<string, string>[] = [];
    const { runner } = fakeRunner({ worktree: { exit: 0, report: "[]" } });
    await scanSecrets(tmp(), {
      runner: (command, args, options) => {
        if (command === "git") seen.push(options.env ?? {});
        return runner(command, args, options);
      },
    });
    expect(seen[0]?.["LC_ALL"]).toBe("C");
  });
});

describe("#17 R3：後始末の失敗を、固定の文で知らせる", () => {
  const timedOut = { exit: 0, over: { timedOut: true, exitCode: null } } as const;
  const scanWith = async (planned: Parameters<typeof fakeRunner>[0], extra = {}) => {
    const warnings: string[] = [];
    const { runner, calls } = fakeRunner(planned);
    const result = await scanSecrets(tmp(), {
      runner,
      onWarning: (m) => warnings.push(m),
      ...extra,
    });
    return { result, warnings, calls };
  };

  it("時間切れ：コンテナを探して消す。成功なら警告なし", async () => {
    const { result, warnings, calls } = await scanWith({ worktree: timedOut });
    expect(result.kind).toBe("failed");
    expect(calls.some((c) => c.args[0] === "rm")).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("docker rm -f が失敗・時間切れ・起動失敗：警告（値は入らない）", async () => {
    for (const rm of [
      ok({ exitCode: 1, stderr: DUMMY, stdout: DUMMY }),
      ok({ timedOut: true, exitCode: null }),
      ok({ failedToStart: true, exitCode: null }),
    ]) {
      const { warnings } = await scanWith({ worktree: timedOut, rm });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("コンテナ");
      expect(warnings.join("")).not.toContain(DUMMY);
    }
  });

  it("docker ps が失敗：警告", async () => {
    const { warnings } = await scanWith({ worktree: timedOut, ps: ok({ exitCode: 1 }) });
    expect(warnings).toHaveLength(1);
  });

  it("コンテナが残っていなければ、rm を呼ばず警告もない", async () => {
    const { warnings, calls } = await scanWith({ worktree: timedOut, ps: ok({ stdout: "" }) });
    expect(calls.some((c) => c.args[0] === "rm")).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("中断でも後始末をする（CancelledError は変わらず投げる）", async () => {
    const warnings: string[] = [];
    const { runner, calls } = fakeRunner({
      worktree: { exit: 0, over: { aborted: true, exitCode: null } },
      rm: ok({ exitCode: 1 }),
    });
    await expect(
      scanSecrets(tmp(), { runner, onWarning: (m) => warnings.push(m) }),
    ).rejects.toBeInstanceOf(CancelledError);
    expect(calls.some((c) => c.args[0] === "rm")).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it("正常に終わったときは、コンテナを探さない（--rm で消えている）", async () => {
    const { calls } = await scanWith({ worktree: { exit: 0, report: "[]" } });
    expect(calls.some((c) => c.args[0] === "ps")).toBe(false);
  });

  it("一時フォルダを消せない：警告（値は入らない）", async () => {
    const warnings: string[] = [];
    const { runner } = fakeRunner({ worktree: { exit: 0, report: "[]" } });
    const result = await scanSecrets(tmp(), {
      runner,
      onWarning: (m) => warnings.push(m),
      removeDir: () => Promise.reject(new Error(DUMMY)),
    });
    expect(result.kind).toBe("clean");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("一時フォルダ");
    expect(warnings.join("")).not.toContain(DUMMY);
  });
});

describe("#17 R4：.gitleaks.toml の案内は、実際にマウントするトップで決める", () => {
  const scanClean = (base: string, rootRel: string) => {
    const root = path.join(base, rootRel);
    mkdirSync(root, { recursive: true });
    const { runner } = fakeRunner({
      top: ok({ stdout: `${base}\n` }),
      history: { exit: 0, report: "[]" },
      worktree: { exit: 0, report: "[]" },
    });
    return scanSecrets(root, { runner });
  };

  it("トップにある：サブフォルダを指定しても true", async () => {
    const base = tmp();
    writeFileSync(path.join(base, ".gitleaks.toml"), "# 架空\n");
    expect(await scanClean(base, "sub")).toMatchObject({ kind: "clean", gitleaksConfig: true });
  });

  it("サブフォルダにだけある：false（マウントするのはトップ）", async () => {
    const base = tmp();
    mkdirSync(path.join(base, "sub"));
    writeFileSync(path.join(base, "sub", ".gitleaks.toml"), "# 架空\n");
    expect(await scanClean(base, "sub")).toMatchObject({ gitleaksConfig: false });
  });

  it("トップで実行：あれば true、無ければ false", async () => {
    const withToml = tmp();
    writeFileSync(path.join(withToml, ".gitleaks.toml"), "# 架空\n");
    expect(await scanClean(withToml, ".")).toMatchObject({ gitleaksConfig: true });
    expect(await scanClean(tmp(), ".")).toMatchObject({ gitleaksConfig: false });
  });

  it("git でない：そのフォルダの有無", async () => {
    const root = tmp();
    writeFileSync(path.join(root, ".gitleaks.toml"), "# 架空\n");
    const { runner } = fakeRunner({ worktree: { exit: 0, report: "[]" } });
    expect(await scanSecrets(root, { runner })).toMatchObject({ gitleaksConfig: true });
  });
});

describe("#17 R2-1：レポートの文字列は JSON としてエンコードされる", () => {
  it("テンプレートは Go の %q ではなく、JSON のエンコード（mustToJson）を使う", () => {
    expect(REPORT_TEMPLATE).not.toContain("%q");
    expect(REPORT_TEMPLATE).toContain("mustToJson");
  });

  it("日本語・空白・引用符・バックスラッシュ・制御文字（ESC・ベル・改行）を含む File を読める", () => {
    const bs = String.fromCharCode(92);
    const ch = (code: number): string => String.fromCharCode(code);
    const name = ["dir/", "日本 語", '"q"', bs, "b", ch(27), "e", ch(7), "c", ch(10), "n.txt"].join(
      "",
    );
    // gitleaks の mustToJson と同じ形（JSON のエンコード）の出力
    const text = `[{"RuleID":"r","File":${JSON.stringify(name)},"StartLine":1,"Commit":""}]`;
    const leaks = parseLeakReport(text);
    expect(leaks).toHaveLength(1);
    const shown = leaks[0]?.file ?? "";
    expect(shown).toContain("日本 語");
    expect(shown).toContain('"q"');
    expect(shown).toContain(bs + "b");
    expect(shown).toContain(bs + "x1b");
    expect(shown).toContain(bs + "x07");
    expect(shown).toContain(bs + "x0a");
    expect([...shown].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)).toBe(false);
  });
});

describe("#17 R2-2：一時フォルダの作成の直後から、削除の対象にする", () => {
  it("テンプレートの書き込みに失敗：failed。一時フォルダは消える", async () => {
    const parent = tmp();
    const { runner } = fakeRunner({ worktree: { exit: 0, report: "[]" } });
    const result = await scanSecrets(tmp(), {
      runner,
      tmpDir: parent,
      writeTemplate: () => Promise.reject(new Error(DUMMY)),
    });
    expect(result.kind).toBe("failed");
    expect(JSON.stringify(result)).not.toContain(DUMMY);
    expect(readdirSync(parent)).toEqual([]);
  });

  it("テンプレートの書き込みと削除の両方が失敗：警告が出る", async () => {
    const warnings: string[] = [];
    const { runner } = fakeRunner({ worktree: { exit: 0, report: "[]" } });
    const result = await scanSecrets(tmp(), {
      runner,
      tmpDir: tmp(),
      writeTemplate: () => Promise.reject(new Error(DUMMY)),
      removeDir: () => Promise.reject(new Error(DUMMY)),
      onWarning: (m) => warnings.push(m),
    });
    expect(result.kind).toBe("failed");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("一時フォルダ");
    expect(warnings.join("")).not.toContain(DUMMY);
  });
});

describe("#17 R2-3：コンテナの後始末を省くのは、正常終了を確かめられたときだけ", () => {
  const psCalled = async (planned: Parameters<typeof fakeRunner>[0]): Promise<boolean> => {
    const { runner, calls } = fakeRunner(planned);
    await scanSecrets(tmp(), { runner }).catch(() => undefined);
    return calls.some((c) => c.args[0] === "ps");
  };

  it("終了コード 0 / 1 で結果を読めた：探さない", async () => {
    expect(await psCalled({ worktree: { exit: 0, report: "[]" } })).toBe(false);
    expect(await psCalled({ worktree: { exit: 1, report: reportOf(reportItem()) } })).toBe(false);
  });

  it("終了コード null（理由の印なし）・想定外の終了コード：探して消す", async () => {
    expect(await psCalled({ worktree: { exit: 0, over: { exitCode: null } } })).toBe(true);
    expect(await psCalled({ worktree: { exit: 2 } })).toBe(true);
    expect(await psCalled({ worktree: { exit: 125 } })).toBe(true);
  });

  it("終了コードは 0 / 1 でも、結果を読めない：探して消す", async () => {
    expect(await psCalled({ worktree: { exit: 0 } })).toBe(true);
    expect(await psCalled({ worktree: { exit: 1, report: "{壊れた" } })).toBe(true);
  });

  it("探して見つかったら、rm -f を呼ぶ", async () => {
    const { runner, calls } = fakeRunner({ worktree: { exit: 2 } });
    await scanSecrets(tmp(), { runner });
    expect(calls.some((c) => c.args[0] === "rm")).toBe(true);
  });
});
