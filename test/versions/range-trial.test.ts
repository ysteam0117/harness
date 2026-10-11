// #6 PR-B：範囲の外の版の試し（AC-3）。偽の runner・偽の Docker・偽の登録情報。一時フォルダは tmpRoot（テスト用の場所）の下だけ。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { candidatesOf } from "../../src/versions/range-review.js";
import {
  formatCleanupFailure,
  formatTrialResults,
} from "../../src/versions/range-trial-messages.js";
import {
  runRangeTrials,
  trialAppName,
  trialVersions,
  type RangeTrialInput,
  type TrialResult,
} from "../../src/versions/range-trial.js";
import { makeTmp, cleanupTmp } from "../questions/helpers.js";
import { DOWN, DOWN_V, UP, makeRunner, prepareMain, type Behavior } from "./range-trial-helpers.js";

afterEach(cleanupTmp);

type Main = Awaited<ReturnType<typeof prepareMain>>;
let d1: Main;
let pg: Main;

beforeAll(async () => {
  d1 = await prepareMain();
  pg = await prepareMain({ database: "postgresql", postgres_provider: "neon" });
}, 120_000);

function inputOf(
  main: Main,
  runner: ReturnType<typeof makeRunner>,
  over: Partial<RangeTrialInput> = {},
  count = 1,
): { input: RangeTrialInput; tmpRoot: string } {
  const tmpRoot = makeTmp().cwd;
  const review = main.rangeReview;
  if (!review || !main.answers || !main.versions) throw new Error("準備できていません");
  return {
    tmpRoot,
    input: {
      candidates: candidatesOf(review).slice(0, count),
      answers: main.answers,
      acceptedWarnings: main.acceptedWarnings ?? [],
      versions: main.versions,
      now: new Date("2026-10-03T12:00:00Z"),
      runner: runner.runner,
      dockerAvailable: async () => true,
      signal: new AbortController().signal,
      tmpRoot,
      ...over,
    },
  };
}

const failed = (r: TrialResult) => {
  if (r.outcome.kind !== "failed") throw new Error(`failed のはず：${r.outcome.kind}`);
  return r.outcome;
};

describe("#6 AC-3：trialVersions・trialAppName", () => {
  it("対象と原因の2つだけを置き換える（ほかは同じ）。置き換えた entry は未検証の新しい版の扱い", () => {
    const review = d1.rangeReview;
    const versions = d1.versions;
    if (!review || !versions) throw new Error("準備できていません");
    const finding = candidatesOf(review).find((c) => c.target.name === "vitest");
    if (!finding) throw new Error("vitest の候補がありません");
    const out = trialVersions(versions, finding);
    expect(out?.replaced.map((r) => r.name)).toEqual(["vitest", "@cloudflare/vitest-pool-workers"]);
    const changed = out?.versions.entries.filter(
      (e, i) => e.reason !== versions.entries[i]?.reason,
    );
    expect(changed?.map((e) => e.name)).toEqual(["vitest", "@cloudflare/vitest-pool-workers"]);
    expect(out?.versions.entries.find((e) => e.name === "vitest")).toMatchObject({
      version: finding.candidate,
      newerThanVerified: true,
      majorDiffers: true,
    });
    expect(out?.versions.entries.find((e) => e.name === "axios")).toEqual(
      versions.entries.find((e) => e.name === "axios"),
    );
    // 元は変えない
    expect(versions.entries.find((e) => e.name === "vitest")?.version).not.toBe(finding.candidate);
  });

  it("原因の entry が無ければ undefined", () => {
    const review = d1.rangeReview;
    const versions = d1.versions;
    if (!review || !versions) throw new Error("準備できていません");
    const finding = candidatesOf(review)[0];
    if (!finding) throw new Error("候補がありません");
    const without = {
      ...versions,
      entries: versions.entries.filter((e) => e.name !== finding.target.cause.package),
    };
    expect(trialVersions(without, finding)).toBeUndefined();
  });

  it("アプリ名は <app>-rt-<識別子>-<番号>。Docker の名前として有効で、長い名前は切り詰めても番号が残る", () => {
    expect(trialAppName("testapp-001", "ab12cd34", 2)).toBe("testapp-001-rt-ab12cd34-2");
    const long = trialAppName("a".repeat(120), "ab12cd34", 12);
    expect(long).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith("-rt-ab12cd34-12")).toBe(true);
    expect(trialAppName("x-", "ab12cd34", 1)).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("#6 AC-3：試し（D1）", () => {
  it("通る：一時フォルダの package.json に置き換えた版・アプリ名に -rt-。終わった後はフォルダが残らず、本体の回答は変わらない", async () => {
    const seen: { name?: string; vitest?: string }[] = [];
    const runner = makeRunner((key, cwd) =>
      key === "install"
        ? {
            onCall: () => {
              const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as {
                name: string;
                devDependencies?: Record<string, string>;
              };
              seen.push({ name: pkg.name, vitest: pkg.devDependencies?.["vitest"] });
            },
          }
        : {},
    );
    const { input, tmpRoot } = inputOf(d1, runner);
    const results = await runRangeTrials(input);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toEqual({ kind: "passed" });
    expect(runner.keys()).toEqual(["install", "run check"]);
    expect(seen[0]?.name).toMatch(/^testapp-001-rt-[0-9a-f]{8}-1$/);
    expect(seen[0]?.vitest).toBe(results[0]?.finding.candidate);
    expect(readdirSync(tmpRoot)).toEqual([]);
    expect(main(d1).app_name).toBe("testapp-001");
  });

  it("check が失敗：failedScripts・原因の候補が入り、フォルダは削除される", async () => {
    const runner = makeRunner((key) =>
      key === "run check"
        ? { exitCode: 1, raw: "> x@0.0.0 typecheck\nerror TS2307: Cannot find module 'vitest'" }
        : {},
    );
    const { input, tmpRoot } = inputOf(d1, runner);
    const results = await runRangeTrials(input);
    const o = failed(results[0] as TrialResult);
    expect(o.failedStep).toBe("check");
    expect(o.failedScripts).toEqual(["typecheck"]);
    expect(o.suspects.some((s) => s.name === "vitest" && s.named)).toBe(true);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("install の時間切れ：失敗（時間切れ）。D1 なので DB は起動しない", async () => {
    const runner = makeRunner((key) => (key === "install" ? { timedOut: true } : {}));
    const { input, tmpRoot } = inputOf(d1, runner);
    const o = failed((await runRangeTrials(input))[0] as TrialResult);
    expect(o).toMatchObject({ failedStep: "install", timedOut: true });
    expect(runner.keys()).toEqual(["install"]);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("Docker が無い：Docker の確認は1回で、npm を呼ばず、フォルダも作らず、全件が飛ばし", async () => {
    const runner = makeRunner();
    let checks = 0;
    const { input, tmpRoot } = inputOf(
      d1,
      runner,
      {
        dockerAvailable: async () => {
          checks += 1;
          return false;
        },
      },
      2,
    );
    const results = await runRangeTrials(input);
    expect(checks).toBe(1);
    expect(runner.calls).toHaveLength(0);
    expect(readdirSync(tmpRoot)).toEqual([]);
    expect(results.length).toBeGreaterThan(1);
    for (const r of results) {
      expect(r.outcome).toEqual({ kind: "skipped", reason: "docker-unavailable" });
    }
  });

  it("一時フォルダを消せなかった：cleanupFailures にパスが入り、案内に手で削除する旨とパスが出る", async () => {
    const runner = makeRunner();
    const { input } = inputOf(d1, runner, {
      fs: {
        rm: () => Promise.reject(new Error("消せない（テスト）")),
        mkdtemp: async (prefix) => {
          const dir = `${prefix}fixed`;
          const { mkdirSync } = await import("node:fs");
          mkdirSync(dir, { recursive: true });
          return dir;
        },
      },
    });
    const results = await runRangeTrials(input);
    const f = results[0]?.cleanupFailures[0];
    expect(f).toMatchObject({ kind: "tmp-remove" });
    if (f?.kind !== "tmp-remove") throw new Error("tmp-remove のはず");
    expect(f.path.endsWith("fixed")).toBe(true);
    expect(formatCleanupFailure(f)).toContain(`手で削除してください：${f.path}`);
  });

  it("候補2件は、別のフォルダで順に試す（フォルダ・アプリ名が違い、終わると残らない）", async () => {
    const dirs: string[] = [];
    const names: string[] = [];
    const runner = makeRunner((key, cwd) =>
      key === "install"
        ? {
            onCall: () => {
              dirs.push(cwd);
              names.push(
                (
                  JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as {
                    name: string;
                  }
                ).name,
              );
            },
          }
        : {},
    );
    const { input, tmpRoot } = inputOf(d1, runner, {}, 2);
    const results = await runRangeTrials(input);
    expect(results).toHaveLength(2);
    expect(dirs).toHaveLength(2);
    expect(dirs[0]).not.toBe(dirs[1]);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toMatch(/-1$/);
    expect(names[1]).toMatch(/-2$/);
    expect(readdirSync(tmpRoot)).toEqual([]);
    // 呼び出しは、1件目が終わってから2件目（順に）
    expect(runner.keys()).toEqual(["install", "run check", "install", "run check"]);
  });

  it("別の実行では、アプリ名の識別子が違う。呼び出しの場所は、自分の一時フォルダの中だけ", async () => {
    const names: string[] = [];
    const record = (key: string, cwd: string): Behavior =>
      key === "install"
        ? {
            onCall: () =>
              names.push(
                (
                  JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as {
                    name: string;
                  }
                ).name,
              ),
          }
        : {};
    const r1 = makeRunner(record);
    const r2 = makeRunner(record);
    const a = inputOf(d1, r1);
    const b = inputOf(d1, r2);
    await runRangeTrials(a.input);
    await runRangeTrials(b.input);
    expect(names).toHaveLength(2);
    expect(names[0]).not.toBe(names[1]);
    for (const c of r1.calls) expect(c.cwd.startsWith(a.tmpRoot)).toBe(true);
    for (const c of r2.calls) expect(c.cwd.startsWith(b.tmpRoot)).toBe(true);
  });
});

describe("#6 AC-3：中断", () => {
  it("check の途中の中断：残りは試さない。down は1回・-v は1回、フォルダは削除される", async () => {
    const controller = new AbortController();
    const runner = makeRunner((key) =>
      key === "run check"
        ? { waitForAbort: true, onCall: () => queueMicrotask(() => controller.abort()) }
        : {},
    );
    const { input, tmpRoot } = inputOf(pg, runner, { signal: controller.signal }, 2);
    const results = await runRangeTrials(input);
    expect(results.map((r) => r.outcome.kind)).toEqual(["interrupted", "interrupted"]);
    expect(runner.keys()).toEqual(["install", UP, "run check", DOWN, DOWN_V]);
    expect(runner.keys().filter((k) => k === DOWN)).toHaveLength(1);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });
});

describe("#6 AC-3：PostgreSQL の後始末", () => {
  it("候補2件：各候補に down と down -v が1回ずつあり、アプリ名（package.json の name）が違う", async () => {
    const names: string[] = [];
    const runner = makeRunner((key, cwd) =>
      key === "install"
        ? {
            onCall: () =>
              names.push(
                (
                  JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as {
                    name: string;
                  }
                ).name,
              ),
          }
        : {},
    );
    const { input, tmpRoot } = inputOf(pg, runner, {}, 2);
    const results = await runRangeTrials(input);
    expect(results.map((r) => r.outcome.kind)).toEqual(["passed", "passed"]);
    expect(runner.keys().filter((k) => k === DOWN)).toHaveLength(2);
    expect(runner.keys().filter((k) => k === DOWN_V)).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  /** 復旧の案内のフォルダ（package.json と docker:down:test の script がある）を、実際の一時フォルダで確かめる */
  function expectRecoverable(r: TrialResult, command: string): string {
    const f = r.cleanupFailures[0];
    if (f?.kind !== "db-stop") throw new Error("db-stop のはず");
    expect(f.command).toBe(command);
    expect(existsSync(f.dir)).toBe(true);
    const pkg = JSON.parse(readFileSync(path.join(f.dir, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["docker:down:test"]).toBeDefined();
    expect(path.dirname(f.dir)).toBe(f.tmpDir);
    const message = formatCleanupFailure(f);
    expect(message).toContain(f.dir);
    expect(message).toContain(command);
    expect(message).toContain("生成したプロジェクトの場所では実行しないでください");
    return f.dir;
  }

  it("down が失敗：フォルダを残し、案内に package.json のある場所が出る。2件目は npm を呼ばず飛ばす", async () => {
    const runner = makeRunner((key) => (key === DOWN ? { exitCode: 1 } : {}));
    const { input, tmpRoot } = inputOf(pg, runner, {}, 2);
    const results = await runRangeTrials(input);
    expect(results[0]?.outcome.kind).toBe("passed");
    expect(results[1]?.outcome).toEqual({ kind: "skipped", reason: "db-stop-failed-earlier" });
    expect(runner.keys()).toEqual(["install", UP, "run check", DOWN]);
    const dir = expectRecoverable(results[0] as TrialResult, "npm run docker:down:test -- -v");
    expect(readdirSync(tmpRoot)).toHaveLength(1);
    expect(dir.startsWith(tmpRoot)).toBe(true);
    // 下書きにも結果の表にもパスは入らない（案内の文だけにパスが出る）
    expect(formatTrialResults(results.map((r) => ({ ...r, cleanupFailures: [] })))).not.toContain(
      tmpRoot,
    );
  });

  it("down -v が失敗：フォルダを残し、案内は -v つき。2件目は npm を呼ばない", async () => {
    const runner = makeRunner((key) => (key === DOWN_V ? { exitCode: 1 } : {}));
    const { input, tmpRoot } = inputOf(pg, runner, {}, 2);
    const results = await runRangeTrials(input);
    expect(results[1]?.outcome).toEqual({ kind: "skipped", reason: "db-stop-failed-earlier" });
    expect(runner.keys()).toEqual(["install", UP, "run check", DOWN, DOWN_V]);
    expectRecoverable(results[0] as TrialResult, "npm run docker:down:test -- -v");
    expect(readdirSync(tmpRoot)).toHaveLength(1);
  });

  it("DB 起動後に runner が例外・down も失敗：フォルダを残し、後続を試さず、案内が出る", async () => {
    const runner = makeRunner((key) =>
      key === "run check" ? { throws: true } : key === DOWN ? { exitCode: 1 } : {},
    );
    const { input, tmpRoot } = inputOf(pg, runner, {}, 2);
    const results = await runRangeTrials(input);
    expect(results[0]?.outcome).toEqual({ kind: "skipped", reason: "unexpected-error" });
    expect(results[1]?.outcome).toEqual({ kind: "skipped", reason: "db-stop-failed-earlier" });
    expect(runner.keys()).toEqual(["install", UP, "run check", DOWN]);
    expectRecoverable(results[0] as TrialResult, "npm run docker:down:test -- -v");
    expect(readdirSync(tmpRoot)).toHaveLength(1);
  });

  it("停止の前の onProgress が例外でも、down は1回呼ばれる", async () => {
    const runner = makeRunner();
    const { input, tmpRoot } = inputOf(pg, runner, {
      onProgress: (message) => {
        if (message.includes("止めています")) throw new Error("表示の例外（テスト）");
      },
    });
    const results = await runRangeTrials(input);
    expect(results[0]?.outcome.kind).toBe("passed");
    expect(runner.keys().filter((k) => k === DOWN)).toHaveLength(1);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("例外でも down が成功したなら、フォルダは削除される（次の候補も試す）", async () => {
    let first = true;
    const runner = makeRunner((key) => {
      if (key === "run check" && first) {
        first = false;
        return { throws: true };
      }
      return {};
    });
    const { input, tmpRoot } = inputOf(pg, runner, {}, 2);
    const results = await runRangeTrials(input);
    expect(results[0]?.outcome).toEqual({ kind: "skipped", reason: "unexpected-error" });
    expect(results[1]?.outcome.kind).toBe("passed");
    expect(results[0]?.cleanupFailures).toEqual([]);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("付加情報の無い例外（install が例外）：停止の成否が不明なので、フォルダを残して後続を試さない", async () => {
    const runner = makeRunner((key) => (key === "install" ? { throws: true } : {}));
    const { input, tmpRoot } = inputOf(pg, runner, {}, 2);
    const results = await runRangeTrials(input);
    expect(results[0]?.outcome).toEqual({ kind: "skipped", reason: "unexpected-error" });
    expect(results[1]?.outcome).toEqual({ kind: "skipped", reason: "db-stop-failed-earlier" });
    expect(readdirSync(tmpRoot)).toHaveLength(1);
  });
});

function main(m: Main): { app_name: string } {
  if (!m.answers) throw new Error("準備できていません");
  return m.answers;
}
