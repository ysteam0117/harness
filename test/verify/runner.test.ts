// #57 R3：既定の runner を、npm・Docker ではなく、小さな node の子プロセスで確かめる
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OUTPUT_TAIL_LENGTH,
  defaultRunner,
  npmInvocation,
  type RunResult,
} from "../../src/verify/runner.js";
import {
  LONG_TEST_MS,
  cleanupWorkDirs,
  isAlive,
  makeWorkDir,
  waitFor,
  writeScript,
} from "./helpers.js";

afterEach(cleanupWorkDirs);

/** 子が孫を起動し、孫の pid をファイルに書いて、そのまま待ち続ける */
const PARENT_WITH_GRANDCHILD = `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
fs.writeFileSync(process.argv[2], String(grandchild.pid));
setInterval(() => {}, 1000);
`;

const readPid = (file: string): number => Number(readFileSync(file, "utf8"));

describe("#57 R3: npmInvocation（npm の起動の仕方 4通り）", () => {
  it("npm_execpath が npm-cli.js なら、node でそれを実行する（シェルを通さない）", () => {
    const inv = npmInvocation(
      ["run", "check"],
      { npm_execpath: "/x/npm/bin/npm-cli.js" },
      "linux",
      "/x/node",
    );
    expect(inv).toEqual({
      command: "/x/node",
      args: ["/x/npm/bin/npm-cli.js", "run", "check"],
      shell: false,
    });
  });

  it("npm_execpath があっても Windows でも、npm-cli.js なら同じ（シェルを通さない）", () => {
    const inv = npmInvocation(
      ["install"],
      { npm_execpath: "C:\\x\\npm\\bin\\npm-cli.js" },
      "win32",
      "C:\\x\\node.exe",
    );
    expect(inv.shell).toBe(false);
    expect(inv.command).toBe("C:\\x\\node.exe");
  });

  it("npm_execpath がなく Windows なら、npm.cmd をシェル経由で", () => {
    expect(npmInvocation(["install"], {}, "win32", "C:\no-such-dir\node.exe")).toEqual({
      command: "npm.cmd",
      args: ["install"],
      shell: true,
    });
  });

  // Windows のパス（node.exe の場所）で探すため、Windows でだけ確かめる
  it.runIf(process.platform === "win32")(
    "npm_execpath がなくても、Windows で node と同じ場所に npm-cli.js があれば、node で実行する（シェルを通さない）",
    () => {
      const dir = makeWorkDir();
      const bin = path.join(dir, "node_modules", "npm", "bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(path.join(bin, "npm-cli.js"), "");
      const nodePath = path.win32.join(dir, "node.exe");
      const inv = npmInvocation(["install"], {}, "win32", nodePath);
      expect(inv.shell).toBe(false);
      expect(inv.command).toBe(nodePath);
      expect(inv.args[0]).toContain("npm-cli.js");
    },
  );

  it("npm_execpath がなく Windows 以外なら、npm を直接。npm 以外の道具（pnpm）の execpath は使わない", () => {
    expect(npmInvocation(["install"], {}, "linux")).toEqual({
      command: "npm",
      args: ["install"],
      shell: false,
    });
    expect(npmInvocation(["install"], { npm_execpath: "/x/pnpm.cjs" }, "linux").command).toBe(
      "npm",
    );
  });
});

describe("#57 R3: 既定の runner（小さな node の子プロセス）", () => {
  it(
    "(e) 終了コードを渡す。成功は 0、失敗はそのコード",
    async () => {
      const dir = makeWorkDir();
      const ok = await defaultRunner(process.execPath, ["-e", "process.exit(0)"], {
        cwd: dir,
        timeoutMs: 600_000,
      });
      const ng = await defaultRunner(process.execPath, ["-e", "process.exit(7)"], {
        cwd: dir,
        timeoutMs: 600_000,
      });
      expect(ok).toMatchObject({ exitCode: 0, timedOut: false, aborted: false, startError: false });
      expect(ng).toMatchObject({ exitCode: 7, timedOut: false, aborted: false });
    },
    LONG_TEST_MS,
  );

  it(
    "起動できないコマンドは、startError になる",
    async () => {
      const result = await defaultRunner("harness-test-no-such-command-57", [], {
        cwd: makeWorkDir(),
        timeoutMs: 600_000,
      });
      expect(result.startError).toBe(true);
      expect(result.exitCode).toBeNull();
    },
    LONG_TEST_MS,
  );

  it(
    "(d) 出力は、最後の 4000 字だけを残す（stdout・stderr をつないだ最後）",
    async () => {
      const dir = makeWorkDir();
      const script = writeScript(
        dir,
        "big.cjs",
        `process.stdout.write("a".repeat(6000) + "b".repeat(6000) + "END_MARK", () => process.exit(0));`,
      );
      const result = await defaultRunner(process.execPath, [script], {
        cwd: dir,
        timeoutMs: 600_000,
      });
      expect(result.outputTail).toHaveLength(OUTPUT_TAIL_LENGTH);
      expect(result.outputTail.endsWith("END_MARK")).toBe(true);
    },
    LONG_TEST_MS,
  );

  it(
    "R6：値が2つのチャンクに分かれて出ても、つないだ後で伏せ字になる",
    async () => {
      const dir = makeWorkDir();
      const script = writeScript(
        dir,
        "split.cjs",
        `process.stdout.write("token=FAKE_SECR", () => { process.stdout.write("ET_FOR_TEST end\\n"); });`,
      );
      const result = await defaultRunner(process.execPath, [script], {
        cwd: dir,
        timeoutMs: 600_000,
        redact: (text) => text.split("FAKE_SECRET_FOR_TEST").join("[REDACTED]"),
      });
      expect(result.outputTail).toContain("token=[REDACTED] end");
      expect(result.outputTail).not.toContain("FAKE_SECRET_FOR_TEST");
      expect(result.outputTail).not.toContain("FAKE_SECR");
    },
    LONG_TEST_MS,
  );

  it(
    "R6：UTF-8 の1文字がチャンクの境目で分かれても、伏せ字になる",
    async () => {
      const dir = makeWorkDir();
      // "abcdef秘密uvwxyz" を、「秘」の3バイトの途中（7バイト目の後）で分けて書く
      const script = writeScript(
        dir,
        "utf8split.cjs",
        `const b = Buffer.from("secret=abcdef秘密uvwxyz end\\n", "utf8");
const cut = Buffer.byteLength("secret=abcdef", "utf8") + 1;
process.stdout.write(b.subarray(0, cut), () => { process.stdout.write(b.subarray(cut)); });`,
      );
      const secret = "abcdef秘密uvwxyz";
      const result = await defaultRunner(process.execPath, [script], {
        cwd: dir,
        timeoutMs: 600_000,
        redact: (text) => text.split(secret).join("[REDACTED]"),
      });
      expect(result.outputTail).toContain("secret=[REDACTED] end");
      expect(result.outputTail).not.toContain("密uvwxyz");
      expect(result.outputTail).not.toContain("�");
    },
    LONG_TEST_MS,
  );

  it(
    "scans：出力そのものは返さず、関数が返した値だけが scanned に入る",
    async () => {
      const dir = makeWorkDir();
      const script = writeScript(dir, "scan.cjs", `console.log("FAKE_SECRET_FOR_TEST hello");`);
      const result = await defaultRunner(process.execPath, [script], {
        cwd: dir,
        timeoutMs: 600_000,
        redact: () => "",
        scans: { hello: (raw) => (raw.includes("hello") ? ["hello"] : []) },
      });
      expect(result.scanned).toEqual({ hello: ["hello"] });
      expect(result.outputTail).toBe("");
      expect(JSON.stringify(result)).not.toContain("FAKE_SECRET_FOR_TEST");
    },
    LONG_TEST_MS,
  );

  it(
    "(a) 時間切れで、子と孫のプロセスが止まる（孫の pid を書かせて、止まった後に存在しないことを確かめる）",
    async () => {
      const dir = makeWorkDir();
      const script = writeScript(dir, "parent.cjs", PARENT_WITH_GRANDCHILD);
      // 孫が起動する前に時間切れにならないよう、孫の pid が書かれなかったら、長い時間切れでやり直す（固定の短い時間に頼らない）
      for (const [i, timeoutMs] of [3_000, 15_000, 60_000].entries()) {
        const pidFile = path.join(dir, `pid-${String(i)}.txt`);
        const result: RunResult = await defaultRunner(process.execPath, [script, pidFile], {
          cwd: dir,
          timeoutMs,
        });
        expect(result.timedOut).toBe(true);
        expect(result.exitCode).toBeNull();
        if (!existsSync(pidFile)) continue;
        const grandchild = readPid(pidFile);
        await waitFor(() => !isAlive(grandchild), "孫のプロセスが止まる");
        return;
      }
      throw new Error("孫のプロセスを起動できませんでした");
    },
    LONG_TEST_MS,
  );

  it(
    "(b) 中断の合図（AbortSignal）で、子と孫のプロセスが止まる",
    async () => {
      const dir = makeWorkDir();
      const script = writeScript(dir, "parent.cjs", PARENT_WITH_GRANDCHILD);
      const pidFile = path.join(dir, "pid.txt");
      const controller = new AbortController();
      const running = defaultRunner(process.execPath, [script, pidFile], {
        cwd: dir,
        timeoutMs: 600_000,
        signal: controller.signal,
      });
      await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, "utf8") !== "", "孫の起動");
      const grandchild = readPid(pidFile);
      expect(isAlive(grandchild)).toBe(true);
      controller.abort();
      const result = await running;
      expect(result.aborted).toBe(true);
      expect(result.timedOut).toBe(false);
      await waitFor(() => !isAlive(grandchild), "孫のプロセスが止まる");
    },
    LONG_TEST_MS,
  );

  it(
    "すでに中断済みの合図なら、起動せずに aborted を返す",
    async () => {
      const dir = makeWorkDir();
      const marker = path.join(dir, "started.txt");
      const script = writeScript(
        dir,
        "mark.cjs",
        `require("node:fs").writeFileSync(process.argv[2], "x");`,
      );
      const controller = new AbortController();
      controller.abort();
      const result = await defaultRunner(process.execPath, [script, marker], {
        cwd: dir,
        timeoutMs: 600_000,
        signal: controller.signal,
      });
      expect(result.aborted).toBe(true);
      expect(existsSync(marker)).toBe(false);
    },
    LONG_TEST_MS,
  );
});
