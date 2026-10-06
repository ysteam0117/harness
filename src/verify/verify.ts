import { readFileSync } from "node:fs";
import path from "node:path";
import type { VersionEntry, VersionResult } from "../versions/choose.js";
import {
  buildRedactor,
  ensureEnvFiles,
  readEnvSecrets,
  type EnsureEnvOptions,
} from "./env-files.js";
import type { CommandRunner, RunResult } from "./runner.js";

/** 失敗した手順 */
export type VerifyStep = "env" | "install" | "db-up" | "check";

/** 原因の候補のパッケージ（versions.entries の1件。出力に名前が出たものを named にする） */
export interface Suspect {
  name: string;
  version: string;
  verified: string | null;
  newerThanVerified: boolean;
  majorDiffers: boolean;
  /** 出力に名前が出ていた */
  named: boolean;
}

export type VerifyResult =
  | {
      status: "passed";
      envCreated: string[];
      envExisting: string[];
      cleanupFailures: string[];
    }
  | {
      status: "failed";
      failedStep: VerifyStep;
      /** 失敗した品質チェックの script 名（package.json の scripts にあるものだけ） */
      failedScripts: string[];
      suspects: Suspect[];
      /** 子プロセスの出力の最後の部分（秘密の値は伏せ字）。出さないときは空 */
      outputTail: string;
      /** 短い秘密の値があるため、出力を残していない */
      outputSuppressed: boolean;
      timedOut: boolean;
      envCreated: string[];
      envExisting: string[];
      cleanupFailures: string[];
    }
  | { status: "skipped"; reason: string }
  | { status: "interrupted"; cleanupFailures: string[] };

export interface VerifyInput {
  projectDir: string;
  database: "d1" | "postgresql" | "none";
  versions: VersionResult;
  runner: CommandRunner;
  /** Docker が使えるか（DB に関係なく、npm を呼ぶ前に呼ぶ。セキュリティのテストが Docker で動くため） */
  dockerAvailable: () => Promise<boolean>;
  /** 中断の合図。後始末には渡さない（後始末は止めない） */
  signal: AbortSignal;
  /** 手順の始まりを知らせる（表示用） */
  onProgress?: (message: string) => void;
  /** 時間切れ（ミリ秒） */
  timeouts?: Partial<Record<"install" | "dbUp" | "check" | "cleanup", number>>;
  env?: EnsureEnvOptions;
}

export const DEFAULT_TIMEOUTS = {
  install: 600_000,
  dbUp: 300_000,
  check: 600_000,
  /** 後始末（docker:down:test）の時間切れ。中断の後も、これだけは待つ */
  cleanup: 120_000,
} as const;

export const NO_DOCKER_REASON =
  "動作確認には Docker が要ります（品質チェックのセキュリティのテストと、PostgreSQL の検証用の DB が Docker で動きます）が、Docker を使えなかったため、動作確認を飛ばしました（npm は呼んでいません）。Docker を起動して、生成した場所で npm install と npm run check を実行してください";

const CLEANUP_FAILED =
  "検証用の PostgreSQL（Docker）を止められませんでした。生成した場所で npm run docker:down:test を実行してください";

function readScriptNames(projectDir: string): Set<string> {
  try {
    const pkg = JSON.parse(readFileSync(path.join(projectDir, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    return new Set(Object.keys(pkg.scripts ?? {}));
  } catch {
    return new Set();
  }
}

/** npm の出力の「> パッケージ名@版 script名」の行から、script 名の候補を順に拾う */
const SCRIPT_LINE = /^> \S+@\S+ (\S+)\s*$/gm;

/** 出力から拾った script 名のうち、package.json の scripts にあるものだけ（名前は package.json 側のもの） */
export function scanScriptNames(raw: string, known: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const match of raw.matchAll(SCRIPT_LINE)) {
    const candidate = match[1];
    if (candidate !== undefined && known.has(candidate)) out.push(candidate);
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 出力に名前が出ていたパッケージ（採用した版の一覧の名前と完全に一致するものだけ。node は語が多すぎるので除く） */
export function scanPackageNames(raw: string, entries: readonly VersionEntry[]): string[] {
  return entries
    .filter((e) => e.name !== "node")
    .filter((e) => new RegExp(`(?<![\\w@/.-])${escapeRegExp(e.name)}(?![\\w-])`).test(raw))
    .map((e) => e.name);
}

/** 原因の候補。出力に名前が出たものを先に、次に検証済みより新しい版・未検証の版（大きな版の違いを先に） */
export function pickSuspects(
  entries: readonly VersionEntry[],
  named: readonly string[],
): Suspect[] {
  const toSuspect = (e: VersionEntry, isNamed: boolean): Suspect => ({
    name: e.name,
    version: e.version,
    verified: e.verified,
    newerThanVerified: e.newerThanVerified,
    majorDiffers: e.majorDiffers,
    named: isNamed,
  });
  const first = entries.filter((e) => named.includes(e.name)).map((e) => toSuspect(e, true));
  const rest = entries
    .filter((e) => !named.includes(e.name) && (e.newerThanVerified || e.verified === null))
    .sort((a, b) => Number(b.majorDiffers) - Number(a.majorDiffers))
    .map((e) => toSuspect(e, false));
  return [...first, ...rest];
}

/**
 * 生成したプロジェクトで、Docker の確認 → npm install → （PostgreSQL のとき）検証用 DB の起動 → npm run check → 検証用 DB の停止を行う。
 * install が失敗したら DB は起動しない。検証用 DB の停止は、起動の前に登録し、成功・失敗・中断のどれでも1回だけ、
 * 中断の合図とは別の時間切れだけで実行する。出力の秘密の値は伏せ字にし、出力から拾う名前は既知の一覧と照合する。
 */
export async function verifyProject(input: VerifyInput): Promise<VerifyResult> {
  const { projectDir, runner, signal } = input;
  const timeouts = { ...DEFAULT_TIMEOUTS, ...input.timeouts };
  const progress = input.onProgress ?? (() => undefined);
  const needsDb = input.database === "postgresql";

  // Docker の確認は、DB に関係なく、npm を呼ぶ前に行う（使えなければ、何も呼ばずに飛ばす）。
  // npm run check のセキュリティのテスト（Semgrep・gitleaks・OSV-Scanner）が Docker で動くため（#42）
  const available = await input.dockerAvailable();
  if (signal.aborted) return { status: "interrupted", cleanupFailures: [] };
  if (!available) return { status: "skipped", reason: NO_DOCKER_REASON };

  let env: Awaited<ReturnType<typeof ensureEnvFiles>>;
  try {
    env = await ensureEnvFiles(projectDir, input.env);
  } catch {
    return {
      status: "failed",
      failedStep: "env",
      failedScripts: [],
      suspects: [],
      outputTail: "",
      outputSuppressed: false,
      timedOut: false,
      envCreated: [],
      envExisting: [],
      cleanupFailures: [],
    };
  }

  const secrets = readEnvSecrets(projectDir);
  const redact = secrets.hasShortSecret ? () => "" : buildRedactor(secrets);
  const knownScripts = readScriptNames(projectDir);
  const scans = {
    scripts: (raw: string) => scanScriptNames(raw, knownScripts),
    packages: (raw: string) => scanPackageNames(raw, input.versions.entries),
  };

  const failed = (step: VerifyStep, r: RunResult, cleanupFailures: string[]): VerifyResult => {
    const scripts = r.scanned["scripts"] ?? [];
    // check の中で最後に動いた script が、失敗したもの（check 自身は、中の script があればその後ろ）
    const inner = scripts.filter((s) => s !== "check");
    const last = inner[inner.length - 1] ?? scripts[scripts.length - 1];
    return {
      status: "failed",
      failedStep: step,
      failedScripts: step === "check" && last !== undefined ? [last] : [],
      suspects: pickSuspects(input.versions.entries, r.scanned["packages"] ?? []),
      outputTail: secrets.hasShortSecret ? "" : r.outputTail,
      outputSuppressed: secrets.hasShortSecret,
      timedOut: r.timedOut,
      envCreated: env.created,
      envExisting: env.existing,
      cleanupFailures,
    };
  };

  const run = (args: string[], timeoutMs: number): Promise<RunResult> =>
    runner("npm", args, { cwd: projectDir, timeoutMs, signal, redact, scans });
  const interrupted = (r: RunResult): boolean => r.aborted || signal.aborted;
  const succeeded = (r: RunResult): boolean => r.exitCode === 0 && !r.timedOut && !r.startError;

  progress("npm install を実行しています（数分かかります）…");
  const install = await run(["install"], timeouts.install);
  if (interrupted(install)) return { status: "interrupted", cleanupFailures: [] };
  if (!succeeded(install)) return failed("install", install, []);

  const cleanupFailures: string[] = [];
  let cleanupRegistered = false;
  const verifyChecks = async (): Promise<VerifyResult> => {
    if (needsDb) {
      // 後始末を先に登録してから起動する（起動の途中で失敗・中断しても、停止する）
      cleanupRegistered = true;
      progress("検証用の PostgreSQL（Docker）を起動しています…");
      const up = await run(["run", "docker:up:test", "--", "--wait", "db"], timeouts.dbUp);
      if (interrupted(up)) return { status: "interrupted", cleanupFailures };
      if (!succeeded(up)) return failed("db-up", up, cleanupFailures);
    }
    progress("npm run check を実行しています（数分かかります）…");
    const check = await run(["run", "check"], timeouts.check);
    if (interrupted(check)) return { status: "interrupted", cleanupFailures };
    if (!succeeded(check)) return failed("check", check, cleanupFailures);
    return {
      status: "passed",
      envCreated: env.created,
      envExisting: env.existing,
      cleanupFailures,
    };
  };

  let result: VerifyResult;
  try {
    result = await verifyChecks();
  } finally {
    if (cleanupRegistered) {
      progress("検証用の PostgreSQL（Docker）を止めています…");
      try {
        // 中断の合図は渡さない（2回目の Ctrl+C でも、止めない）
        const down = await runner("npm", ["run", "docker:down:test"], {
          cwd: projectDir,
          timeoutMs: timeouts.cleanup,
          redact,
        });
        if (!succeeded(down)) cleanupFailures.push(CLEANUP_FAILED);
      } catch {
        cleanupFailures.push(CLEANUP_FAILED);
      }
    }
  }
  // 後始末の途中で受けた中断も、成功・失敗より優先する。
  if (signal.aborted) return { status: "interrupted", cleanupFailures };
  return result;
}
