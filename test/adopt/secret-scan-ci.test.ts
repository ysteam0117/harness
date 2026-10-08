// #17 CI の指摘：Windows の Docker は Windows コンテナで、Linux のイメージを動かせない。
// また、root の権限なし（rootless など）でも、レポートの出力先に書けるようにする。
// 本物の docker・git は使わない（実行役を差し替える）。
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanSecrets } from "../../src/adopt/secret-scan.js";
import { fakeRunner, ok } from "./secret-scan-helpers.js";

const roots: string[] = [];
const tmp = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harness-scan-ci-"));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("#17 CI-1：Linux コンテナを動かせない Docker", () => {
  it("OSType が windows：docker-not-linux（docker run を始めない）", async () => {
    const { runner, calls } = fakeRunner({ info: ok({ stdout: "windows\n" }) });
    const result = await scanSecrets(tmp(), { runner });
    expect(result).toEqual({ kind: "docker-not-linux" });
    expect(calls.some((c) => c.args[0] === "run")).toBe(false);
  });

  it("OSType が linux：続ける。docker info は OSType を問い合わせる", async () => {
    const { runner, calls } = fakeRunner({
      info: ok({ stdout: "linux\n" }),
      worktree: { exit: 0, report: "[]" },
    });
    const result = await scanSecrets(tmp(), { runner });
    expect(result.kind).toBe("clean");
    const info = calls.find((c) => c.args[0] === "info");
    expect(info?.args.join(" ")).toContain("OSType");
  });
});

describe("#17 CI-2：レポートの出力先を、コンテナの root が書ける権限にできる", () => {
  it("outDirMode を指定すると、その権限になる（既定は所有者だけ）", async () => {
    if (process.platform === "win32") return; // Windows は権限の表し方が違う
    const seen: number[] = [];
    const { runner } = fakeRunner({ worktree: { exit: 0, report: "[]" } });
    await scanSecrets(tmp(), {
      runner: (command, args, options) => {
        const out = args.find((a) => a.endsWith(":/out"))?.slice(0, -5);
        if (out !== undefined && command === "docker" && args[0] === "run") {
          seen.push(statSync(out).mode & 0o777);
        }
        return runner(command, args, options);
      },
      outDirMode: 0o777,
    });
    expect(seen).toEqual([0o777]);
  });
});
