import { StringDecoder } from "node:string_decoder";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** 子プロセスの出力として残す、最後の文字数 */
export const OUTPUT_TAIL_LENGTH = 4000;

/** 子プロセスの出力として、メモリに持つ上限（伏せ字にしてから、最後の OUTPUT_TAIL_LENGTH 字だけを残す） */
const OUTPUT_KEEP_LENGTH = 1_000_000;

/** 止めた後、子プロセスの終了を待つ上限（止められなかったときも、先へ進めるようにする） */
const STOP_WAIT_MS = 15_000;

export interface RunOptions {
  cwd: string;
  /** 時間切れ（ミリ秒）。過ぎたら子プロセスを子孫まで止める */
  timeoutMs: number;
  /** 中断の合図。鳴ったら子プロセスを子孫まで止める */
  signal?: AbortSignal;
  env?: Record<string, string>;
  /** 出力を残す前に、全部つないだ文字列に対して行う伏せ字（秘密の値を消す）。出力を残さないときは () => "" */
  redact?: (text: string) => string;
  /**
   * 出力（伏せ字にする前）から、情報を拾う関数の一覧。戻り値だけが scanned として外に出る。
   * 出力そのものは外に出ないので、関数の側で、既知の一覧と照合したものだけを返す
   */
  scans?: Record<string, (rawOutput: string) => string[]>;
}

export interface RunResult {
  /** 終了コード。起動できなかった・止められたときは null */
  exitCode: number | null;
  timedOut: boolean;
  /** 中断の合図で止めた */
  aborted: boolean;
  /** コマンドを起動できなかった */
  startError: boolean;
  /** 出力（stdout・stderr）の最後の OUTPUT_TAIL_LENGTH 字。伏せ字にした後 */
  outputTail: string;
  scanned: Record<string, string[]>;
}

/** コマンドの実行の窓口。本番は defaultRunner、テストは偽物に差し替える */
export type CommandRunner = (
  command: string,
  args: string[],
  opts: RunOptions,
) => Promise<RunResult>;

export interface Invocation {
  command: string;
  args: string[];
  shell: boolean;
}

/**
 * npm の起動の仕方。
 * - npm_execpath が npm-cli.js なら、node でそれを実行する（どの OS でも同じ。シェルを通さない）
 * - なければ、Windows は node と同じ場所に入っている npm-cli.js を node で実行し（シェルを通さない）、
 *   それも無ければ npm.cmd をシェル経由で。Windows 以外は npm を直接
 */
export function npmInvocation(
  args: string[],
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
  nodePath: string = process.execPath,
): Invocation {
  const execPath = env["npm_execpath"];
  if (execPath && /npm-cli\.c?js$/i.test(execPath)) {
    return { command: nodePath, args: [execPath, ...args], shell: false };
  }
  if (platform === "win32") {
    const bundled = path.win32.join(
      path.win32.dirname(nodePath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    if (existsSync(bundled)) return { command: nodePath, args: [bundled, ...args], shell: false };
    return { command: "npm.cmd", args, shell: true };
  }
  return { command: "npm", args, shell: false };
}

/** 子プロセスと、その子孫を止める。Windows は taskkill、それ以外はプロセスグループ */
function killTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* すでに終わっている */
    }
  }
  return Promise.resolve();
}

/** 既定の実行。子プロセスを子孫まで止められるようにして、出力の最後の部分だけを返す */
export const defaultRunner: CommandRunner = (command, args, opts) =>
  new Promise<RunResult>((resolve) => {
    const redact = opts.redact ?? ((text: string) => text);
    let output = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const finish = (exitCode: number | null, startError: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timers.timeout);
      clearTimeout(timers.force);
      opts.signal?.removeEventListener("abort", onAbort);
      const scanned: Record<string, string[]> = {};
      for (const [key, scan] of Object.entries(opts.scans ?? {})) scanned[key] = scan(output);
      resolve({
        exitCode,
        timedOut,
        aborted,
        startError,
        outputTail: redact(output).slice(-OUTPUT_TAIL_LENGTH),
        scanned,
      });
    };

    const timers: { timeout?: NodeJS.Timeout; force?: NodeJS.Timeout } = {};
    let child: ReturnType<typeof spawn> | undefined;

    const stop = (): void => {
      const pid = child?.pid;
      if (pid !== undefined) void killTree(pid);
      // 止めた後も終了の通知が来ないときは、先へ進む
      timers.force ??= setTimeout(() => finish(null, false), STOP_WAIT_MS);
    };
    const onAbort = (): void => {
      aborted = true;
      stop();
    };

    if (opts.signal?.aborted) {
      aborted = true;
      finish(null, false);
      return;
    }

    const inv = command === "npm" ? npmInvocation(args) : { command, args, shell: false };
    try {
      child = spawn(inv.command, inv.args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: inv.shell,
        // Windows 以外は、子孫をまとめて止められるよう、独立したグループにする
        detached: process.platform !== "win32",
      });
    } catch {
      finish(null, true);
      return;
    }
    // UTF-8 の1文字がチャンクの境目で分かれても壊れないよう、流れごとに少しずつ文字に戻す（伏せ字の照合のため）
    const collectFrom =
      (decoder: StringDecoder) =>
      (chunk: Buffer): void => {
        output = `${output}${decoder.write(chunk)}`.slice(-OUTPUT_KEEP_LENGTH);
      };
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    child.stdout?.on("data", collectFrom(stdoutDecoder));
    child.stderr?.on("data", collectFrom(stderrDecoder));
    child.stdout?.once("end", () => {
      output = `${output}${stdoutDecoder.end()}`.slice(-OUTPUT_KEEP_LENGTH);
    });
    child.stderr?.once("end", () => {
      output = `${output}${stderrDecoder.end()}`.slice(-OUTPUT_KEEP_LENGTH);
    });
    child.once("error", () => finish(null, true));
    child.once("close", (code) => finish(timedOut || aborted ? null : code, false));

    timers.timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, opts.timeoutMs);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Docker が使えるか（docker info が通るか）。20秒で時間切れにする */
export async function defaultDockerAvailable(): Promise<boolean> {
  const result = await defaultRunner("docker", ["info"], { cwd: process.cwd(), timeoutMs: 20_000 });
  return result.exitCode === 0;
}
