// #56 R(レビュー1)-3・4・5・6：smoke（scripts/smoke-generated.ts）の部品のテスト（コードレビュー1回目の指摘）。
// 実際の npm install・docker compose は行わない（docker の操作は差し替える）。
//
// 新しく想定する関数・型（scripts/smoke-generated.ts が export する。既存の SmokeCase・SMOKE_CASES・stopProcess は変えない）
//
//   // R-3：実行ごとに一意な架空のアプリ名
//   export function createSmokeAppName(): string;
//        // "smoke-<短い乱数>"。英小文字・数字・ハイフンだけ、先頭と末尾はハイフン不可（validateAppName を通る）。呼ぶたびに違う値
//   export function buildSmokeRun(c: SmokeCase, appName: string): {
//     appName: string;              // 引数のとおり
//     answersYaml: string;          // c.answersYaml の app_name を appName にしたもの（ほかの回答は c のまま）
//     projectDirName: string;       // 生成先のフォルダ名（= appName。harness create は <cwd>/<app_name> に出す）
//     composeProjectName: string;   // docker compose のプロジェクト名（= appName。生成物の docker-compose.yml の name と同じ）
//   };
//
//   // R-4：起動したものの記録と後始末
//   export type CleanupRegistry = {
//     trackProcess(child: ChildProcess): void;   // 起動した直後に呼ぶ。子孫も記録の対象（snapshot で集める。起動中は 200ms ごと等で自動でも集める）
//     snapshot(): Promise<void>;                 // 今の、記録した全プロセスの子孫を、記録に足す（親が先に終わっても止められるように）
//     trackCompose(projectDir: string): void;    // docker compose の資源（コンテナ・ボリューム）。同じ dir を2回足しても down は1回
//     add(name: string, run: () => void | Promise<void>): void;   // そのほかの後始末（フォルダの削除等）
//     runAll(): Promise<string[]>;               // 登録の逆順にすべて実行（途中で失敗しても続ける）。失敗の文言（"<名前>：<理由>"）の配列を返す。
//                                                // 2回目以降は、後始末をやり直さず、1回目と同じ結果を返す（1回目の完了まで待つ）。記録した全プロセスと、その子孫を止める
//   };
//   export function createCleanupRegistry(opts?: {
//     composeDown?: (projectDir: string) => void | Promise<void>;   // 既定は `docker compose down -v --remove-orphans`（cwd = projectDir）
//   }): CleanupRegistry;
//   export function installInterruptHandlers(
//     registry: CleanupRegistry,
//     opts?: { exit?: (code: number) => void },   // 既定は process.exit
//   ): () => void;
//        // SIGINT・SIGTERM（process.on）で registry.runAll() を実行し、終わってから exit(130)（SIGINT）／exit(143)（SIGTERM）。
//        // 戻り値は、登録を外す関数。同じ信号が続けて来ても runAll は1回だけ
//   export function runCommand(
//     command: string, args: string[],
//     opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number; input?: string; registry?: CleanupRegistry },
//   ): Promise<string>;
//        // 今の run（spawnSync）と同じ約束（成功なら標準出力。失敗は、終了コードと出力の終わりを付けた Error）だが、非同期。
//        // registry があれば、起動したプロセスを trackProcess する。時間切れ（timeoutMs）のときは、そのプロセスと子孫を止めてから、
//        // 「時間切れ」を含む文言の Error で reject する
//
//   // R-5：例の機能（サンプルの利用者）を API 経由で確かめる共通の手順（D1・PostgreSQL の両方で使う）
//   export type SampleUserSteps = {
//     post(username: string): Promise<{ status: number; body: unknown }>;   // POST /api/sample-users { username }。成功は 2xx
//     list(): Promise<{ status: number; body: unknown }>;                   // GET /api/sample-users。成功は 200、本文は { users: { username: string }[] }
//     cleanup(): void | Promise<void>;                                      // npm run db:cleanup
//     reset(): void | Promise<void>;                                        // npm run db:reset:local
//   };
//   export function runSampleUserLifecycle(
//     database: "d1" | "postgresql", steps: SampleUserSteps,
//   ): Promise<void>;
//        // 順に：post → list（追加した名前が読み戻せること）→ cleanup → list（その名前が消えていること）→ reset。
//        // post の名前は testuser_ で始まる。post が 2xx でない・読み戻せない・後始末後も残る、のときは、
//        // database と原因（名前）を示した Error で reject し、後の手順は呼ばない
//
//   // R-6：確かめと後始末の両方が失敗したときの共通の処理
//   export function runWithCleanup<T>(
//     caseId: string, registry: CleanupRegistry, body: () => Promise<T>,
//   ): Promise<T>;
//        // body を実行し、成功でも失敗でも必ず registry.runAll() を実行する。
//        // 成功＋後始末の失敗：後始末の失敗の文言を示した Error。body の失敗だけ：その Error をそのまま。
//        // 両方の失敗：message に、body の失敗の message と後始末の失敗の文言の両方を含める（cause か errors にも持たせる）
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAnswersYaml } from "../../src/questions/answers.js";
import { validateAppName } from "../../src/questions/app-name.js";
import {
  SMOKE_CASES,
  buildSmokeRun,
  createCleanupRegistry,
  createSmokeAppName,
  installInterruptHandlers,
  runCommand,
  runSampleUserLifecycle,
  runWithCleanup,
  type CleanupRegistry,
} from "../../scripts/smoke-generated.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function untilDead(pid: number, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (alive(pid) && Date.now() < deadline) await sleep(50);
  return !alive(pid);
}

const tmpDirs: string[] = [];
const leftovers: number[] = [];
const uninstalls: (() => void)[] = [];

afterEach(() => {
  for (const u of uninstalls.splice(0)) u();
  for (const pid of leftovers.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* 既に終わっている */
    }
  }
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmpDir(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "harness-test-smoke-"));
  tmpDirs.push(d);
  return d;
}

/** 親（node）が、孫（node）を起動して pid をファイルに書き、待ち続ける。引数 1 番目 = pid を書くファイル */
const PARENT_SCRIPT = `
  const { spawn } = require("node:child_process");
  const fs = require("node:fs");
  const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  fs.writeFileSync(process.argv[1], String(g.pid));
  setInterval(() => {}, 1000);
`;

async function readPid(file: string): Promise<number> {
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      const text = readFileSync(file, "utf8");
      if (/^\d+$/.test(text)) return Number(text);
    } catch {
      /* まだない */
    }
    if (Date.now() > deadline) throw new Error("孫の pid を読めません");
    await sleep(50);
  }
}

describe("#56 R(レビュー1)-3: 実行ごとに一意な架空のアプリ名", () => {
  it("#56 R(レビュー1)-3: createSmokeAppName は smoke-<乱数> で、アプリ名の規則を満たし、呼ぶたびに違う", () => {
    const names = Array.from({ length: 30 }, () => createSmokeAppName());
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n).toMatch(/^smoke-[a-z0-9]+$/);
      expect(n.length).toBeLessThanOrEqual(30);
      expect(validateAppName(n)).toBeUndefined();
    }
  });

  it("#56 R(レビュー1)-3: buildSmokeRun は、回答の YAML・生成先・Compose の名前に同じアプリ名を使い、回答の中身は変えない", () => {
    const appName = createSmokeAppName();
    for (const c of SMOKE_CASES) {
      const run = buildSmokeRun(c, appName);
      const answers = parseAnswersYaml(run.answersYaml).answers;
      expect(run.appName, c.id).toBe(appName);
      expect(answers.app_name, c.id).toBe(appName);
      expect(run.projectDirName, c.id).toBe(appName);
      expect(run.composeProjectName, c.id).toBe(appName);
      expect(answers.database, c.id).toBe(c.database);
      expect(answers.auth, c.id).toBe(c.auth);
      expect(run.answersYaml, c.id).not.toContain("testapp-001");
    }
  });

  it("#56 R(レビュー1)-3: 別のアプリ名を渡せば、Compose の名前も別になる（同時の実行で混ざらない）", () => {
    const a = createSmokeAppName();
    const b = createSmokeAppName();
    const first = SMOKE_CASES[0]!;
    expect(buildSmokeRun(first, a).composeProjectName).not.toBe(
      buildSmokeRun(first, b).composeProjectName,
    );
  });
});

describe("#56 R(レビュー1)-4: smoke の中断で、起動したものを止める", () => {
  function startParent(pidFile: string): ChildProcess {
    const child = spawn(process.execPath, ["-e", PARENT_SCRIPT, pidFile], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (child.pid !== undefined) leftovers.push(child.pid);
    return child;
  }

  // Windows では Node の子プロセスが親の job に入り、親を止めると孫も止まるため、前提（孫が生きている）が成り立たない。
  // Linux・macOS の CI で確かめる
  it.skipIf(process.platform === "win32")(
    "#56 R(レビュー1)-4: 親のプロセスだけが先に終わっても、記録した子孫（子の子）が runAll で止まる",
    async () => {
      const pidFile = path.join(tmpDir(), "grandchild.pid");
      const registry = createCleanupRegistry();
      const parent = startParent(pidFile);
      registry.trackProcess(parent);
      const grandchild = await readPid(pidFile);
      leftovers.push(grandchild);
      await registry.snapshot();
      // 親だけを先に終わらせる（子孫は残る）
      process.kill(parent.pid as number, "SIGKILL");
      expect(await untilDead(parent.pid as number)).toBe(true);
      expect(alive(grandchild)).toBe(true);
      const failures = await registry.runAll();
      expect(failures).toEqual([]);
      expect(await untilDead(grandchild)).toBe(true);
    },
  );

  it("#56 R(レビュー1)-4: 起動した直後から記録する（snapshot を呼ばなくても、しばらく待てば子孫を記録する）", async () => {
    const pidFile = path.join(tmpDir(), "grandchild.pid");
    const registry = createCleanupRegistry();
    const parent = startParent(pidFile);
    registry.trackProcess(parent);
    const grandchild = await readPid(pidFile);
    leftovers.push(grandchild);
    await sleep(3000); // 自動の記録を待つ
    process.kill(parent.pid as number, "SIGKILL");
    expect(await untilDead(parent.pid as number)).toBe(true);
    await registry.runAll();
    expect(await untilDead(grandchild)).toBe(true);
  });

  it("#56 R(レビュー1)-4: runAll は、登録の逆順に実行し、途中の失敗があっても続け、失敗の文言を返す。2回目以降は、後始末をやり直さず、同じ結果を返す", async () => {
    const registry = createCleanupRegistry();
    const order: string[] = [];
    registry.add("一時的なフォルダの削除", () => {
      order.push("folder");
    });
    registry.add("失敗する後始末", () => {
      throw new Error("消せません");
    });
    registry.add("最後に登録", () => {
      order.push("last");
    });
    const failures = await registry.runAll();
    expect(order).toEqual(["last", "folder"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("失敗する後始末");
    expect(failures[0]).toContain("消せません");
    expect(await registry.runAll()).toEqual(failures);
    expect(order).toEqual(["last", "folder"]);
  });

  it("#56 R(レビュー1)-4: docker compose の資源は、記録した dir ごとに1回だけ down する（同じ dir を2回足しても）", async () => {
    const downs: string[] = [];
    const registry = createCleanupRegistry({
      composeDown: (dir) => {
        downs.push(dir);
      },
    });
    registry.trackCompose("/tmp/test-project-a");
    registry.trackCompose("/tmp/test-project-a");
    registry.trackCompose("/tmp/test-project-b");
    await registry.runAll();
    expect(downs.sort()).toEqual(["/tmp/test-project-a", "/tmp/test-project-b"]);
  });

  it("#56 R(レビュー1)-4: SIGTERM（process.emit で代える）で、同じ後始末が走り、終わってから exit(143) になる", async () => {
    const pidFile = path.join(tmpDir(), "grandchild.pid");
    const downs: string[] = [];
    const registry = createCleanupRegistry({
      composeDown: (d) => {
        downs.push(d);
      },
    });
    const parent = startParent(pidFile);
    registry.trackProcess(parent);
    registry.trackCompose("/tmp/test-project-a");
    const grandchild = await readPid(pidFile);
    leftovers.push(grandchild);
    await registry.snapshot();
    let ran = false;
    registry.add("確認用", () => {
      ran = true;
    });
    const codes: number[] = [];
    const exited = new Promise<void>((resolve) => {
      uninstalls.push(
        installInterruptHandlers(registry, {
          exit: (code) => {
            codes.push(code);
            resolve();
          },
        }),
      );
    });
    process.emit("SIGTERM");
    await exited;
    expect(codes).toEqual([143]);
    expect(ran).toBe(true);
    expect(downs).toEqual(["/tmp/test-project-a"]);
    expect(await untilDead(parent.pid as number)).toBe(true);
    expect(await untilDead(grandchild)).toBe(true);
  });

  it("#56 R(レビュー1)-4: SIGINT でも後始末が走り exit(130)。続けて同じ信号が来ても後始末は1回", async () => {
    const registry = createCleanupRegistry();
    let count = 0;
    registry.add("確認用", () => {
      count += 1;
    });
    const codes: number[] = [];
    const exited = new Promise<void>((resolve) => {
      uninstalls.push(
        installInterruptHandlers(registry, {
          exit: (code) => {
            codes.push(code);
            resolve();
          },
        }),
      );
    });
    process.emit("SIGINT");
    process.emit("SIGINT");
    await exited;
    await sleep(100);
    expect(codes[0]).toBe(130);
    expect(count).toBe(1);
  });

  it("#56 R(レビュー2)-1: 通常の runAll の後始末が終わる前に SIGTERM を受けても、exit は後始末が完了してから呼ばれる", async () => {
    const registry = createCleanupRegistry();
    const events: string[] = [];
    registry.add("遅い後始末", async () => {
      await sleep(600);
      events.push("cleanup-done");
    });
    const exited = new Promise<void>((resolve) => {
      uninstalls.push(
        installInterruptHandlers(registry, {
          exit: () => {
            events.push("exit");
            resolve();
          },
        }),
      );
    });
    const first = registry.runAll().then((f) => {
      events.push("first-returned");
      return f;
    });
    await sleep(100); // 1回目の後始末の途中
    process.emit("SIGTERM");
    await exited;
    await first;
    expect(events.indexOf("cleanup-done")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("exit")).toBeGreaterThan(events.indexOf("cleanup-done"));
  });

  it("#56 R(レビュー2)-1: 2回目以降の runAll も、1回目の完了まで待ってから返り、1回目と同じ失敗の文言を返す", async () => {
    const registry = createCleanupRegistry();
    let finished = false;
    let runs = 0;
    registry.add("遅い後始末", async () => {
      runs += 1;
      await sleep(600);
      finished = true;
      throw new Error("遅れて失敗");
    });
    const first = registry.runAll();
    await sleep(100);
    const second = await registry.runAll();
    expect(finished).toBe(true); // 2回目は、1回目の完了まで待った
    const firstResult = await first;
    expect(runs).toBe(1);
    expect(firstResult.join(" ")).toContain("遅れて失敗");
    expect(second.join(" ")).toContain("遅れて失敗");
    expect(await registry.runAll()).toEqual(second);
  });

  it("#56 R(レビュー1)-4: 登録を外す関数を呼んだあとは、信号を受けても何もしない", async () => {
    const registry = createCleanupRegistry();
    let count = 0;
    registry.add("確認用", () => {
      count += 1;
    });
    const exits: number[] = [];
    const uninstall = installInterruptHandlers(registry, {
      exit: (c) => {
        exits.push(c);
      },
    });
    uninstall();
    process.emit("SIGTERM");
    await sleep(100);
    expect(count).toBe(0);
    expect(exits).toEqual([]);
  });

  it("#56 R(レビュー1)-4: 非同期の runCommand は、時間切れのとき、子孫まで止めて「時間切れ」で失敗する", async () => {
    const pidFile = path.join(tmpDir(), "grandchild.pid");
    const registry = createCleanupRegistry();
    const failure = await runCommand(process.execPath, ["-e", PARENT_SCRIPT, pidFile], {
      cwd: tmpDir(),
      timeoutMs: 4000,
      registry,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/時間切れ/);
    const grandchild = await readPid(pidFile);
    leftovers.push(grandchild);
    expect(await untilDead(grandchild)).toBe(true);
    await registry.runAll();
  });

  it("#56 R(レビュー1)-4: runCommand は、成功なら標準出力を返し、失敗なら終了コードと出力の終わりを付けて失敗する", async () => {
    const cwd = tmpDir();
    await expect(
      runCommand(process.execPath, ["-e", "console.log('hello-ok')"], { cwd }),
    ).resolves.toContain("hello-ok");
    const failure = await runCommand(
      process.execPath,
      ["-e", "console.error('boom-detail'); process.exit(3)"],
      { cwd },
    ).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(failure?.message).toContain("3");
    expect(failure?.message).toContain("boom-detail");
  });
});

describe("#56 R(レビュー1)-5: サンプルの利用者を API 経由で確かめる手順（D1・PostgreSQL の両方）", () => {
  function fakeSteps(over: { listAfterPost?: string[] } = {}) {
    const calls: string[] = [];
    const posted: string[] = [];
    let cleaned = false;
    type Result = { status: number; body: unknown };
    const steps: {
      post: (username: string) => Promise<Result>;
      list: () => Promise<Result>;
      cleanup: () => void;
      reset: () => void;
    } = {
      post: (username: string) => {
        calls.push("post");
        posted.push(username);
        return Promise.resolve({ status: 201, body: { username } });
      },
      list: () => {
        calls.push("list");
        const names = cleaned ? [] : (over.listAfterPost ?? posted);
        return Promise.resolve({
          status: 200,
          body: { users: names.map((username) => ({ username })) },
        });
      },
      cleanup: () => {
        calls.push("cleanup");
        cleaned = true;
      },
      reset: () => {
        calls.push("reset");
      },
    };
    return { steps, calls, posted };
  }

  for (const database of ["d1", "postgresql"] as const) {
    it(`#56 R(レビュー1)-5: ${database}：API で追加 → 一覧で読み戻す → 後始末 → 一覧で消えた → 初期化 の順に呼ぶ`, async () => {
      const { steps, calls, posted } = fakeSteps();
      await runSampleUserLifecycle(database, steps);
      expect(calls).toEqual(["post", "list", "cleanup", "list", "reset"]);
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatch(/^testuser_/);
    });

    it(`#56 R(レビュー1)-5: ${database}：追加が 2xx でないとき、database を示して失敗し、後の手順は呼ばない`, async () => {
      const { steps, calls } = fakeSteps();
      steps.post = () => {
        calls.push("post");
        return Promise.resolve({ status: 403, body: {} });
      };
      await expect(runSampleUserLifecycle(database, steps)).rejects.toThrow(new RegExp(database));
      expect(calls).toEqual(["post"]);
    });

    it(`#56 R(レビュー1)-5: ${database}：一覧で読み戻せないとき、名前を示して失敗し、後始末・初期化は呼ばない`, async () => {
      const { steps, calls } = fakeSteps({ listAfterPost: [] });
      await expect(runSampleUserLifecycle(database, steps)).rejects.toThrow(/testuser_/);
      expect(calls).not.toContain("cleanup");
      expect(calls).not.toContain("reset");
    });

    it(`#56 R(レビュー1)-5: ${database}：後始末のあとも残っているとき、名前を示して失敗し、初期化は呼ばない`, async () => {
      const { steps, calls, posted } = fakeSteps();
      steps.cleanup = () => {
        calls.push("cleanup");
      };
      steps.list = () => {
        calls.push("list");
        return Promise.resolve({
          status: 200,
          body: { users: posted.map((username) => ({ username })) },
        });
      };
      await expect(runSampleUserLifecycle(database, steps)).rejects.toThrow(/testuser_/);
      expect(calls).not.toContain("reset");
    });
  }
});

describe("#56 R(レビュー1)-6: 確かめと後始末の両方が失敗したとき、両方の原因が出る", () => {
  const registryWith = (cleanupError?: string): CleanupRegistry => {
    const registry = createCleanupRegistry();
    if (cleanupError !== undefined) {
      registry.add("docker compose down", () => {
        throw new Error(cleanupError);
      });
    }
    return registry;
  };

  it("#56 R(レビュー1)-6: 両方失敗：message に、確かめの原因と後始末の原因の両方がある", async () => {
    const failure = await runWithCleanup("d1", registryWith("後始末の原因-xyz"), () =>
      Promise.reject(new Error("確かめの原因-abc")),
    ).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toContain("確かめの原因-abc");
    expect(failure?.message).toContain("後始末の原因-xyz");
    expect(failure?.message).toContain("d1");
  });

  it("#56 R(レビュー1)-6: 確かめだけ失敗：その Error をそのまま投げ、後始末は実行する", async () => {
    const registry = createCleanupRegistry();
    let ran = false;
    registry.add("確認用", () => {
      ran = true;
    });
    const original = new Error("確かめの原因-abc");
    await expect(runWithCleanup("none", registry, () => Promise.reject(original))).rejects.toBe(
      original,
    );
    expect(ran).toBe(true);
  });

  it("#56 R(レビュー1)-6: 後始末だけ失敗：後始末の原因を示して失敗する", async () => {
    await expect(
      runWithCleanup("postgresql", registryWith("後始末の原因-xyz"), () => Promise.resolve("ok")),
    ).rejects.toThrow(/後始末の原因-xyz/);
  });

  it("#56 R(レビュー1)-6: どちらも成功：body の値を返し、後始末は実行する", async () => {
    const registry = createCleanupRegistry();
    let ran = false;
    registry.add("確認用", () => {
      ran = true;
    });
    await expect(runWithCleanup("d1", registry, () => Promise.resolve(42))).resolves.toBe(42);
    expect(ran).toBe(true);
  });
});
