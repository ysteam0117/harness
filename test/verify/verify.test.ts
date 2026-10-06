// #57 R1・R4・R6〜R8：verifyProject（偽の runner と、小さな node の子プロセスを使う runner で確かめる）
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultRunner,
  type CommandRunner,
  type RunOptions,
  type RunResult,
} from "../../src/verify/runner.js";
import { pickSuspects, verifyProject, type VerifyInput } from "../../src/verify/verify.js";
import {
  LONG_TEST_MS,
  PG_ENV_EXAMPLE,
  cleanupWorkDirs,
  entry,
  isAlive,
  makeProject,
  versionsOf,
  waitFor,
  writeScript,
} from "./helpers.js";

afterEach(cleanupWorkDirs);

interface Call {
  args: string[];
  opts: RunOptions;
}

/** npm の呼び出し（args の先頭〜）ごとの結果を決められる偽の runner。出力は raw で渡し、伏せ字・拾う関数は本物と同じ順で通す */
function fakeRunner(
  behave: (
    key: string,
    call: Call,
  ) => { exitCode?: number; raw?: string; throws?: boolean } = () => ({}),
) {
  const calls: Call[] = [];
  const runner: CommandRunner = async (command, args, opts) => {
    calls.push({ args: [command, ...args], opts });
    const key = args.join(" ");
    const outcome = behave(key, { args, opts });
    if (outcome.throws) throw new Error("runner の例外（テスト）");
    const raw = outcome.raw ?? "";
    const scanned: Record<string, string[]> = {};
    for (const [name, scan] of Object.entries(opts.scans ?? {})) scanned[name] = scan(raw);
    const result: RunResult = {
      exitCode: outcome.exitCode ?? 0,
      timedOut: false,
      aborted: false,
      startError: false,
      outputTail: (opts.redact ?? ((t: string) => t))(raw).slice(-4000),
      scanned,
    };
    return result;
  };
  return { runner, calls, keys: () => calls.map((c) => c.args.slice(1).join(" ")) };
}

const UP = "run docker:up:test -- --wait db";
const DOWN = "run docker:down:test";

function input(
  project: { dir: string },
  runner: CommandRunner,
  over: Partial<VerifyInput> = {},
): VerifyInput {
  return {
    projectDir: project.dir,
    database: "d1",
    versions: versionsOf([entry({ name: "node" }), entry({ name: "vite" })]),
    runner,
    dockerAvailable: async () => true,
    signal: new AbortController().signal,
    ...over,
  };
}

describe("#57 R1：D1・DB なし（npm install → npm run check）", () => {
  it("通る：Docker を確かめてから、install → check の順に呼び、環境ファイルを作る（#42：セキュリティのテストに Docker が要る）", async () => {
    const project = makeProject();
    const order: string[] = [];
    const f = fakeRunner((key) => {
      order.push(key);
      return {};
    });
    const result = await verifyProject(
      input(project, f.runner, {
        dockerAvailable: async () => {
          order.push("docker info");
          return true;
        },
      }),
    );
    expect(order).toEqual(["docker info", "install", "run check"]);
    expect(f.keys()).toEqual(["install", "run check"]);
    expect(result).toMatchObject({
      status: "passed",
      envCreated: [".env.development", ".env.test"],
    });
    expect(existsSync(path.join(project.dir, ".env.test"))).toBe(true);
  });

  it.each(["d1", "none"] as const)(
    "#42：%s でも Docker が使えないときは、npm を1回も呼ばず、環境ファイルも作らず、理由（セキュリティのテスト）を返す",
    async (database) => {
      const project = makeProject();
      const f = fakeRunner();
      const result = await verifyProject(
        input(project, f.runner, { database, dockerAvailable: async () => false }),
      );
      expect(f.calls).toHaveLength(0);
      expect(result.status).toBe("skipped");
      if (result.status !== "skipped") throw new Error("skipped のはず");
      expect(result.reason).toContain("Docker");
      expect(result.reason).toContain("セキュリティのテスト");
      expect(existsSync(path.join(project.dir, ".env.test"))).toBe(false);
    },
  );

  it("install が失敗したら check を呼ばない。失敗した手順は install", async () => {
    const f = fakeRunner((key) => (key === "install" ? { exitCode: 1 } : {}));
    const result = await verifyProject(input(makeProject(), f.runner));
    expect(f.keys()).toEqual(["install"]);
    expect(result).toMatchObject({ status: "failed", failedStep: "install" });
  });

  it("check が失敗したら、失敗した script 名（出力で最後に動いたもの）と原因の候補を返す", async () => {
    const raw = [
      "> testapp-001@0.0.0 check",
      "> npm run lint && npm run typecheck",
      "> testapp-001@0.0.0 lint",
      "> testapp-001@0.0.0 typecheck",
      "error TS2307: Cannot find module 'vite' or its corresponding type declarations.",
    ].join("\n");
    const f = fakeRunner((key) => (key === "run check" ? { exitCode: 1, raw } : {}));
    const result = await verifyProject(input(makeProject(), f.runner));
    expect(result).toMatchObject({
      status: "failed",
      failedStep: "check",
      failedScripts: ["typecheck"],
    });
    if (result.status !== "failed") throw new Error("failed のはず");
    expect(result.suspects.map((s) => s.name)).toEqual(["vite"]);
    expect(result.suspects[0]?.named).toBe(true);
    expect(result.outputTail).toContain("Cannot find module");
  });

  it("package.json の scripts にない名前は、失敗した script として返さない（R8）", async () => {
    const raw = ["> testapp-001@0.0.0 typecheck", "> testapp-001@0.0.0 test:abc"].join("\n");
    const f = fakeRunner((key) => (key === "run check" ? { exitCode: 1, raw } : {}));
    const result = await verifyProject(input(makeProject(), f.runner));
    if (result.status !== "failed") throw new Error("failed のはず");
    expect(result.failedScripts).toEqual(["typecheck"]);
    expect(result.failedScripts).not.toContain("test:abc");
  });

  it("環境ファイルを作れない（.env.example がない）ときは、failed（env）で、npm を呼ばない", async () => {
    const project = makeProject();
    rmSync(path.join(project.dir, ".env.example"));
    const f = fakeRunner();
    const result = await verifyProject(input(project, f.runner));
    expect(result).toMatchObject({ status: "failed", failedStep: "env" });
    expect(f.calls).toHaveLength(0);
  });
});

describe("#57 R1：PostgreSQL（install → up → check → down）", () => {
  const pg = () => makeProject({ envExample: PG_ENV_EXAMPLE });
  const pgInput = (
    project: { dir: string },
    runner: CommandRunner,
    over: Partial<VerifyInput> = {},
  ) => input(project, runner, { database: "postgresql", ...over });

  it("通る：Docker を確かめてから、install → up → check → down の順に呼ぶ", async () => {
    const order: string[] = [];
    const f = fakeRunner((key) => {
      order.push(key);
      return {};
    });
    const result = await verifyProject(
      pgInput(pg(), f.runner, {
        dockerAvailable: async () => {
          order.push("docker info");
          return true;
        },
      }),
    );
    expect(order).toEqual(["docker info", "install", UP, "run check", DOWN]);
    expect(result.status).toBe("passed");
  });

  it("Docker が使えないときは、npm を1回も呼ばず、環境ファイルも作らず、理由を返す", async () => {
    const project = pg();
    const f = fakeRunner();
    const result = await verifyProject(
      pgInput(project, f.runner, { dockerAvailable: async () => false }),
    );
    expect(f.calls).toHaveLength(0);
    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") throw new Error("skipped のはず");
    expect(result.reason).toContain("Docker");
    expect(existsSync(path.join(project.dir, ".env.test"))).toBe(false);
  });

  it("install が失敗したら、DB を起動せず、down も呼ばない", async () => {
    const f = fakeRunner((key) => (key === "install" ? { exitCode: 1 } : {}));
    const result = await verifyProject(pgInput(pg(), f.runner));
    expect(f.keys()).toEqual(["install"]);
    expect(result).toMatchObject({ status: "failed", failedStep: "install" });
  });

  it("up が失敗しても、down を呼ぶ（check は呼ばない）", async () => {
    const f = fakeRunner((key) => (key === UP ? { exitCode: 1 } : {}));
    const result = await verifyProject(pgInput(pg(), f.runner));
    expect(f.keys()).toEqual(["install", UP, DOWN]);
    expect(result).toMatchObject({ status: "failed", failedStep: "db-up" });
  });

  it("check が失敗しても、down を呼ぶ", async () => {
    const f = fakeRunner((key) => (key === "run check" ? { exitCode: 1 } : {}));
    const result = await verifyProject(pgInput(pg(), f.runner));
    expect(f.keys()).toEqual(["install", UP, "run check", DOWN]);
    expect(result).toMatchObject({ status: "failed", failedStep: "check" });
  });

  it("runner が例外を投げても、down を呼んでから、例外を投げ直す", async () => {
    const f = fakeRunner((key) => (key === "run check" ? { throws: true } : {}));
    await expect(verifyProject(pgInput(pg(), f.runner))).rejects.toThrow("runner の例外");
    expect(f.keys()).toEqual(["install", UP, "run check", DOWN]);
  });

  it("down は、中断の合図を渡さず、自分の時間切れだけで実行する（R4）。失敗したら cleanupFailures に入る", async () => {
    const controller = new AbortController();
    const f = fakeRunner((key) => (key === DOWN ? { exitCode: 1 } : {}));
    const result = await verifyProject(pgInput(pg(), f.runner, { signal: controller.signal }));
    const down = f.calls.find((c) => c.args.slice(1).join(" ") === DOWN);
    expect(down?.opts.signal).toBeUndefined();
    expect(down?.opts.timeoutMs).toBeGreaterThan(0);
    const check = f.calls.find((c) => c.args.slice(1).join(" ") === "run check");
    expect(check?.opts.signal).toBe(controller.signal);
    expect(result.status).toBe("passed");
    if (result.status !== "passed") throw new Error("passed のはず");
    expect(result.cleanupFailures).toHaveLength(1);
    expect(result.cleanupFailures[0]).toContain("docker:down:test");
  });
});

describe("#57 判定：原因の候補（pickSuspects）", () => {
  const entries = [
    entry({ name: "node", version: "24.19.0" }),
    entry({
      name: "hono",
      version: "5.0.0",
      verified: "4.0.0",
      newerThanVerified: true,
      majorDiffers: true,
    }),
    entry({ name: "zod", version: "4.2.0", verified: "4.1.0", newerThanVerified: true }),
    entry({ name: "axios", version: "1.0.0", verified: null }),
    entry({ name: "vite" }),
  ];

  it("出力に名前が出たものを先に。次に、検証済みより新しい版・未検証の版（大きな版の違いを先に）", () => {
    const suspects = pickSuspects(entries, ["vite"]);
    expect(suspects.map((s) => s.name)).toEqual(["vite", "hono", "zod", "axios"]);
    expect(suspects[0]?.named).toBe(true);
    expect(suspects.slice(1).every((s) => !s.named)).toBe(true);
  });

  it("検証済みの版のままのものは、名前が出ていないかぎり、候補に入れない", () => {
    expect(pickSuspects([entry({ name: "vite" })], [])).toEqual([]);
  });
});

describe("#57 R6・R7・R8：出力の秘密の値・出力から拾う名前（小さな node の子プロセスを npm の代わりに使う）", () => {
  /** npm の代わりに、node のスクリプトを動かす runner（args の先頭の語で、スクリプトを選ぶ） */
  function nodeRunner(scripts: Record<string, string>): CommandRunner {
    return (command, args, opts) => {
      expect(command).toBe("npm");
      const key = args.join(" ");
      const script = scripts[key];
      if (script === undefined) throw new Error(`想定外の呼び出し：${key}`);
      return defaultRunner(process.execPath, [script], opts);
    };
  }

  it(
    "R6：生成した秘密の値と、パスワード入りの接続 URL が、値の途中で分かれた2つのチャンクで出ても、outputTail に元の値がない。既存の .env.test の値も伏せる",
    async () => {
      const project = makeProject({
        files: {
          ".env.test":
            "APP_ENV=test\nSESSION_SECRET=FAKE_SECRET_FOR_TEST_01\nFOO_NAME=plainvalue99\n",
        },
      });
      const dir = path.dirname(project.dir);
      const install = writeScript(dir, "install.cjs", "process.exit(0);");
      const check = writeScript(
        dir,
        "check.cjs",
        `
const fs = require("node:fs");
const dev = fs.readFileSync(".env.development", "utf8");
const generated = dev.split("\\n").find((l) => l.startsWith("SESSION_SECRET=")).slice("SESSION_SECRET=".length);
const half = Math.floor(generated.length / 2);
process.stdout.write("> testapp-001@0.0.0 typecheck\\n");
process.stdout.write("generated=" + generated.slice(0, half), () => {
  process.stdout.write(generated.slice(half) + "\\n", () => {
    process.stdout.write("existing=FAKE_SECRET_FOR", () => {
      process.stdout.write("_TEST_01 plain=plainv", () => {
        process.stdout.write("alue99\\n", () => {
          process.stdout.write("url=postgresql://testuser_001:FAKE_PW_for_url_9@localhost:5432/x\\n", () => process.exit(1));
        });
      });
    });
  });
});
`,
      );
      const result = await verifyProject(
        input(project, nodeRunner({ install, "run check": check })),
      );
      if (result.status !== "failed") throw new Error("failed のはず");
      const dev = readFileSync(path.join(project.dir, ".env.development"), "utf8");
      const generated = /^SESSION_SECRET=(.*)$/m.exec(dev)?.[1] as string;
      expect(generated.length).toBeGreaterThanOrEqual(16);
      const shown = JSON.stringify(result);
      for (const secret of [
        generated,
        "FAKE_SECRET_FOR_TEST_01",
        "plainvalue99",
        "FAKE_PW_for_url_9",
      ]) {
        expect(shown, "元の値が出ている").not.toContain(secret);
      }
      expect(result.outputTail).toContain("[REDACTED]");
      expect(result.outputTail).toContain("testuser_001:[REDACTED]@localhost");
      expect(result.outputSuppressed).toBe(false);
      expect(result.failedScripts).toEqual(["typecheck"]);
    },
    LONG_TEST_MS,
  );

  it(
    "R7：既存の .env.test に短い秘密の値（abc）があると、abc が2つのチャンクで出ても、出力を一切残さない。失敗した script 名・候補は、既知の一覧のものだけ（R8）",
    async () => {
      const project = makeProject({
        files: { ".env.test": "APP_ENV=test\nPOSTGRES_PASSWORD=abc\n" },
      });
      const dir = path.dirname(project.dir);
      const install = writeScript(dir, "install.cjs", "process.exit(0);");
      const check = writeScript(
        dir,
        "check.cjs",
        `
process.stdout.write("> testapp-001@0.0.0 typecheck\\n", () => {
  process.stdout.write("> testapp-001@0.0.0 test:abc\\n", () => {
    process.stdout.write("password=ab", () => {
      process.stdout.write("c evil-pkg\\n", () => process.exit(1));
    });
  });
});
`,
      );
      const result = await verifyProject(
        input(project, nodeRunner({ install, "run check": check })),
      );
      if (result.status !== "failed") throw new Error("failed のはず");
      expect(result.outputSuppressed).toBe(true);
      expect(result.outputTail).toBe("");
      expect(JSON.stringify(result)).not.toContain("abc");
      expect(JSON.stringify(result)).not.toContain("evil-pkg");
      expect(result.failedScripts).toEqual(["typecheck"]); // package.json にある名前は出る
    },
    LONG_TEST_MS,
  );

  it(
    "R4：検証の実行中に中断しても、後始末（docker:down:test）の子プロセスは最後まで実行される。check の子と孫は止まる",
    async () => {
      const project = makeProject({ envExample: PG_ENV_EXAMPLE });
      const dir = path.dirname(project.dir);
      const pidFile = path.join(dir, "grandchild.pid");
      const downStarted = path.join(dir, "down-started.txt");
      const downDone = path.join(dir, "down-done.txt");
      const ok = writeScript(dir, "ok.cjs", "process.exit(0);");
      const check = writeScript(
        dir,
        "check.cjs",
        `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
fs.writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid));
setInterval(() => {}, 1000);
`,
      );
      // 後始末の代わり：中断の合図が来た後でも、最後まで動けば、印のファイルを書く
      const down = writeScript(
        dir,
        "down.cjs",
        `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(downStarted)}, "x");
setTimeout(() => { fs.writeFileSync(${JSON.stringify(downDone)}, "x"); }, 300);
`,
      );
      const controller = new AbortController();
      const running = verifyProject(
        input(project, nodeRunner({ install: ok, [UP]: ok, "run check": check, [DOWN]: down }), {
          database: "postgresql",
          signal: controller.signal,
        }),
      );
      await waitFor(
        () => existsSync(pidFile) && readFileSync(pidFile, "utf8") !== "",
        "check の孫の起動",
      );
      const grandchild = Number(readFileSync(pidFile, "utf8"));
      controller.abort();
      const result = await running;
      expect(result.status).toBe("interrupted");
      expect(existsSync(downStarted)).toBe(true);
      expect(existsSync(downDone)).toBe(true); // 後始末は、中断で止められず、最後まで動いた
      await waitFor(() => !isAlive(grandchild), "check の孫が止まる");
    },
    LONG_TEST_MS,
  );
});
