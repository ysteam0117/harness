// 生成したプロジェクトが実際に動くことの確かめ（#56 AC-1・AC-2、R4・R5・R9）。
//
// 回答の YAML（架空の値）で3通り（D1・PostgreSQL・DB なし）のプロジェクトを、一時的なフォルダに生成し、それぞれ
//   npm install → npm run check → npm run build → 開発サーバー（/api/health・/・サンプルの利用者の API）→ Docker（docker compose up）
// を確かめて、起動したものはすべて止め、一時的なフォルダは消す。
// アプリ名は実行ごとに一意（smoke-<乱数>）で、同時に実行しても、コンテナ・ボリュームが混ざらない。
// 途中で中断（Ctrl+C・SIGTERM）しても、起動したプロセス（子孫を含む）・Docker の資源・一時的なフォルダを片付ける。
// 時間がかかるため、npm run check とは分けて、CI（ubuntu）で実行する。手元では npm run smoke:generated で実行できる。
//
// 環境変数
//   SMOKE_REQUIRE_DOCKER=1  Docker が使えないときに、PostgreSQL・Docker の確かめを飛ばさずに失敗にする（CI で使う）
//   SMOKE_CASES=d1,none     実行する通りを絞る（既定はすべて）
//   SMOKE_REQUIRE_TERRAFORM=1  terraform が使えないときに、terraform validate を飛ばさずに失敗にする（CI で使う）
//   SMOKE_SKIP_E2E=1        E2E（Playwright。ブラウザの導入が要る）を飛ばす
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// 通り（回答の YAML は、架空の値だけ）
// ---------------------------------------------------------------------------

export type SmokeCase = {
  /** 通りの名前（失敗したときに示す） */
  id: "d1" | "postgresql" | "none";
  database: "d1" | "postgresql" | "none";
  /** 回答の auth */
  auth: string;
  /** 回答の file_upload が yes か */
  fileUpload: boolean;
  /** harness create --answers に渡す YAML */
  answersYaml: string;
};

const APP_NAME = "testapp-001";

/** 架空の完全な回答（app_name は testapp-001）。over で上書きする */
export function buildAnswersYaml(over: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = {
    app_name: APP_NAME,
    ais: ["claude"],
    repository: "github",
    visibility: "private",
    team_size: "solo",
    database: "d1",
    auth: "oidc",
    idp: "google",
    personal_data: "none",
    admin: "no",
    critical_ops: "no",
    collaborative: "no",
    org_separation: "no",
    realtime: "no",
    availability: "tolerant",
    file_upload: "no",
    check_location: "both",
    version_policy: "verified",
    accepted_warnings: ["missing-tools"],
  };
  const merged = { ...base, ...over };
  // 質問の条件で聞かない回答は、書かない（回答ファイルの検証で誤りになるため）
  if (merged["auth"] !== "oidc" && merged["auth"] !== "both") delete merged["idp"];
  if (merged["file_upload"] !== "yes") delete merged["file_kinds"];
  if (merged["database"] !== "postgresql") delete merged["postgres_provider"];
  return stringifyYaml(merged);
}

function smokeCase(
  id: SmokeCase["id"],
  over: Record<string, unknown>,
  auth: string,
  fileUpload: boolean,
): SmokeCase {
  return {
    id,
    database: id,
    auth,
    fileUpload,
    answersYaml: buildAnswersYaml({ database: id, auth, ...over }),
  };
}

/** 3通り。アップロードあり・認証ありを1つは含める */
export const SMOKE_CASES: readonly SmokeCase[] = [
  smokeCase("d1", { idp: "google", file_upload: "yes", file_kinds: ["image"] }, "oidc", true),
  smokeCase("postgresql", { postgres_provider: "neon", auth: "app" }, "app", false),
  smokeCase("none", { auth: "none", idp: undefined }, "none", false),
];

/** GitHub を使わない（手元の Git だけ）通りの名前（#61）。SMOKE_CASES=local で選ぶ */
export const LOCAL_GIT_CASE_ID = "local";

/** GitHub を使わない通りの回答（DB なし・認証なし。公開範囲と品質チェックの実行場所は、local に決まる値） */
export function buildLocalGitAnswersYaml(): string {
  return buildAnswersYaml({
    repository: "local",
    visibility: "private",
    check_location: "local",
    database: "none",
    auth: "none",
    idp: undefined,
  });
}

type Env = Record<string, string | undefined>;

/** terraform validate の段階を実行するか。terraform がなければ飛ばす。SMOKE_REQUIRE_TERRAFORM=1 のときは失敗にする */
export function decideTerraformStep(available: boolean, env: Env): "run" | "skip" {
  if (available) return "run";
  if (env["SMOKE_REQUIRE_TERRAFORM"] === "1") {
    throw new Error("terraform が使えません（SMOKE_REQUIRE_TERRAFORM=1 のため、失敗にします）");
  }
  return "skip";
}

/** E2E の段階を実行するか（SMOKE_SKIP_E2E=1 で飛ばす） */
export function shouldRunE2e(env: Env): boolean {
  return env["SMOKE_SKIP_E2E"] !== "1";
}

/** Playwright のブラウザの導入の引数（npx に渡す）。CI（ubuntu）では、OS の部品も入れる */
export function playwrightInstallArgs(env: Env): string[] {
  return env["CI"] === "true"
    ? ["playwright", "install", "--with-deps", "chromium"]
    : ["playwright", "install", "chromium"];
}

/** 実行ごとに一意な、架空のアプリ名（smoke-<乱数>）。英小文字・数字・ハイフンだけ */
export function createSmokeAppName(): string {
  return `smoke-${randomBytes(4).toString("hex")}`;
}

/** 通りと、アプリ名から、この実行の回答の YAML・生成先のフォルダ名・Docker Compose のプロジェクト名を決める（すべて同じアプリ名） */
export function buildSmokeRun(
  c: SmokeCase,
  appName: string,
): { appName: string; answersYaml: string; projectDirName: string; composeProjectName: string } {
  const answers = parseYaml(c.answersYaml) as Record<string, unknown>;
  answers["app_name"] = appName;
  return {
    appName,
    answersYaml: stringifyYaml(answers),
    // harness create は <カレントのフォルダ>/<app_name> に出す
    projectDirName: appName,
    // 生成物の docker-compose.yml の name は app_name
    composeProjectName: appName,
  };
}

// ---------------------------------------------------------------------------
// 部品
// ---------------------------------------------------------------------------

/** どの通り・どの段階で失敗したかを示す誤り */
export class SmokeError extends Error {
  readonly caseId: string;
  readonly stage: string;
  constructor(caseId: string, stage: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SmokeError";
    this.caseId = caseId;
    this.stage = stage;
  }
}

/** fn の失敗を、通り（caseId）・段階（stage）を示した SmokeError にして投げる */
export async function runStage<T>(
  caseId: string,
  stage: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new SmokeError(caseId, stage, `[${caseId}] ${stage} で失敗しました：${detail}`, {
      cause: e,
    });
  }
}

/** 今空いている、待ち受けできるポート */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("空いているポートを決められませんでした"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** GET が 200 を返すまで待つ。時間内に返らなければ、URL を示した Error で reject */
export async function waitForOk(
  url: string,
  opts: { timeoutMs: number; intervalMs?: number },
): Promise<void> {
  const interval = opts.intervalMs ?? 500;
  const deadline = Date.now() + opts.timeoutMs;
  let last: string | undefined;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.max(interval, 2000)) });
      if (response.status === 200) return;
      last = `状態コード ${String(response.status)}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${url} が ${String(opts.timeoutMs)}ms 以内に 200 を返しませんでした（${last ?? "応答なし"}）`,
      );
    }
    await sleep(interval);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** pid の子孫のプロセス（Windows 以外）。ps の出力から木をたどる */
function descendantsOf(rootPid: number): number[] {
  const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  if (ps.status !== 0) return [];
  const children = new Map<number, number[]>();
  for (const line of ps.stdout.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || ppid === undefined || Number.isNaN(pid) || Number.isNaN(ppid))
      continue;
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const out: number[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const next = queue.shift() as number;
    for (const child of children.get(next) ?? []) {
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

async function waitUntilDead(pids: number[], timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let alive = pids.filter(isAlive);
  while (alive.length > 0 && Date.now() < deadline) {
    await sleep(50);
    alive = alive.filter(isAlive);
  }
  return alive;
}

/**
 * 子プロセスとその子孫を止め、終了するまで待つ（C-69）。npm run dev が起動する workerd 等も止める。
 * すでに終わっていてもエラーにしない。
 */
export async function stopProcess(
  child: ChildProcess,
  opts: { graceMs?: number } = {},
): Promise<void> {
  const graceMs = opts.graceMs ?? 5000;
  const pid = child.pid;
  if (pid === undefined) return;
  const exited = child.exitCode !== null || child.signalCode !== null;
  const exitPromise = exited
    ? Promise.resolve()
    : new Promise<void>((resolve) => child.once("exit", () => resolve()));
  // 親が終わる前に、子孫を集める
  const targets = process.platform === "win32" ? [pid] : [pid, ...descendantsOf(pid)];

  if (process.platform === "win32") {
    // 木ごと止める（すでにないプロセスの失敗は無視する）
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    for (const target of targets) {
      try {
        process.kill(target, "SIGTERM");
      } catch {
        /* すでに終わっている */
      }
    }
    const left = await waitUntilDead(targets, graceMs);
    for (const target of left) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        /* すでに終わっている */
      }
    }
  }
  await Promise.race([exitPromise, sleep(graceMs)]);
  const stillAlive = await waitUntilDead(targets, graceMs);
  if (stillAlive.length > 0) {
    throw new Error(`プロセスを止められませんでした（pid：${stillAlive.join("、")}）`);
  }
}

/** 接続先が手元（localhost・127.0.0.1・[::1]）でなければエラー（ホスト名だけを示す。パスワードは示さない） */
export function assertLocalDatabaseUrl(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DB の接続先を URL として読めません（値は表示しません）");
  }
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"];
  if (!local.includes(host)) {
    throw new Error(
      `DB の接続先が手元ではありません（ホスト名：${host}）。手元の DB だけにつなぎます`,
    );
  }
}

// ---------------------------------------------------------------------------
// 起動したものの記録と後始末
// ---------------------------------------------------------------------------

/** プロセスの表（親の pid → 子の pid の一覧）。Windows は PowerShell、それ以外は ps で取る */
async function processTable(): Promise<Map<number, number[]>> {
  const [command, args] =
    process.platform === "win32"
      ? [
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
          ],
        ]
      : ["ps", ["-A", "-o", "pid=,ppid="]];
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(command as string, args as string[], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.once("error", (e) =>
      reject(new Error(`${String(command)} を実行できませんでした：${e.message}`)),
    );
    child.once("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(
            new Error(
              `${String(command)} が失敗しました（終了コード ${String(code)}）：${err.trim()}`,
            ),
          ),
    );
  });
  const children = new Map<number, number[]>();
  for (const line of stdout.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || ppid === undefined || Number.isNaN(pid) || Number.isNaN(ppid)) {
      continue;
    }
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  return children;
}

/** 与えられた pid を止める。止められずに残った pid を返す */
async function killPids(pids: number[], graceMs = 5000): Promise<number[]> {
  if (process.platform === "win32") {
    for (const pid of pids) {
      // 木ごと止める（すでにないプロセスの失敗は無視する）
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    }
    return waitUntilDead(pids, graceMs);
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* すでに終わっている */
    }
  }
  const left = await waitUntilDead(pids, graceMs);
  for (const pid of left) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* すでに終わっている */
    }
  }
  return waitUntilDead(left, graceMs);
}

export type CleanupRegistry = {
  /** 起動した直後に呼ぶ。子孫も記録の対象（snapshot で集める。記録している間は、短い間隔で自動でも集める） */
  trackProcess(child: ChildProcess): void;
  /** 今の、記録した全プロセスの子孫を、記録に足す（親が先に終わっても止められるように） */
  snapshot(): Promise<void>;
  /** docker compose の資源（コンテナ・ボリューム）。同じ dir を2回足しても down は1回 */
  trackCompose(projectDir: string): void;
  /** そのほかの後始末（フォルダの削除等） */
  add(name: string, run: () => void | Promise<void>): void;
  /**
   * 記録した全プロセスと子孫を止め、登録の逆順にすべて実行する（途中で失敗しても続ける）。
   * 失敗の文言（"<名前>：<理由>"）の配列を返す。2回目以降は後始末をやり直さず、1回目の完了を待って同じ結果を返す
   */
  runAll(): Promise<string[]>;
};

const SNAPSHOT_INTERVAL_MS = 300;

async function defaultComposeDown(projectDir: string): Promise<void> {
  await runCommand("docker", [...composeArgs(projectDir), "down", "-v", "--remove-orphans"], {
    cwd: projectDir,
    timeoutMs: 180_000,
  });
}

function composeArgs(
  projectDir: string,
  environment: "development" | "test" = "development",
): string[] {
  const pkg = JSON.parse(readFileSync(path.join(projectDir, "package.json"), "utf8")) as {
    name: string;
  };
  return [
    "compose",
    "--env-file",
    `.env.${environment}`,
    "-p",
    environment === "test" ? `${pkg.name}-test` : pkg.name,
  ];
}

export function createCleanupRegistry(
  opts: { composeDown?: (projectDir: string) => void | Promise<void> } = {},
): CleanupRegistry {
  const composeDown = opts.composeDown ?? defaultComposeDown;
  const items: { name: string; run: () => void | Promise<void> }[] = [];
  const composeDirs = new Set<string>();
  /** 記録した、生きているプロセス（起動したものと、その子孫） */
  const known = new Set<number>();
  let done = false;
  let polling = false;
  let snapshotError: string | undefined;
  let chain: Promise<void> = Promise.resolve();
  let running: Promise<string[]> | undefined;

  const takeSnapshot = async (): Promise<void> => {
    try {
      const table = await processTable();
      const queue = [...known];
      while (queue.length > 0) {
        const parent = queue.shift() as number;
        for (const child of table.get(parent) ?? []) {
          if (child === process.pid || known.has(child)) continue;
          known.add(child);
          queue.push(child);
        }
      }
      // 終わったプロセスの pid は、別のプロセスに使い回されうるため、記録から外す
      for (const pid of [...known]) if (!isAlive(pid)) known.delete(pid);
      snapshotError = undefined;
    } catch (e) {
      snapshotError = e instanceof Error ? e.message : String(e);
    }
  };

  const snapshot = (): Promise<void> => {
    // 呼んだ時点より前の表で済ませないよう、毎回あらためて取る（直列にする）
    chain = chain.then(takeSnapshot);
    return chain;
  };

  const runOnce = async (): Promise<string[]> => {
    done = true;
    const failures: string[] = [];
    // 一時的なフォルダを消す前に、まずプロセスを止める
    await snapshot();
    if (snapshotError !== undefined) {
      failures.push(`プロセスの記録：${snapshotError}`);
    }
    const targets = [...known].filter((pid) => pid !== process.pid);
    if (targets.length > 0) {
      const left = await killPids(targets);
      if (left.length > 0) {
        failures.push(`プロセスの停止：止められませんでした（pid：${left.join("、")}）`);
      }
    }
    for (const item of items.splice(0).reverse()) {
      try {
        await item.run();
      } catch (e) {
        failures.push(`${item.name}：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return failures;
  };

  const poll = async (): Promise<void> => {
    while (!done) {
      await new Promise<void>((resolve) => setTimeout(resolve, SNAPSHOT_INTERVAL_MS).unref());
      if (done) break;
      await snapshot();
    }
  };

  return {
    trackProcess(child) {
      if (child.pid === undefined) return;
      known.add(child.pid);
      if (!polling) {
        polling = true;
        void poll();
      }
    },
    snapshot,
    trackCompose(projectDir) {
      if (composeDirs.has(projectDir)) return;
      composeDirs.add(projectDir);
      items.push({
        name: `docker compose down（${projectDir}）`,
        run: () => composeDown(projectDir),
      });
    },
    add(name, run) {
      items.push({ name, run });
    },
    runAll() {
      // 2回目以降も、1回目の完了を待って、同じ結果を返す（途中で信号を受けても、後始末の完了前に終わらせない）
      running ??= runOnce();
      return running;
    },
  };
}

/**
 * SIGINT・SIGTERM を受けたら、後始末（registry.runAll）をしてから終了する（SIGINT は 130、SIGTERM は 143）。
 * 続けて同じ信号が来ても、後始末は1回だけ。戻り値は、登録を外す関数
 */
export function installInterruptHandlers(
  registry: CleanupRegistry,
  opts: { exit?: (code: number) => void } = {},
): () => void {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let started = false;
  const handler = (signal: "SIGINT" | "SIGTERM", code: number) => () => {
    if (started) return;
    started = true;
    console.error(`${signal} を受けました。起動したものを片付けています…`);
    void registry.runAll().then((failures) => {
      for (const failure of failures) console.error(`後始末に失敗しました：${failure}`);
      exit(code);
    });
  };
  const onInt = handler("SIGINT", 130);
  const onTerm = handler("SIGTERM", 143);
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  return () => {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
  };
}

/**
 * body を実行し、成功しても失敗しても、必ず registry.runAll() で片付ける。
 * 確かめと後始末の両方が失敗したときは、両方の原因を message に含める。片方だけなら、その原因
 */
export async function runWithCleanup<T>(
  caseId: string,
  registry: CleanupRegistry,
  body: () => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  let failure: { error: unknown } | undefined;
  try {
    result = await body();
  } catch (e) {
    failure = { error: e };
  }
  const cleanupFailures = await registry.runAll();
  if (cleanupFailures.length > 0) {
    const cleanupText = `後始末の失敗：\n${cleanupFailures.join("\n")}`;
    if (failure === undefined)
      throw new Error(`[${caseId}] 後始末に失敗しました：\n${cleanupFailures.join("\n")}`);
    const original = failure.error;
    const originalText = original instanceof Error ? original.message : String(original);
    throw new AggregateError(
      [original, new Error(cleanupText)],
      `[${caseId}] 確かめと後始末の両方で失敗しました\n確かめの失敗：${originalText}\n${cleanupText}`,
      { cause: original },
    );
  }
  if (failure !== undefined) throw failure.error;
  return result as T;
}

// ---------------------------------------------------------------------------
// コマンドの実行
// ---------------------------------------------------------------------------

function npmCli(): string {
  const cli = process.env["npm_execpath"];
  if (!cli) {
    throw new Error("npm run smoke:generated で実行してください（npm_execpath が見つかりません）");
  }
  return cli;
}

const OUTPUT_TAIL = 4000;

/**
 * コマンドを実行して、成功なら標準出力を返す。失敗なら、終了コードと出力の終わりの部分を付けて Error にする。
 * registry があれば、起動したプロセスを記録する。時間切れ（timeoutMs）のときは、プロセスと子孫を止めてから、
 * 「時間切れ」を含む Error で失敗する
 */
export function runCommand(
  command: string,
  args: string[],
  opts: {
    cwd: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    input?: string;
    registry?: CleanupRegistry;
  },
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 600_000;
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    opts.registry?.trackProcess(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    // 入力を渡さないときも、標準入力は閉じる（待ち続けないように）
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.input ?? "");

    const timer = setTimeout(() => {
      timedOut = true;
      void stopProcess(child).then(
        () => {
          settled = true;
          reject(
            new Error(
              `${command} ${args.join(" ")} が時間切れになりました（${String(timeoutMs)}ms）。プロセスを止めました`,
            ),
          );
        },
        (e: unknown) => {
          settled = true;
          reject(
            new Error(
              `${command} ${args.join(" ")} が時間切れになり、止められませんでした：${e instanceof Error ? e.message : String(e)}`,
            ),
          );
        },
      );
    }, timeoutMs);

    child.once("error", (e) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new Error(`${command} を実行できませんでした：${e.message}`));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (settled || timedOut) return;
      settled = true;
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const tail = `${stdout}\n${stderr}`.trim().slice(-OUTPUT_TAIL);
      reject(
        new Error(
          `${command} ${args.join(" ")} が失敗しました（終了コード ${String(code ?? signal)}）：\n${tail}`,
        ),
      );
    });
  });
}

type Npm = (
  args: string[],
  cwd: string,
  env?: Record<string, string>,
  timeoutMs?: number,
) => Promise<string>;

const makeNpm =
  (registry?: CleanupRegistry): Npm =>
  (args, cwd, env, timeoutMs) =>
    runCommand(process.execPath, [npmCli(), ...args], {
      cwd,
      ...(env ? { env } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
      ...(registry ? { registry } : {}),
    });

function dockerAvailable(): boolean {
  const r = spawnSync("docker", ["info"], { stdio: "ignore", windowsHide: true });
  return r.status === 0;
}

/** OIDC の接続先の項目（空のときに入れる架空の値。開発・検証で同じ。#72） */
const OIDC_ENDPOINT_DUMMIES: Readonly<Record<string, string>> = {
  OIDC_ISSUER: "https://idp.example.test",
  OIDC_REDIRECT_URI: "http://localhost:5173/api/auth/oidc/callback",
  APP_BASE_URL: "http://localhost:5173",
};

/** 空の項目（SESSION_SECRET など）に入れる、架空の値（環境ごとに別の値） */
function smokeDummyValue(environment: "development" | "test", name: string): string {
  return `dummy_smoke_${environment}_${name.toLowerCase()}`;
}

/**
 * SESSION_SECRET の架空の値（writeEnvFile が補う値と同じ）。実 DB のセッションの確認（R2）は、この値でハッシュを計算して、
 * 検証用の DB に行を入れる。実際の秘密情報ではない
 */
export function smokeSessionSecret(environment: "development" | "test"): string {
  return smokeDummyValue(environment, "SESSION_SECRET");
}

/** .env.example の項目に、値を重ねて環境別の .env を作る（架空の値だけ）。 */
export function writeEnvFile(
  projectDir: string,
  environment: "development" | "test",
  values: Record<string, string>,
): void {
  const lines = readFileSync(path.join(projectDir, ".env.example"), "utf8").split("\n");
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const eq = line.indexOf("=");
    if (line.startsWith("#") || eq <= 0) return line;
    const name = line.slice(0, eq);
    seen.add(name);
    if (Object.hasOwn(values, name)) return `${name}=${values[name] as string}`;
    if (
      line.slice(eq + 1) === "" &&
      ["SESSION_SECRET", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"].includes(name)
    ) {
      return `${name}=${smokeDummyValue(environment, name)}`;
    }
    const endpoint = OIDC_ENDPOINT_DUMMIES[name];
    if (line.slice(eq + 1) === "" && endpoint !== undefined) return `${name}=${endpoint}`;
    return line;
  });
  for (const [name, value] of Object.entries(values)) {
    if (!seen.has(name)) out.push(`${name}=${value}`);
  }
  writeFileSync(path.join(projectDir, `.env.${environment}`), `${out.join("\n").trimEnd()}\n`);
}

function assertBuildHasNoDummySecret(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) assertBuildHasNoDummySecret(file);
    else if (entry.isFile() && readFileSync(file).includes("dummy_private_51")) {
      throw new Error("組み立ての結果に、環境の架空の秘密が混入しました");
    }
  }
}

// ---------------------------------------------------------------------------
// 例の機能（サンプルの利用者）を API 経由で確かめる
// ---------------------------------------------------------------------------

async function requestJson(
  url: string,
  init: { method?: string; origin?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.origin !== undefined ? { Origin: init.origin } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    /* JSON でない応答は、文字列のまま返す */
  }
  return { status: response.status, body };
}

const getJson = (url: string) => requestJson(url);

/** 生成物の ALLOWED_ORIGINS の開発の値（状態を変える要求の送信元の確認を通る Origin） */
const ALLOWED_ORIGIN = "http://localhost:5173";

function expectEqual(actual: unknown, expected: unknown, what: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${what} が想定と違います（想定：${JSON.stringify(expected)}、実際：${JSON.stringify(actual)}）`,
    );
  }
}

/** 例の機能を API 経由で確かめる共通の手順の、実際の操作 */
export type SampleUserSteps = {
  /** POST /api/sample-users { username }。成功は 2xx */
  post(username: string): Promise<{ status: number; body: unknown }>;
  /** GET /api/sample-users。成功は 200、本文は { users: { username: string }[] } */
  list(): Promise<{ status: number; body: unknown }>;
  /** npm run db:cleanup */
  cleanup(): void | Promise<void>;
  /** npm run db:reset:local */
  reset(): void | Promise<void>;
};

function usernamesOf(response: { status: number; body: unknown }, database: string): string[] {
  if (response.status !== 200) {
    throw new Error(
      `[${database}] GET /api/sample-users が 200 を返しませんでした（状態コード ${String(response.status)}）`,
    );
  }
  const users = (response.body as { users?: unknown }).users;
  if (!Array.isArray(users)) {
    throw new Error(
      `[${database}] GET /api/sample-users の本文が { users: [...] } の形ではありません`,
    );
  }
  return users.map((user) => (user as { username?: unknown }).username as string);
}

/**
 * 順に：追加（API）→ 一覧で読み戻す → 後始末 → 一覧で消えた → 初期化。D1・PostgreSQL の両方で使う。
 * 失敗したら、database と原因（名前）を示して失敗し、後の手順は呼ばない
 */
export async function runSampleUserLifecycle(
  database: "d1" | "postgresql",
  steps: SampleUserSteps,
): Promise<void> {
  const username = `testuser_${randomBytes(4).toString("hex")}`;
  const posted = await steps.post(username);
  if (posted.status < 200 || posted.status >= 300) {
    throw new Error(
      `[${database}] POST /api/sample-users（${username}）が成功しませんでした（状態コード ${String(posted.status)}）`,
    );
  }
  if (!usernamesOf(await steps.list(), database).includes(username)) {
    throw new Error(
      `[${database}] 追加した ${username} を、一覧（GET /api/sample-users）で読み戻せません`,
    );
  }
  await steps.cleanup();
  if (usernamesOf(await steps.list(), database).includes(username)) {
    throw new Error(`[${database}] 後始末（db:cleanup）のあとも、${username} が残っています`);
  }
  await steps.reset();
}

/** 追加できない場合（入力の誤り・送信元の違い）の応答を確かめる */
async function checkSampleUserRejections(base: string): Promise<void> {
  const url = `${base}/api/sample-users`;
  const invalid = await requestJson(url, {
    method: "POST",
    origin: ALLOWED_ORIGIN,
    body: { username: "" },
  });
  expectEqual(invalid.status, 422, "不正な入力の POST の状態コード");
  const foreign = await requestJson(url, {
    method: "POST",
    origin: "https://origin.invalid",
    body: { username: "testuser_foreign_origin" },
  });
  expectEqual(foreign.status, 403, "送信元の違う POST の状態コード");
  // 同じユーザー名の2回目は、DB の一意の制約の違反を Repository が知らせ、409 になる（DB の種類ごとのエラーの形を通る）
  const duplicate = { username: `testuser_dup_${randomBytes(4).toString("hex")}` };
  const first = await requestJson(url, { method: "POST", origin: ALLOWED_ORIGIN, body: duplicate });
  expectEqual(first.status, 201, "重複の確かめ：1回目の POST の状態コード");
  const second = await requestJson(url, {
    method: "POST",
    origin: ALLOWED_ORIGIN,
    body: duplicate,
  });
  expectEqual(second.status, 409, "重複の確かめ：同じユーザー名の2回目の POST の状態コード");
}

function sampleUserSteps(
  base: string,
  actions: { cleanup: () => Promise<void>; reset: () => Promise<void> },
): SampleUserSteps {
  return {
    post: (username) =>
      requestJson(`${base}/api/sample-users`, {
        method: "POST",
        origin: ALLOWED_ORIGIN,
        body: { username },
      }),
    list: () => getJson(`${base}/api/sample-users`),
    cleanup: actions.cleanup,
    reset: actions.reset,
  };
}

/** シードした架空のデータ（testuser_001）が一覧にあること */
async function expectSeeded(base: string, database: string, what: string): Promise<void> {
  const names = usernamesOf(await getJson(`${base}/api/sample-users`), database);
  if (!names.includes("testuser_001")) {
    throw new Error(
      `${what}：シードしたデータ（testuser_001）が一覧にありません（${names.join("、")}）`,
    );
  }
}

// ---------------------------------------------------------------------------
// 認証ありの通り：実際の DB（D1・PostgreSQL）でのセッションの確認（#73 R2）
// ---------------------------------------------------------------------------

/** 確認に使う、架空の利用者（C-05：e2euser_ で始め、cleanup.sql で識別して消す） */
export const SMOKE_SESSION_USER = {
  id: "e2euser_session_001",
  email: "e2euser_session_001@example.com",
} as const;

/** 固定の架空の識別子（smoke-session-<番号> を 32 バイトにそろえて base64url にした 43 文字。生成物の識別子と同じ形） */
export function smokeSessionId(n: number): string {
  return Buffer.from(`smoke-session-${String(n).padStart(4, "0")}`.padEnd(32, "_")).toString(
    "base64url",
  );
}

/** DB に保存される値。生成物の hashSessionId（HMAC-SHA-256・16 進数）と同じ計算 */
export function hashSmokeSessionId(id: string, secret: string): string {
  return createHmac("sha256", secret).update(id).digest("hex");
}

export type SessionSeed = {
  /** 検証用の DB に流す SQL（利用者1人と、有効・期限切れのセッション1つずつ） */
  sql: string;
  valid: { id: string; hash: string };
  expired: { id: string; hash: string };
};

/** 実 DB に入れる行の SQL。D1 の日時はミリ秒の整数、PostgreSQL は timestamptz。期限切れは、期限もアイドルも過去 */
export function buildSessionSeed(
  database: "d1" | "postgresql",
  now: Date,
  secret: string,
): SessionSeed {
  const valid = { id: smokeSessionId(1), hash: "" };
  const expired = { id: smokeSessionId(2), hash: "" };
  valid.hash = hashSmokeSessionId(valid.id, secret);
  expired.hash = hashSmokeSessionId(expired.id, secret);
  const HOUR = 60 * 60 * 1000;
  const at = (ms: number): string =>
    database === "d1" ? String(ms) : `to_timestamp(${String(ms / 1000)})`;
  const t = now.getTime();
  const row = (hash: string, createdAt: number, lastSeenAt: number, expiresAt: number): string =>
    `('${hash}', '${SMOKE_SESSION_USER.id}', ${at(createdAt)}, ${at(lastSeenAt)}, ${at(expiresAt)})`;
  const sql = [
    "-- smoke（実 DB のセッションの確認）用の架空のデータ。後始末（cleanup.sql）で、e2euser_ の利用者ごと消える",
    `INSERT INTO users (id, email, created_at) VALUES ('${SMOKE_SESSION_USER.id}', '${SMOKE_SESSION_USER.email}', ${at(t)}) ON CONFLICT (id) DO NOTHING;`,
    "INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at) VALUES",
    `${row(valid.hash, t, t, t + HOUR)},`,
    `${row(expired.hash, t - 48 * HOUR, t - 48 * HOUR, t - HOUR)};`,
    "",
  ].join("\n");
  return { sql, valid, expired };
}

/** 数を数える SQL（結果の列の名前は alias） */
export function buildCountSql(table: "sessions" | "users", where: string, alias: string): string {
  return `SELECT COUNT(*) AS ${alias} FROM ${table} WHERE ${where};\n`;
}

/** wrangler（JSON・表）・psql（表）のどの出力からでも、列 alias の件数を読む。読めなければ Error */
export function parseCount(output: string, alias: string): number {
  const match = new RegExp(String.raw`${alias}\D+(\d+)`).exec(output);
  if (match === null) {
    throw new Error(`SQL の結果から ${alias} の件数を読めません：${output.trim().slice(-300)}`);
  }
  return Number(match[1]);
}

/** e2e/seeds/ の下に一時的な SQL を作り、検証用 DB に流して、出力を返す（流した後は消す。db-local の seed-file の規則は変えない） */
async function runSeedSql(
  projectDir: string,
  registry: CleanupRegistry,
  name: string,
  sql: string,
): Promise<string> {
  const file = `e2e/seeds/${name}.sql`;
  writeFileSync(path.join(projectDir, file), sql);
  try {
    return await runCommand(process.execPath, ["scripts/db-local.ts", "test", "seed-file", file], {
      cwd: projectDir,
      timeoutMs: 300_000,
      registry,
    });
  } finally {
    rmSync(path.join(projectDir, file), { force: true });
  }
}

/**
 * 実 DB のセッションの確認。検証用の DB に、有効・期限切れのセッションの行を入れ、検証用のサーバー（dev:test）に対して
 * GET /api/auth/me（200・期限切れの 401・Cookie なしの 401）→ POST /api/auth/logout（204）→ 同じ Cookie の 401 → DB の行が消えたこと、
 * の順に確かめる。最後に、cleanup で架空の利用者を消し、残りが 0 件になることを確かめる。
 */
async function checkSessionAgainstRealDb(
  database: "d1" | "postgresql",
  projectDir: string,
  server: DevServer,
  registry: CleanupRegistry,
): Promise<void> {
  const npm = makeNpm(registry);
  const seed = buildSessionSeed(database, new Date(), smokeSessionSecret("test"));
  await runSeedSql(projectDir, registry, "session-smoke", seed.sql);
  const rows = async (hash: string): Promise<number> =>
    parseCount(
      await runSeedSql(
        projectDir,
        registry,
        "session-count",
        buildCountSql("sessions", `id_hash = '${hash}'`, "session_rows"),
      ),
      "session_rows",
    );
  const me = (id?: string) =>
    fetch(`${server.url}/api/auth/me`, {
      headers: id === undefined ? {} : { Cookie: `session=${id}` },
      signal: AbortSignal.timeout(15_000),
    });
  const noStore = (response: Response, what: string): void =>
    expectEqual(response.headers.get("cache-control"), "no-store", `${what} の Cache-Control`);

  expectEqual(await rows(seed.valid.hash), 1, "シードした有効なセッションの行数");
  const ok = await me(seed.valid.id);
  expectEqual(ok.status, 200, "有効なセッションの /api/auth/me の状態コード");
  expectEqual(
    await ok.json(),
    { id: SMOKE_SESSION_USER.id, email: SMOKE_SESSION_USER.email },
    "/api/auth/me の本文",
  );
  noStore(ok, "/api/auth/me（200）");

  const expired = await me(seed.expired.id);
  expectEqual(expired.status, 401, "期限切れのセッションの /api/auth/me の状態コード");
  noStore(expired, "/api/auth/me（期限切れの 401）");
  expectEqual(await rows(seed.expired.hash), 0, "期限切れの行（検証のときに消える）の行数");
  expectEqual((await me()).status, 401, "Cookie なしの /api/auth/me の状態コード");

  const logout = await fetch(`${server.url}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: `session=${seed.valid.id}`, Origin: ALLOWED_ORIGIN },
    signal: AbortSignal.timeout(15_000),
  });
  expectEqual(logout.status, 204, "POST /api/auth/logout の状態コード");
  expectEqual((await me(seed.valid.id)).status, 401, "ログアウトの後の、同じ Cookie の状態コード");
  expectEqual(
    await rows(seed.valid.hash),
    0,
    "ログアウトの後の、セッションの行数（サーバー側の無効化）",
  );

  await npm(["run", "db:cleanup:test"], projectDir);
  expectEqual(
    parseCount(
      await runSeedSql(
        projectDir,
        registry,
        "session-count",
        buildCountSql("users", "email LIKE 'e2euser!_%' ESCAPE '!'", "user_rows"),
      ),
      "user_rows",
    ),
    0,
    "後始末（db:cleanup:test）の後の、架空の利用者の行数",
  );
  console.log(
    `[${database}] 実 DB のセッションの確認（/api/auth/me の 200・期限切れの 401・ログアウト・行の削除・後始末）に成功しました`,
  );
}

// ---------------------------------------------------------------------------
// 開発サーバー
// ---------------------------------------------------------------------------

type DevServer = { child: ChildProcess; port: number; url: string; log: () => string };

/** 開発サーバー（npm run dev）を、空いているポートで起動する。止めるのは stopProcess */
export function startDevServer(
  projectDir: string,
  port: number,
  registry: CleanupRegistry,
  environment: "development" | "test" = "development",
): DevServer {
  const child = spawn(
    process.execPath,
    [
      npmCli(),
      "run",
      environment === "test" ? "dev:test" : "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: projectDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  registry.trackProcess(child);
  let output = "";
  const collect = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-OUTPUT_TAIL);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  return { child, port, url: `http://127.0.0.1:${String(port)}`, log: () => output };
}

/** 開発サーバーが 200 を返すまで待つ。起動に失敗して終わったときは、出力を示す */
async function waitForDevServer(server: DevServer): Promise<void> {
  const failed = new Promise<never>((_resolve, reject) => {
    server.child.once("exit", (code) =>
      reject(
        new Error(`開発サーバーが終了しました（終了コード ${String(code)}）：\n${server.log()}`),
      ),
    );
  });
  try {
    await Promise.race([
      waitForOk(`${server.url}/api/health`, { timeoutMs: 180_000, intervalMs: 1000 }),
      failed,
    ]);
  } catch (e) {
    throw new Error(`${e instanceof Error ? e.message : String(e)}\n${server.log()}`, {
      cause: e,
    });
  }
}

/** 開発サーバーの /api/health・/ を確かめる。DB なしのときは、/api/sample-users が無いことも確かめる */
async function checkServer(
  base: string,
  database: string,
  environment: "development" | "test" = "development",
): Promise<void> {
  const health = await getJson(`${base}/api/health`);
  expectEqual(health.status, 200, "/api/health の状態コード");
  expectEqual((health.body as { status?: unknown }).status, "ok", "/api/health の status");
  expectEqual((health.body as { appEnv?: unknown }).appEnv, environment, "/api/health の APP_ENV");
  const home = await fetch(`${base}/`, { signal: AbortSignal.timeout(15_000) });
  const html = await home.text();
  if (home.status !== 200 || !html.includes('<div id="root">')) {
    throw new Error(`画面（/）の HTML を配信できていません（状態コード ${String(home.status)}）`);
  }
  if (database === "none") {
    const users = await getJson(`${base}/api/sample-users`);
    expectEqual(users.status, 404, "DB なしのときの /api/sample-users の状態コード");
  }
}

async function withDevServer<T>(
  projectDir: string,
  registry: CleanupRegistry,
  fn: (server: DevServer) => Promise<T>,
  environment: "development" | "test" = "development",
): Promise<T> {
  const server = startDevServer(projectDir, await pickFreePort(), registry, environment);
  try {
    await waitForDevServer(server);
    return await fn(server);
  } finally {
    await stopProcess(server.child);
  }
}

/** DB ありの通り（手元の開発サーバー）：初期化 → シード → API で追加・読む → 後始末 → もう一度初期化して同じ結果 */
async function checkDatabaseLifecycle(
  id: "d1" | "postgresql",
  projectDir: string,
  registry: CleanupRegistry,
  prepare: () => Promise<void>,
): Promise<void> {
  const npm = makeNpm(registry);
  await runStage(id, "DB：マイグレーションとシード", prepare);
  await runStage(id, "開発サーバー（シードの後）：API で追加・読み戻し・後始末", () =>
    withDevServer(projectDir, registry, async (server) => {
      await checkServer(server.url, id);
      await expectSeeded(server.url, id, "シードの後");
      await checkSampleUserRejections(server.url);
      await runSampleUserLifecycle(
        id,
        sampleUserSteps(server.url, {
          cleanup: async () => {
            await npm(["run", "db:cleanup"], projectDir);
          },
          reset: async () => {
            // D1 のファイルを消すため、開発サーバーを止めてから初期化する
            await stopProcess(server.child);
            await npm(["run", "db:reset:local"], projectDir);
          },
        }),
      );
    }),
  );
  await runStage(id, "開発サーバー（初期化をもう一度した後）", () =>
    withDevServer(projectDir, registry, async (server) => {
      await checkServer(server.url, id);
      await expectSeeded(server.url, id, "初期化の後");
    }),
  );
}

const testDatabases = new WeakSet<CleanupRegistry>();

/** 検証用の PostgreSQL のコンテナを起動して待つ。後始末（down -v）は、通りごとに1回だけ登録する */
async function startTestDatabase(projectDir: string, registry: CleanupRegistry): Promise<void> {
  if (!testDatabases.has(registry)) {
    testDatabases.add(registry);
    registry.add("検証用 Docker Compose の後始末", () =>
      runCommand("docker", [...composeArgs(projectDir, "test"), "down", "-v", "--remove-orphans"], {
        cwd: projectDir,
        timeoutMs: 180_000,
      }).then(() => undefined),
    );
  }
  await runCommand("docker", [...composeArgs(projectDir, "test"), "up", "-d", "--wait", "db"], {
    cwd: projectDir,
    timeoutMs: 300_000,
    registry,
  });
}

/** 検証環境のAPIを動かし、開発環境に書いた記録が残ることを確かめる。 */
async function checkTestIsolation(
  c: SmokeCase,
  projectDir: string,
  registry: CleanupRegistry,
): Promise<void> {
  const npm = makeNpm(registry);
  if (c.database === "none") {
    await withDevServer(
      projectDir,
      registry,
      (server) => checkServer(server.url, "none", "test"),
      "test",
    );
    return;
  }
  const marker = `testuser_devonly_${randomBytes(4).toString("hex")}`;
  await withDevServer(projectDir, registry, async (server) => {
    const posted = await requestJson(`${server.url}/api/sample-users`, {
      method: "POST",
      origin: ALLOWED_ORIGIN,
      body: { username: marker },
    });
    expectEqual(posted.status, 201, "開発DBの識別用記録の追加");
  });
  const database = c.database;
  if (database === "postgresql") await startTestDatabase(projectDir, registry);
  await npm(["run", "db:migrate:test"], projectDir);
  await npm(["run", "db:seed:test"], projectDir);
  await withDevServer(
    projectDir,
    registry,
    async (server) => {
      await checkServer(server.url, c.database, "test");
      await expectSeeded(server.url, c.database, "検証DB");
      const names = usernamesOf(await getJson(`${server.url}/api/sample-users`), c.database);
      if (names.includes(marker)) throw new Error("検証DBに開発DBの記録が混入しました");
      // 認証ありの通りは、実際の DB でセッションを確かめる（#73 R2）
      if (c.auth !== "none") {
        await runStage(c.id, "実 DB のセッション（/api/auth/me・期限切れ・ログアウト）", () =>
          checkSessionAgainstRealDb(database, projectDir, server, registry),
        );
      }
    },
    "test",
  );
  await withDevServer(projectDir, registry, async (server) => {
    await checkServer(server.url, c.database);
    const names = usernamesOf(await getJson(`${server.url}/api/sample-users`), c.database);
    if (!names.includes(marker)) throw new Error("検証操作のあと、開発DBの記録が失われました");
  });
}

// ---------------------------------------------------------------------------
// E2E（Playwright）と Terraform（#64）
// ---------------------------------------------------------------------------

/** E2E の画面のポート（生成物の e2e_port）。Playwright が検証用サーバーをこのポートで起動する */
const E2E_PORT = 5173;

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

/** E2E のあと、検証用サーバーが止まって、ポートが解放されたことを確かめる */
async function expectE2ePortReleased(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (await portIsFree(E2E_PORT)) return;
    await sleep(200);
  }
  throw new Error(`E2E のあと、ポート ${String(E2E_PORT)} が解放されていません`);
}

/**
 * 生成物の E2E（npm run test:e2e）。DB ありの通りは、npm run test:e2e の前処理（pretest:e2e）が検証用 DB を初期化するため、
 * D1 は2回続けて実行して、既存のデータがある状態（2回目）でも初期化とシードの取得が成功することを確かめる。
 * PostgreSQL は、検証用 DB のコンテナを起動して待ってから実行する。
 */
async function e2eStage(
  c: SmokeCase,
  projectDir: string,
  registry: CleanupRegistry,
): Promise<void> {
  if (!shouldRunE2e(process.env)) {
    console.log(`[${c.id}] SMOKE_SKIP_E2E=1 のため、E2E を飛ばしました`);
    return;
  }
  const npm = makeNpm(registry);
  if (!(await portIsFree(E2E_PORT))) {
    throw new Error(
      `ポート ${String(E2E_PORT)} が使われています。E2E の検証用サーバーを起動できません`,
    );
  }
  await runStage(c.id, "E2E：ブラウザ（chromium）の導入", async () => {
    await npm(
      ["exec", "--", ...playwrightInstallArgs(process.env)],
      projectDir,
      undefined,
      900_000,
    );
  });
  if (c.database === "postgresql") {
    await runStage(c.id, "E2E：検証用 PostgreSQL のコンテナの起動", () =>
      startTestDatabase(projectDir, registry),
    );
  }
  const rounds = c.database === "d1" ? 2 : 1;
  for (let round = 1; round <= rounds; round++) {
    await runStage(c.id, `E2E：npm run test:e2e（${String(round)}回目）`, async () => {
      await npm(["run", "test:e2e"], projectDir, undefined, 900_000);
      await expectE2ePortReleased();
    });
    console.log(`[${c.id}] E2E（npm run test:e2e、${String(round)}回目）に成功しました`);
  }
}

/** 生成物の infra/ を、Cloudflare に何も作らずに確かめる（init -backend=false・fmt -check・validate。認証は使わない） */
async function terraformStage(
  id: string,
  projectDir: string,
  registry: CleanupRegistry,
): Promise<void> {
  const available =
    spawnSync("terraform", ["version"], { stdio: "ignore", windowsHide: true }).status === 0;
  if (decideTerraformStep(available, process.env) === "skip") {
    console.log(`[${id}] terraform が使えないため、terraform validate を飛ばしました`);
    return;
  }
  // 認証の情報は渡さない（validate は認証を使わない）
  const env = { TF_IN_AUTOMATION: "1", CLOUDFLARE_API_TOKEN: "", TF_INPUT: "0" };
  const terraform = (args: string[]) =>
    runCommand("terraform", [`-chdir=infra`, ...args], {
      cwd: projectDir,
      env,
      timeoutMs: 600_000,
      registry,
    });
  await runStage(id, "terraform init -backend=false", async () => {
    await terraform(["init", "-backend=false", "-input=false"]);
  });
  await runStage(id, "terraform fmt -check・validate", async () => {
    await terraform(["fmt", "-check", "-diff", "-recursive"]);
    await terraform(["validate"]);
  });
  console.log(`[${id}] terraform init -backend=false・fmt -check・validate に成功しました`);
}

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

async function dockerStage(
  c: SmokeCase,
  projectDir: string,
  registry: CleanupRegistry,
  envValues: Record<string, string>,
): Promise<void> {
  const docker = (args: string[], timeoutMs: number) =>
    runCommand("docker", [...composeArgs(projectDir), ...args], {
      cwd: projectDir,
      timeoutMs,
      registry,
    });
  const npm = makeNpm(registry);
  const appPort = await pickFreePort();
  writeEnvFile(projectDir, "development", {
    ...envValues,
    APP_ENV: "development",
    APP_PORT: String(appPort),
  });
  const base = `http://localhost:${String(appPort)}`;
  await runStage(c.id, "docker compose config", async () => {
    await docker(["config", "--quiet"], 120_000);
  });
  await runStage(c.id, "docker compose up", async () => {
    await docker(["up", "-d"], 600_000);
    await waitForOk(`${base}/api/health`, { timeoutMs: 300_000, intervalMs: 2000 });
  });
  await runStage(c.id, "Docker：画面（/）と API の応答", async () => {
    await checkServer(base, c.database);
  });
  await runStage(c.id, "Docker：コンテナの中の npm run check", async () => {
    await docker(["exec", "-T", "backend", "npm", "run", "check"], 900_000);
  });
  if (c.database === "d1") {
    await runStage(c.id, "Docker：D1（コンテナの中のデータ）を API で確かめる", async () => {
      const exec = (script: string) =>
        docker(["exec", "-T", "backend", "npm", "run", script], 300_000);
      // コンテナの D1 は、手元の D1 とは別のデータ。README の手順と同じ順で用意する
      await exec("db:migrate:local");
      await exec("db:seed:local");
      await expectSeeded(base, "d1", "コンテナの D1（シードの後）");
      await checkSampleUserRejections(base);
      await runSampleUserLifecycle(
        "d1",
        sampleUserSteps(base, {
          cleanup: async () => {
            await exec("db:cleanup");
          },
          reset: async () => {
            // 動いているサーバーが開いたままの D1 のファイルを消さないよう、止めてから初期化して、起動し直す
            await docker(["stop", "backend"], 180_000);
            await docker(["run", "--rm", "-T", "backend", "npm", "run", "db:reset:local"], 300_000);
            await docker(["up", "-d"], 600_000);
            await waitForOk(`${base}/api/health`, { timeoutMs: 300_000, intervalMs: 2000 });
          },
        }),
      );
      await expectSeeded(base, "d1", "コンテナの D1（初期化の後）");
      // コンテナを作り直しても（down・up）、データ（ボリューム）が残る
      await docker(["down"], 180_000);
      await docker(["up", "-d"], 600_000);
      await waitForOk(`${base}/api/health`, { timeoutMs: 300_000, intervalMs: 2000 });
      await expectSeeded(base, "d1", "コンテナを作り直した後の D1");
    });
  } else if (c.database === "postgresql") {
    await runStage(
      c.id,
      "Docker：db のコンテナの PostgreSQL に、backend のコンテナから API でつながる",
      async () => {
        await expectSeeded(base, "postgresql", "コンテナの中の backend から読んだ一覧");
        await checkSampleUserRejections(base);
        await runSampleUserLifecycle(
          "postgresql",
          sampleUserSteps(base, {
            cleanup: async () => {
              await npm(["run", "db:cleanup"], projectDir);
            },
            reset: async () => {
              await npm(["run", "db:reset:local"], projectDir);
            },
          }),
        );
        await expectSeeded(
          base,
          "postgresql",
          "初期化の後（コンテナの中の backend から読んだ一覧）",
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

async function runCase(c: SmokeCase, withDocker: boolean, appName: string): Promise<void> {
  const registry = createCleanupRegistry();
  const uninstall = installInterruptHandlers(registry);
  try {
    await runWithCleanup(c.id, registry, async () => {
      const run = buildSmokeRun(c, appName);
      const npm = makeNpm(registry);
      const workDir = mkdtempSync(path.join(os.tmpdir(), `harness-smoke-${c.id}-`));
      registry.add(`${c.id}：一時的なフォルダの削除`, () =>
        rmSync(workDir, { recursive: true, force: true }),
      );
      const projectDir = path.join(workDir, run.projectDirName);
      await runStage(c.id, "生成（harness create）", async () => {
        writeFileSync(path.join(workDir, "answers.yaml"), run.answersYaml);
        await runCommand(
          process.execPath,
          [path.join(rootDir, "dist", "cli.js"), "create", "--answers", "answers.yaml", "--yes"],
          { cwd: workDir, registry },
        );
      });
      await runStage(c.id, "npm install", async () => {
        await npm(["install", "--no-audit", "--no-fund"], projectDir);
      });
      // 開発と検証の2つに架空の値を用意し、異なる保存先を使う。
      const envValues: Record<string, string> = {};
      const testValues: Record<string, string> = {};
      if (c.database === "postgresql") {
        const user = "testuser_smoke";
        const password = randomBytes(12).toString("hex");
        const database = "testapp_smoke_dev";
        const dbPort = await pickFreePort();
        const url = `postgresql://${user}:${password}@localhost:${String(dbPort)}/${database}`;
        assertLocalDatabaseUrl(url);
        Object.assign(envValues, {
          POSTGRES_USER: user,
          POSTGRES_PASSWORD: password,
          POSTGRES_DB: database,
          POSTGRES_PORT: String(dbPort),
          DATABASE_URL: url,
          CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: url,
        });
        const testDatabase = "testapp_smoke_test";
        let testDbPort = await pickFreePort();
        for (let attempt = 0; testDbPort === dbPort && attempt < 10; attempt++) {
          testDbPort = await pickFreePort();
        }
        if (testDbPort === dbPort) {
          throw new Error("開発用と検証用に異なる PostgreSQL ポートを確保できません");
        }
        const testUrl = `postgresql://${user}:${password}@localhost:${String(testDbPort)}/${testDatabase}`;
        Object.assign(testValues, {
          POSTGRES_USER: user,
          POSTGRES_PASSWORD: password,
          POSTGRES_DB: testDatabase,
          POSTGRES_PORT: String(testDbPort),
          DATABASE_URL: testUrl,
          CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: testUrl,
        });
      }
      writeEnvFile(projectDir, "development", {
        ...envValues,
        APP_ENV: "development",
        VITE_SECRET: "dummy_private_51",
      });
      writeEnvFile(projectDir, "test", {
        ...testValues,
        APP_ENV: "test",
        VITE_SECRET: "dummy_private_51",
      });
      await runStage(c.id, "npm run check", async () => {
        await npm(["run", "check"], projectDir);
      });
      await runStage(c.id, "npm run build", async () => {
        await npm(["run", "build"], projectDir, { VITE_SECRET: "dummy_private_51" });
        if (!existsSync(path.join(projectDir, "dist", "client", "index.html"))) {
          throw new Error("組み立ての結果（dist/client/index.html）がありません");
        }
        if (!existsSync(path.join(projectDir, "dist", "client", "_headers"))) {
          throw new Error("組み立ての結果（dist/client/_headers）がありません");
        }
        assertBuildHasNoDummySecret(path.join(projectDir, "dist"));
      });
      await terraformStage(c.id, projectDir, registry);

      // 環境ファイルの後でのみ Docker の資源を登録する。
      if (withDocker) registry.trackCompose(projectDir);

      if (c.id === "d1") {
        await checkDatabaseLifecycle("d1", projectDir, registry, async () => {
          await npm(["run", "db:migrate:local"], projectDir);
          await npm(["run", "db:seed:local"], projectDir);
        });
      } else if (c.id === "postgresql") {
        await runStage(c.id, "PostgreSQL のコンテナの起動", async () => {
          await runCommand("docker", [...composeArgs(projectDir), "up", "-d", "--wait", "db"], {
            cwd: projectDir,
            timeoutMs: 300_000,
            registry,
          });
        });
        await checkDatabaseLifecycle("postgresql", projectDir, registry, async () => {
          // 手元の接続先であることを、つなぐ前に確かめる
          assertLocalDatabaseUrl(envValues["DATABASE_URL"] as string);
          await npm(["run", "db:migrate"], projectDir);
          await npm(["run", "db:seed:local"], projectDir);
        });
      } else {
        await runStage(c.id, "開発サーバー", () =>
          withDevServer(projectDir, registry, (server) => checkServer(server.url, c.database)),
        );
      }

      await runStage(c.id, "検証サーバーと開発データの隔離", () =>
        checkTestIsolation(c, projectDir, registry),
      );

      await e2eStage(c, projectDir, registry);

      if (withDocker) {
        await dockerStage(c, projectDir, registry, envValues);
      } else {
        console.log(`[${c.id}] Docker が使えないため、docker compose の確かめを飛ばしました`);
      }
      console.log(`[${c.id}] 成功しました`);
    });
  } finally {
    uninstall();
  }
}

/** 失敗するはずのコマンド。成功したら誤り。失敗の出力（理由）を返す */
async function expectFailure(run: () => Promise<unknown>, what: string): Promise<string> {
  try {
    await run();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error(`${what} が成功しました（失敗するはずです）`);
}

/**
 * GitHub を使わない通り（C-83、#61）。生成して npm install し、README の手順と同じ並びで
 * git init → フック → 最初のコミット → 作業のブランチ → npm run merge:check を行う。
 * フックの整形・Lint・main の保護は、本物の Prettier・ESLint で確かめる。
 * Git の設定は一時フォルダの中だけ（利用者の設定を使わない）。メールアドレスは架空。
 */
async function runLocalGitCase(appName: string): Promise<void> {
  const id = LOCAL_GIT_CASE_ID;
  const registry = createCleanupRegistry();
  const uninstall = installInterruptHandlers(registry);
  try {
    await runWithCleanup(id, registry, async () => {
      const npm = makeNpm(registry);
      const workDir = mkdtempSync(path.join(os.tmpdir(), `harness-smoke-${id}-`));
      registry.add(`${id}：一時的なフォルダの削除`, () =>
        rmSync(workDir, { recursive: true, force: true }),
      );
      const projectDir = path.join(workDir, appName);
      const emptyConfig = path.join(workDir, "empty-gitconfig");
      writeFileSync(emptyConfig, "");
      const gitEnv = {
        GIT_CONFIG_GLOBAL: emptyConfig,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      };
      const git = (args: string[]) =>
        runCommand("git", args, { cwd: projectDir, env: gitEnv, registry });
      const write = (file: string, content: string) =>
        writeFileSync(path.join(projectDir, file), content);

      await runStage(id, "生成（harness create）", async () => {
        const answers = parseYaml(buildLocalGitAnswersYaml()) as Record<string, unknown>;
        answers["app_name"] = appName;
        writeFileSync(path.join(workDir, "answers.yaml"), stringifyYaml(answers));
        await runCommand(
          process.execPath,
          [path.join(rootDir, "dist", "cli.js"), "create", "--answers", "answers.yaml", "--yes"],
          { cwd: workDir, registry },
        );
      });
      await runStage(id, "npm install", async () => {
        await npm(["install", "--no-audit", "--no-fund"], projectDir);
      });
      writeEnvFile(projectDir, "development", {
        APP_ENV: "development",
        VITE_SECRET: "dummy_private_51",
      });
      writeEnvFile(projectDir, "test", { APP_ENV: "test", VITE_SECRET: "dummy_private_51" });
      await runStage(id, "npm run check（生成した状態）", async () => {
        await npm(["run", "check"], projectDir);
      });
      await terraformStage(id, projectDir, registry);

      // README の手順と同じ並び
      await runStage(
        id,
        "git init・フック・最初のコミット（HEAD がないので main でも通る）",
        async () => {
          await git(["init", "-b", "main"]);
          await git(["config", "user.email", "test@example.invalid"]);
          await git(["config", "user.name", "E2EUser A"]);
          await git(["config", "commit.gpgsign", "false"]);
          await git(["config", "core.hooksPath", ".githooks"]);
          await git(["add", "-A"]);
          await git(["commit", "-m", "chore: 生成した初期状態"]);
        },
      );
      await runStage(id, "main の上のコミットは、フックが止める", async () => {
        write("notes.txt", "メモ\n");
        await git(["add", "notes.txt"]);
        const message = await expectFailure(
          () => git(["commit", "-m", "docs: メモ"]),
          "main へのコミット",
        );
        if (!message.includes("main の上では直接コミットできません")) {
          throw new Error(`フックの拒否の理由が示されていません：${message}`);
        }
        await git(["reset", "-q"]);
      });
      await git(["switch", "-c", "feature/1-replace-icons"]);
      await runStage(
        id,
        "本物の Prettier・ESLint が、違反のあるファイルのコミットを止める",
        async () => {
          write("bad-format.json", '{"a":1,   "b":2}\n');
          await git(["add", "bad-format.json"]);
          await expectFailure(
            () => git(["commit", "-m", "chore: 整形の違反"]),
            "整形の違反のコミット",
          );
          await git(["reset", "-q"]);
          rmSync(path.join(projectDir, "bad-format.json"));
          write("bad-lint.ts", "const unused = 1;\n");
          await git(["add", "bad-lint.ts"]);
          await expectFailure(
            () => git(["commit", "-m", "chore: Lint の違反"]),
            "Lint の違反のコミット",
          );
          await git(["reset", "-q"]);
          rmSync(path.join(projectDir, "bad-lint.ts"));
        },
      );
      await runStage(id, "作業のブランチのコミットは通る", async () => {
        await git(["add", "notes.txt"]);
        await git(["commit", "-m", "docs: メモ"]);
      });
      await runStage(
        id,
        "npm run merge:check（本物の npm run check を通して、main に取り込む）",
        async () => {
          await npm(["run", "merge:check"], projectDir);
          const subject = (await git(["log", "-1", "--format=%s", "main"])).trim();
          if (subject !== "feat: replace icons (#1)") {
            throw new Error(`取り込みのコミットの題名が違います：${subject}`);
          }
          const issue = await git(["show", "main:docs/issues/0001-replace-icons.md"]);
          if (!/^- 状態：完了$/m.test(issue)) {
            throw new Error("Issue の状態が「完了」になっていません");
          }
          if ((await git(["status", "--porcelain"])).trim() !== "") {
            throw new Error("取り込みの後、作業ツリーがきれいではありません");
          }
        },
      );
      await runStage(id, "取り込みの後、main の手のコミットは止まる", async () => {
        write("hand.txt", "手のコミット\n");
        await git(["add", "hand.txt"]);
        await expectFailure(
          () => git(["commit", "-m", "docs: 手のコミット"]),
          "main への手のコミット",
        );
      });
      console.log(`[${id}] 成功しました`);
    });
  } finally {
    uninstall();
  }
}

async function main(): Promise<void> {
  const only = process.env["SMOKE_CASES"]?.split(",").map((s) => s.trim());
  const cases = SMOKE_CASES.filter((c) => only === undefined || only.includes(c.id));
  const runLocal = only === undefined || only.includes(LOCAL_GIT_CASE_ID);
  if (cases.length === 0 && !runLocal) throw new Error("SMOKE_CASES に合う通りがありません");

  const docker = dockerAvailable();
  const requireDocker = process.env["SMOKE_REQUIRE_DOCKER"] === "1";
  if (!docker && requireDocker) {
    throw new Error("Docker が使えません（SMOKE_REQUIRE_DOCKER=1 のため、失敗にします）");
  }

  // 組み立て（ハーネスの dist/）も、中断で止まるよう記録する
  const buildRegistry = createCleanupRegistry();
  const uninstall = installInterruptHandlers(buildRegistry);
  try {
    console.log("組み立て（npm run build）…");
    await runWithCleanup("harness build", buildRegistry, () =>
      makeNpm(buildRegistry)(["run", "build"], rootDir),
    );
  } finally {
    uninstall();
  }

  const failures: string[] = [];
  for (const c of cases) {
    if (c.database === "postgresql" && !docker) {
      console.log(`[${c.id}] Docker が使えないため、この通りを飛ばしました`);
      continue;
    }
    console.log(`[${c.id}] 確かめを始めます…`);
    try {
      // アプリ名は通りごとに一意（同時に実行しても、Docker の資源が混ざらない）
      await runCase(c, docker, createSmokeAppName());
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(message);
      failures.push(message);
    }
  }
  if (runLocal) {
    console.log(`[${LOCAL_GIT_CASE_ID}] 確かめを始めます…`);
    try {
      await runLocalGitCase(createSmokeAppName());
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(message);
      failures.push(message);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${String(failures.length)} 通りで失敗しました。`);
  }
  console.log("生成したプロジェクトの確かめに成功しました。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
