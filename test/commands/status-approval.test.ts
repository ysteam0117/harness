import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runStatus, type StatusDeps, type StatusOptions } from "../../src/commands/status.js";
import { realUpdateFs } from "../../src/update/fs.js";
import { cleanupRoots, freshProject, newRoot, snapshot, write } from "../update/helpers.js";
import { offlineFetch } from "../versions/helpers.js";

afterEach(cleanupRoots);

const SETTINGS = ".claude/settings.json";
const LOCAL = ".claude/settings.local.json";
const USER = "~/.claude/settings.json";
const HEADER = "Claude Code の承認設定";
const HINT = "版や条件によってモード未設定でも auto で始まります";
const SCOPE = "VS Code の初期モード設定や前回の選択は、この診断の対象外です";
const INVALID = "承認モードを確認できません";
const UNREADABLE = "設定を確認できません";
const secret = "sample-private-value@example.com";

function fixture(project = newRoot()) {
  const home = newRoot();
  let out = "";
  let err = "";
  const deps: StatusDeps = {
    cwd: project,
    homeDirectory: () => home,
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
    repository: () => undefined,
    changelog: () => undefined,
    fetch: offlineFetch().fn,
  };
  return {
    project,
    home,
    deps,
    async run(options: StatusOptions = {}) {
      const { exitCode } = await runStatus(options, deps);
      return { exitCode, out, err };
    },
  };
}

const settings = (mode: unknown) =>
  JSON.stringify({ permissions: { defaultMode: mode }, env: { SAMPLE: secret } });
const locations = [
  { label: LOCAL, rel: LOCAL, home: false },
  { label: SETTINGS, rel: SETTINGS, home: false },
  { label: USER, rel: SETTINGS, home: true },
];

describe("F-27 #99 AC-1: status の承認設定の診断", () => {
  it("管理記録も設定も無いときも範囲、auto の注意と起動時の確認を表示する", async () => {
    const s = fixture();
    const { exitCode, out, err } = await s.run();
    expect(exitCode).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("インストール済みのバージョン");
    expect(out).toContain(".harness/config.yaml がありません");
    expect(out).toContain(HEADER);
    expect(out).toContain(`${LOCAL}・${SETTINGS}・${USER} の permissions.defaultMode`);
    expect(out).toContain(HINT);
    expect(out).toContain(SCOPE);
    expect(out).toContain("起動時のモードは利用者が画面で確かめてください");
    expect(out).not.toMatch(/警告|設定を確認できません/);
    expect(snapshot(s.project).size).toBe(0);
    expect(snapshot(s.home).size).toBe(0);
  });

  describe.each(locations)("$label", ({ label, rel, home }) => {
    it.each([
      ["acceptEdits", "ファイルの編集に加え、作業範囲内の一部の削除や移動も"],
      ["auto", "分類器"],
      ["bypassPermissions", "Manual"],
    ])("モード %s の警告を出し、設定内容を転記しない", async (mode, reason) => {
      const s = fixture();
      const target = home ? s.home : s.project;
      write(target, rel, settings(mode));
      const before = snapshot(target);
      const { exitCode, out, err } = await s.run();
      expect(exitCode).toBe(0);
      expect(err).toBe("");
      const line = out.split("\n").find((value) => value.includes(`${label}：${mode}`));
      expect(line).toContain(reason);
      if (!home && mode === "auto") expect(line).toContain("利用者設定の defaultMode");
      if (mode === "bypassPermissions") expect(line).toContain("人の確認を省く設定");
      if (!home && mode === "bypassPermissions") expect(line).toContain("v2.1.257");
      if (home) expect(line).not.toMatch(/v2\.1\.257|組み込み既定/);
      expect(out).not.toContain(secret);
      expect(out).not.toContain(s.home);
      expect(snapshot(target)).toEqual(before);
    });
  });

  it.each([undefined, "default", "manual", "plan", "dontAsk"])(
    "モード %s は共通の注意だけを出す",
    async (mode) => {
      const s = fixture();
      write(s.project, LOCAL, settings(mode));
      const { exitCode, out, err } = await s.run();
      expect(exitCode).toBe(0);
      expect(out).toContain(HINT);
      expect(out).not.toContain(`${LOCAL}：`);
      expect(err).toBe("");
    },
  );

  it.each([[null], [42], [secret], [false], [[secret]]])(
    "未対応のモードの値を表示しない",
    async (mode) => {
      const s = fixture();
      write(s.home, SETTINGS, settings(mode));
      const { exitCode, out, err } = await s.run();
      expect(exitCode).toBe(0);
      expect(out).toContain(`${USER}：${INVALID}`);
      expect(out + err).not.toContain(secret);
      expect(out + err).not.toContain(s.home);
      expect(err).toBe("");
    },
  );

  it.each(["[]", "null", '{"permissions":[]}'])(
    "オブジェクト以外の設定は確認できない",
    async (text) => {
      const s = fixture();
      write(s.project, SETTINGS, text);
      const { exitCode, out, err } = await s.run();
      expect(exitCode).toBe(0);
      expect(out).toContain(`${SETTINGS}：${INVALID}`);
      expect(err).toBe("");
    },
  );

  it.each([
    Buffer.from(`// ${secret}\n${settings("auto")}`),
    Buffer.from(`{"permissions": {"defaultMode": "${secret}"`),
    Buffer.from([0xff, 0xfe, 0x00]),
    Buffer.from(`\0${settings("auto")}`),
  ])("コメント・不正なJSON・不正なUTF-8・NULは原文を出さず案内する", async (data) => {
    const s = fixture();
    mkdirSync(path.join(s.project, ".claude"));
    writeFileSync(path.join(s.project, SETTINGS), data);
    const { exitCode, out, err } = await s.run();
    expect(exitCode).toBe(0);
    expect(out).toContain(`${SETTINGS}：${UNREADABLE}`);
    expect(out + err).not.toContain(secret);
    expect(err).toBe("");
  });

  it("UTF-8 BOM がある有効なJSONのモードを診断する", async () => {
    const s = fixture();
    write(s.project, SETTINGS, `\uFEFF${settings("acceptEdits")}`);
    const { out, exitCode, err } = await s.run();
    expect(out).toContain(`${SETTINGS}：acceptEdits`);
    expect(exitCode).toBe(0);
    expect(err).toBe("");
  });

  it("リンクをたどらず、不正な形や別のファイルの警告も出す", async () => {
    const s = fixture();
    const linkTarget = newRoot();
    write(linkTarget, "settings.local.json", settings("bypassPermissions"));
    symlinkSync(linkTarget, path.join(s.project, ".claude"), "junction");
    mkdirSync(path.join(s.home, SETTINGS), { recursive: true });
    const readFile = vi.fn(realUpdateFs.readFile);
    s.deps.fs = { readFile };
    const { exitCode, out, err } = await s.run();
    expect(exitCode).toBe(0);
    for (const label of [LOCAL, SETTINGS, USER]) expect(out).toContain(`${label}：${UNREADABLE}`);
    expect(out + err).not.toContain(linkTarget);
    expect(out).not.toContain("bypassPermissions");
    expect(err).toBe("");
    for (const file of [
      path.join(s.project, LOCAL),
      path.join(s.project, SETTINGS),
      path.join(s.home, SETTINGS),
      path.join(linkTarget, "settings.local.json"),
    ])
      expect(readFile).not.toHaveBeenCalledWith(file);
  });

  it("設定ファイル自体がリンクのときも読み取りをしない", async () => {
    const s = fixture();
    mkdirSync(path.join(s.project, ".claude"));
    const target = newRoot();
    write(target, "fixture.json", settings("bypassPermissions"));
    // Windows の CI でもファイルの symlink を作る権限を必要としないよう lstat を差し替える。
    const linked = path.join(s.project, LOCAL);
    const ls = await realUpdateFs.lstat(path.join(target, "fixture.json"));
    const readFile = vi.fn(realUpdateFs.readFile);
    s.deps.fs = {
      lstat: (p) =>
        p === linked
          ? Promise.resolve(Object.assign(ls, { isSymbolicLink: () => true }))
          : realUpdateFs.lstat(p),
      readFile,
    };
    const { out, exitCode } = await s.run();
    expect(out).toContain(`${LOCAL}：${UNREADABLE}`);
    expect(readFile).not.toHaveBeenCalledWith(linked);
    expect(readFile).not.toHaveBeenCalledWith(path.join(target, "fixture.json"));
    expect(exitCode).toBe(0);
  });

  it("読み取り例外の文とパスを出さず残りのファイルを診断する", async () => {
    const s = fixture();
    write(s.project, LOCAL, settings("auto"));
    write(s.home, SETTINGS, settings("acceptEdits"));
    s.deps.fs = {
      readFile: (p) =>
        p === path.join(s.project, LOCAL)
          ? Promise.reject(Object.assign(new Error(`${s.home}/${secret}`), { code: "EACCES" }))
          : realUpdateFs.readFile(p),
    };
    const { exitCode, out, err } = await s.run();
    expect(exitCode).toBe(0);
    expect(out).toContain(`${LOCAL}：${UNREADABLE}`);
    expect(out).toContain(`${USER}：acceptEdits`);
    expect(out + err).not.toContain(secret);
    expect(out + err).not.toContain(s.home);
    expect(err).toBe("");
  });

  it.each(["取得失敗", "空", "存在しない", "開けない"])(
    "ホームが%sでも終了コード0で続ける",
    async (failure) => {
      const s = fixture();
      write(s.project, LOCAL, settings("auto"));
      if (failure === "存在しない") s.deps.homeDirectory = () => path.join(s.home, "missing");
      if (failure === "空") s.deps.homeDirectory = () => "";
      if (failure === "取得失敗")
        s.deps.homeDirectory = () => {
          throw new Error(secret);
        };
      if (failure === "開けない") {
        s.deps.fs = {
          realpath: (p) =>
            p === s.home ? Promise.reject(new Error(secret)) : realUpdateFs.realpath(p),
        };
      }
      const { exitCode, out, err } = await s.run();
      expect(exitCode).toBe(0);
      expect(out).toContain(`${USER}：${UNREADABLE}`);
      expect(out).toContain(`${LOCAL}：auto`);
      expect(out + err).not.toContain(secret);
      expect(out + err).not.toContain(s.home);
      expect(err).toBe("");
    },
  );

  it("--dir は作業中のフォルダとは別の対象を調べる", async () => {
    const s = fixture();
    const target = newRoot();
    write(s.project, LOCAL, settings("bypassPermissions"));
    write(target, LOCAL, settings("auto"));
    write(target, SETTINGS, settings("acceptEdits"));
    const { exitCode, out } = await s.run({ dir: target });
    expect(exitCode).toBe(0);
    expect(out).toContain(`${LOCAL}：auto`);
    expect(out).toContain(`${SETTINGS}：acceptEdits`);
    expect(out).not.toContain("bypassPermissions");
  });

  it("対象がホームなら settings.json をユーザー設定として1回読む", async () => {
    const s = fixture();
    write(s.home, SETTINGS, settings("acceptEdits"));
    write(s.home, LOCAL, settings("auto"));
    const readFile = vi.fn(realUpdateFs.readFile);
    s.deps.fs = { readFile };
    const { exitCode, out } = await s.run({ dir: s.home });
    expect(exitCode).toBe(0);
    expect(out).toContain(`${LOCAL}：auto`);
    const lines = out.split("\n");
    expect(lines.filter((line) => line.startsWith(`  - ${USER}：acceptEdits`))).toHaveLength(1);
    expect(lines.some((line) => line.startsWith(`  - ${SETTINGS}：`))).toBe(false);
    expect(readFile.mock.calls.filter(([p]) => p === path.join(s.home, SETTINGS))).toHaveLength(1);
  });

  it("管理記録がある場合も従来の情報と診断を表示する", async () => {
    const s = fixture(await freshProject());
    write(s.project, LOCAL, settings("auto"));
    const { exitCode, out } = await s.run();
    expect(exitCode).toBe(0);
    expect(out).toContain("プロジェクトのバージョン");
    expect(out).toContain("書き換え済みの管理ファイル：0 件");
    expect(out).toContain(`${LOCAL}：auto`);
  });

  it("管理記録が壊れていたら設定を読む前に既存のエラーを返す", async () => {
    const s = fixture();
    write(s.project, ".harness/config.yaml", "[]");
    const homeDirectory = vi.fn(() => s.home);
    s.deps.homeDirectory = homeDirectory;
    const { exitCode, out, err } = await s.run();
    expect(exitCode).toBe(1);
    expect(out).toBe("");
    expect(err).toContain(".harness/config.yaml");
    expect(err).not.toContain(HEADER);
    expect(homeDirectory).not.toHaveBeenCalled();
  });
});
