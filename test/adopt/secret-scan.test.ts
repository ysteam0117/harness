// #17 秘密情報の確認（src/adopt/secret-scan.ts）。本物の docker・git は使わない（実行役を差し替える）。
// ダミーの値は、実行時に連結して作る。実データ・個人名は使わない（架空の値だけ）。
// 想定する型：src/adopt/secret-scan.ts
//   gitleaksImage(templatesDir?) / gitleaksArgs(...) / parseLeakReport(text) / formatLeaks(...) / scanSecrets(root, deps)
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatLeaks,
  gitleaksArgs,
  gitleaksImage,
  parseLeakReport,
  scanSecrets,
} from "../../src/adopt/secret-scan.js";
import { findTemplatesDir } from "../../src/generate/templates-dir.js";
import { CancelledError } from "../../src/questions/prompter.js";
import { COMMIT_A, DUMMY, fakeRunner, ok, reportItem, reportOf } from "./secret-scan-helpers.js";

const tmpRoots: string[] = [];
const tmp = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harness-scan-test-"));
  tmpRoots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("#17 parseLeakReport：場所・行・コミットだけを取り出す（種類は出さない）", () => {
  it("Secret・Match・Line にダミーの値があっても、結果に値が無く、キーは4つだけ", () => {
    const leaks = parseLeakReport(reportOf(reportItem()));
    expect(leaks).toEqual([{ file: "src/config.ts", line: 3, commit: COMMIT_A.slice(0, 7) }]);
    expect(JSON.stringify(leaks)).not.toContain(DUMMY);
    expect(Object.keys(leaks[0] as object).sort()).toEqual(["commit", "file", "line"]);
  });

  it("dir モードの File の先頭の /src/ を外す。Commit が空なら commit は無い", () => {
    const leaks = parseLeakReport(reportOf(reportItem({ File: "/src/a/b.txt", Commit: "" })));
    expect(leaks).toEqual([{ file: "a/b.txt", line: 3 }]);
  });

  it("空の配列は、見つからなかった", () => {
    expect(parseLeakReport("[]")).toEqual([]);
  });

  it("Commit は40桁の16進だけ受け付ける（それ以外は無いものとして扱う。値を出さない）", () => {
    const leaks = parseLeakReport(reportOf(reportItem({ Commit: `${DUMMY}!!` })));
    expect(leaks[0]?.commit).toBeUndefined();
    expect(JSON.stringify(leaks)).not.toContain(DUMMY);
  });

  it("種類（RuleID）は読まず、表示にも出さない（独自ルールの id に値が入りうるため）", () => {
    const leaks = parseLeakReport(reportOf(reportItem({ RuleID: `ghp_${"a".repeat(36)}` })));
    expect(leaks[0]).not.toHaveProperty("rule");
    const shown = formatLeaks(leaks, []).join("\n");
    expect(shown).not.toContain("ghp_");
    expect(shown).not.toContain("種類");
  });

  it("File の制御文字（ESC・改行・NUL・DEL）を逃がす", () => {
    const file = `a\u001b[31mb\nc\u0000d\u007fe.txt`;
    const leaks = parseLeakReport(reportOf(reportItem({ File: file })));
    const shown = leaks[0]?.file ?? "";
    // eslint-disable-next-line no-control-regex
    expect(shown).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(shown).toContain("\\x1b");
    expect(shown).toContain("\\x0a");
  });

  it("壊れた JSON・配列でない・型違いは、失敗にする（例外の文に入力の中身を入れない）", () => {
    const bad = [
      `{"x": ${JSON.stringify(DUMMY)}`,
      JSON.stringify({ RuleID: DUMMY }),
      JSON.stringify([reportItem({ File: 3 })]),
      JSON.stringify([reportItem({ StartLine: DUMMY })]),
      JSON.stringify([DUMMY]),
      JSON.stringify([null]),
      JSON.stringify([reportItem({ StartLine: 0 })]),
      JSON.stringify([reportItem({ StartLine: 1.5 })]),
    ];
    for (const text of bad) {
      let message = "";
      try {
        parseLeakReport(text);
      } catch (e) {
        message = e instanceof Error ? e.message : "";
      }
      expect(message, text).not.toBe("");
      expect(message).not.toContain(DUMMY);
    }
  });
});

describe("#17 gitleaksImage・gitleaksArgs", () => {
  it("イメージは、profile.yaml の container_images.gitleaks と同じ（値を二重に持たない）", () => {
    const profile = readFileSync(
      path.join(findTemplatesDir(), "profiles", "quality", "typescript-standard", "profile.yaml"),
      "utf8",
    );
    const digest = /gitleaks:[\s\S]*?digest: "(sha256:[0-9a-f]{64})"/.exec(profile)?.[1];
    expect(digest).toBeDefined();
    const image = gitleaksImage();
    expect(image).toMatch(/^zricethezav\/gitleaks:v[\d.]+@sha256:[0-9a-f]{64}$/);
    expect(image.endsWith(`@${digest ?? ""}`)).toBe(true);
  });

  it("src にイメージのダイジェストを直接書かない", () => {
    const text = readFileSync(path.resolve("src", "adopt", "secret-scan.ts"), "utf8");
    expect(text).not.toMatch(/sha256:[0-9a-f]{16}/);
  });

  it("引数：--network none・読み取り専用・--redact・レポートは /out", () => {
    for (const mode of ["git", "dir"] as const) {
      const args = gitleaksArgs(mode, {
        image: "img:tag@sha256:x",
        name: "harness-secret-scan-x",
        sourceDir: "/work/app",
        outDir: "/tmp/out",
      });
      expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
      expect(args[args.indexOf("--network") + 1]).toBe("none");
      expect(args).toContain("/work/app:/src:ro");
      expect(args).toContain("/tmp/out:/out");
      expect(args).toContain("--redact");
      expect(args).toContain("--no-banner");
      expect(args[args.indexOf("--report-format") + 1]).toBe("template");
      expect(args[args.indexOf("--report-template") + 1]).toBe("/out/report.tmpl");
      expect(args[args.indexOf("--report-path") + 1]).toBe("/out/report.json");
      expect(args[args.indexOf("--exit-code") + 1]).toBe("1");
      expect(args[args.indexOf("--name") + 1]).toBe("harness-secret-scan-x");
      const at = args.indexOf("img:tag@sha256:x");
      expect(args[at + 1]).toBe(mode);
      expect(args[at + 2]).toBe("/src");
      // 標準出力にレポートを出さない
      expect(args).not.toContain("-");
    }
  });
});

describe("#17 formatLeaks", () => {
  it("履歴（コミットあり）と作業フォルダ（コミットなし）を分けて出し、値を含めない", () => {
    const lines = formatLeaks(
      [{ file: "a.ts", line: 2, commit: "abc1234" }],
      [{ file: "b.ts", line: 5 }],
    ).join("\n");
    expect(lines).toContain("a.ts:2（コミット abc1234）");
    expect(lines).toContain("b.ts:5");
    expect(lines.indexOf("a.ts")).toBeLessThan(lines.indexOf("b.ts"));
    expect(lines).toContain("履歴");
    expect(lines).toContain("作業フォルダ");
  });

  it("多いときは、先頭だけ出して残りの件数を示す", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      file: `f${String(i)}`,
      line: 1,
    }));
    const lines = formatLeaks([], many);
    expect(lines.length).toBeLessThan(80);
    expect(lines.join("\n")).toMatch(/ほか 30 件/);
  });
});

describe("#17 scanSecrets", () => {
  const gitTop = (dir: string) => ok({ stdout: `${dir}\n` });

  it("Docker が無い・動いていない：docker-missing（確認を始めない）", async () => {
    const root = tmp();
    for (const info of [ok({ failedToStart: true, exitCode: null }), ok({ exitCode: 1 })]) {
      const { runner, calls } = fakeRunner({ info });
      const result = await scanSecrets(root, { runner });
      expect(result.kind).toBe("docker-missing");
      expect(calls.some((c) => c.args[0] === "run")).toBe(false);
    }
  });

  it("git のリポジトリ：履歴と作業フォルダの2回調べる。どちらも空なら clean（history+worktree）", async () => {
    const root = tmp();
    const { runner, calls } = fakeRunner({
      top: gitTop(root),
      history: { exit: 0, report: "[]" },
      worktree: { exit: 0, report: "[]" },
    });
    const result = await scanSecrets(root, { runner });
    expect(result).toMatchObject({ kind: "clean", scope: "history+worktree" });
    const runs = calls.filter((c) => c.args[0] === "run" && !c.args.includes("--entrypoint"));
    expect(runs).toHaveLength(2);
    expect(runs[0]?.args).toContain("git");
    expect(runs[1]?.args).toContain("dir");
    // 履歴のためにトップを /src に置く
    expect(runs[0]?.args.some((a) => a.endsWith(":/src:ro") && a.startsWith(root))).toBe(true);
  });

  it("git でない：作業フォルダだけを調べる（scope は worktree）", async () => {
    const root = tmp();
    const { runner, calls } = fakeRunner({ worktree: { exit: 0, report: "[]" } });
    const result = await scanSecrets(root, { runner });
    expect(result).toMatchObject({ kind: "clean", scope: "worktree" });
    expect(
      calls.filter((c) => c.args[0] === "run" && !c.args.includes("--entrypoint")),
    ).toHaveLength(1);
  });

  it("履歴だけにある値：leaks（history にだけ入る）", async () => {
    const root = tmp();
    const { runner } = fakeRunner({
      top: gitTop(root),
      history: { exit: 1, report: reportOf(reportItem()) },
      worktree: { exit: 0, report: "[]" },
    });
    const result = await scanSecrets(root, { runner });
    expect(result.kind).toBe("leaks");
    if (result.kind !== "leaks") return;
    expect(result.history).toHaveLength(1);
    expect(result.worktree).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(DUMMY);
  });

  it("未追跡のファイルにだけある値：leaks（worktree にだけ入る）", async () => {
    const root = tmp();
    const { runner } = fakeRunner({
      top: gitTop(root),
      history: { exit: 0, report: "[]" },
      worktree: { exit: 1, report: reportOf(reportItem({ File: "/src/new.txt", Commit: "" })) },
    });
    const result = await scanSecrets(root, { runner });
    expect(result.kind).toBe("leaks");
    if (result.kind !== "leaks") return;
    expect(result.history).toHaveLength(0);
    expect(result.worktree).toEqual([{ file: "new.txt", line: 3 }]);
  });

  it("どちらかが失敗なら、もう片方が clean でも failed", async () => {
    const root = tmp();
    const cases = [
      { history: { exit: 2 }, worktree: { exit: 0, report: "[]" } },
      { history: { exit: 0, report: "[]" }, worktree: { exit: 125 } },
      { history: { exit: 0, report: "{壊れた" }, worktree: { exit: 0, report: "[]" } },
      { history: { exit: 1, report: "[]" }, worktree: { exit: 0, report: "[]" } },
      { history: { exit: 0, report: reportOf(reportItem()) }, worktree: { exit: 0, report: "[]" } },
      { history: { exit: 1 }, worktree: { exit: 0, report: "[]" } },
    ];
    for (const planned of cases) {
      const { runner } = fakeRunner({ top: gitTop(root), ...planned });
      const result = await scanSecrets(root, { runner });
      expect(result.kind, JSON.stringify(planned)).toBe("failed");
    }
  });

  it("実行役の出力に値があっても、結果のどこにも値が出ない", async () => {
    const root = tmp();
    const { runner } = fakeRunner({
      top: gitTop(root),
      history: { exit: 2, over: { stdout: `token ${DUMMY}` } },
    });
    const result = await scanSecrets(root, { runner });
    expect(result.kind).toBe("failed");
    expect(JSON.stringify(result)).not.toContain(DUMMY);
  });

  it("起動できない・時間切れは failed（別の文）", async () => {
    const root = tmp();
    const a = await scanSecrets(root, {
      runner: fakeRunner({
        worktree: { exit: 0, over: { failedToStart: true, exitCode: null } },
      }).runner,
    });
    const b = await scanSecrets(root, {
      runner: fakeRunner({ worktree: { exit: 0, over: { timedOut: true, exitCode: null } } })
        .runner,
    });
    expect(a.kind).toBe("failed");
    expect(b.kind).toBe("failed");
    if (a.kind === "failed" && b.kind === "failed") expect(a.message).not.toBe(b.message);
  });

  it("中断（aborted）：CancelledError を投げ、コンテナを消す指示（docker rm -f）を出す", async () => {
    const root = tmp();
    const { runner, calls } = fakeRunner({
      worktree: { exit: 0, over: { aborted: true, exitCode: null } },
    });
    await expect(scanSecrets(root, { runner })).rejects.toBeInstanceOf(CancelledError);
    expect(calls.some((c) => c.command === "docker" && c.args[0] === "rm")).toBe(true);
  });

  it("レポートの一時フォルダは、成功・失敗・中断のどれでも消える。レポートはその中だけに出す", async () => {
    const root = tmp();
    const parent = tmp();
    const flows = [
      { worktree: { exit: 0, report: "[]" } },
      { worktree: { exit: 1, report: reportOf(reportItem()) } },
      { worktree: { exit: 2 } },
      { worktree: { exit: 0, over: { aborted: true, exitCode: null } } },
    ];
    for (const planned of flows) {
      const { runner, calls } = fakeRunner(planned);
      await scanSecrets(root, { runner, tmpDir: parent }).catch(() => undefined);
      expect(readdirSync(parent)).toEqual([]);
      const run = calls.find((c) => c.args[0] === "run" && !c.args.includes("--entrypoint"));
      const out = run?.args.find((a) => a.endsWith(":/out"));
      expect(out?.startsWith(parent)).toBe(true);
    }
    expect(existsSync(root)).toBe(true);
  });
});
