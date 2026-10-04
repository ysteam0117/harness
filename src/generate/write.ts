import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdir, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GenerateError } from "./errors.js";

/** ファイル操作の窓口。テストでは一部だけを差し替える（本物は node:fs/promises と setTimeout） */
export interface FsOps {
  mkdir(dir: string, opts?: { recursive: boolean }): Promise<unknown>;
  /** 文字列は UTF-8 で、バイト列はそのまま書く */
  writeFile(file: string, content: string | Uint8Array): Promise<void>;
  /** リンクをたどらない。なければ code: "ENOENT" で失敗する */
  lstat(p: string): Promise<Stats>;
  readdir(p: string): Promise<string[]>;
  /** 空でなければ失敗する操作（再帰の削除ではない） */
  rmdir(p: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** 一時的な場所を消す */
  rm(p: string, opts: { recursive: true; force: true }): Promise<void>;
  /** 移動の再試行の待ち */
  sleep(ms: number): Promise<void>;
}

export interface WriteProjectInput {
  /** 作業中のフォルダ。生成先は <cwd>/<appName> */
  cwd: string;
  appName: string;
  /** "/" 区切りの相対パス */
  files: { path: string; content: string; encoding?: "base64" }[];
  /** 差し替え（既定は本物） */
  fs?: Partial<FsOps>;
  /** 中断の要求（SIGINT を受けたら create が abort する） */
  signal?: AbortSignal;
}

/** 移動の前に、中断の要求を受けて止めた（一時的な場所は消してある） */
export class GenerationInterrupted extends Error {
  constructor(message = "中断の要求を受けたため、生成を止めました") {
    super(message);
    this.name = "GenerationInterrupted";
  }
}

const realFs: FsOps = {
  mkdir: (dir, opts) => mkdir(dir, opts),
  writeFile: (file, content) =>
    typeof content === "string" ? writeFile(file, content, "utf8") : writeFile(file, content),
  lstat: (p) => lstat(p),
  readdir: (p) => readdir(p),
  rmdir: (p) => rmdir(p),
  rename: (from, to) => rename(from, to),
  rm: (p, opts) => rm(p, opts),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** 移動（rename）が一時的に失敗する場合（Windows のウイルス対策ソフト・インデクサ等）のやり直し */
const RETRY_CODES = ["EPERM", "EBUSY"];
const MAX_ATTEMPTS = 8;
const RETRY_WAIT_MS = 50;

type TargetState = "absent" | "empty";

function codeOf(e: unknown): string | undefined {
  return typeof e === "object" && e !== null ? (e as NodeJS.ErrnoException).code : undefined;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 出力先の相対パスの形を確かめる（出力先の外へ出るパスは使えない） */
function checkRelative(p: string): void {
  const bad =
    p === "" ||
    p.startsWith("/") ||
    p.includes("\\") ||
    /^[A-Za-z]:/.test(p) ||
    p.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
  if (bad) {
    throw new GenerateError(
      `出力先のパス ${JSON.stringify(p)} が誤っています（相対パスで、"/" 区切り、空の部分・. ・.. を含めません）`,
    );
  }
}

function checkAppName(appName: string): void {
  if (
    appName === "" ||
    appName === "." ||
    appName === ".." ||
    appName.includes("/") ||
    appName.includes("\\")
  ) {
    throw new GenerateError(`アプリ名 ${JSON.stringify(appName)} を、フォルダの名前に使えません`);
  }
}

/**
 * 生成先の状態を確かめる。なければ absent、空のフォルダなら empty。
 * 中身のあるフォルダ・ファイル・リンク（シンボリックリンク・ジャンクション）は GenerateError。
 */
async function inspectTarget(fs: FsOps, target: string): Promise<TargetState> {
  let stat: Stats;
  try {
    stat = await fs.lstat(target);
  } catch (e) {
    if (codeOf(e) === "ENOENT") return "absent";
    throw new GenerateError(`生成先を確かめられません：${target}（${messageOf(e)}）`, {
      cause: e,
    });
  }
  if (stat.isSymbolicLink()) {
    throw new GenerateError(
      `生成先がリンク（シンボリックリンク・ジャンクション）です：${target}（リンクの先には生成しません）`,
    );
  }
  if (!stat.isDirectory()) {
    throw new GenerateError(`生成先に、同じ名前のファイルがあります：${target}`);
  }
  let names: string[];
  try {
    names = await fs.readdir(target);
  } catch (e) {
    throw new GenerateError(
      `生成先のフォルダの中身を確かめられません：${target}（${messageOf(e)}）`,
      {
        cause: e,
      },
    );
  }
  if (names.length > 0) {
    throw new GenerateError(`生成先のフォルダに、すでに中身があります：${target}`);
  }
  return "empty";
}
/**
 * 一時的な場所（<cwd>/.<アプリ名>.harness-tmp-<乱数>）にすべて書いてから、生成先に移す。
 * 移し方：生成先を mkdir（再帰なし。すでにあれば EEXIST で失敗する）で作り、一時的な場所の最上位の各項目を
 * 生成先の中へ rename で移し、空になった一時的な場所を rmdir で消す。
 * 完了の境界は「最後の項目の移動が成功した時点」。それより前の失敗・中断では、移した項目と自分が作った生成先、
 * 一時的な場所を消してから終わる。完了の後に届いた中断の要求は、interrupted: true で伝える（生成先は消さない）。
 */
export async function writeProject(
  input: WriteProjectInput,
): Promise<{ dir: string; interrupted: boolean }> {
  const fs: FsOps = { ...realFs, ...input.fs };
  const { signal } = input;
  checkAppName(input.appName);
  for (const file of input.files) checkRelative(file.path);

  const target = path.join(input.cwd, input.appName);
  const tmp = path.join(
    input.cwd,
    `.${input.appName}.harness-tmp-${randomBytes(6).toString("hex")}`,
  );
  const stopIfAborted = (): void => {
    if (signal?.aborted) throw new GenerationInterrupted();
  };

  stopIfAborted();
  // 書き込みの前の確かめ
  await inspectTarget(fs, target);
  stopIfAborted();

  await fs.mkdir(tmp, { recursive: true });
  let createdTarget = false;
  const moved: string[] = [];
  let complete = false;
  try {
    for (const file of input.files) {
      stopIfAborted();
      const full = path.join(tmp, ...file.path.split("/"));
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(
        full,
        file.encoding === "base64" ? Buffer.from(file.content, "base64") : file.content,
      );
    }
    stopIfAborted();

    // 移動の前の確かめ（確かめた後に、生成先に何かが置かれていないか）
    const state = await inspectTarget(fs, target);
    stopIfAborted();
    if (state === "empty") {
      try {
        await fs.rmdir(target);
      } catch (e) {
        throw new GenerateError(
          `生成先の空のフォルダを消せませんでした：${target}（${messageOf(e)}）`,
          { cause: e },
        );
      }
      stopIfAborted();
    }

    try {
      await fs.mkdir(target);
    } catch (e) {
      if (codeOf(e) === "EEXIST") {
        throw new GenerateError(
          `生成先に、書いている間に別のものが置かれました：${target}（生成先には触らず、生成を止めました）`,
          { cause: e },
        );
      }
      throw new GenerateError(`生成先を作れませんでした：${target}（${messageOf(e)}）`, {
        cause: e,
      });
    }
    createdTarget = true;

    const items = [...(await fs.readdir(tmp))].sort();
    if (items.length === 0) complete = true;
    for (const [index, name] of items.entries()) {
      const from = path.join(tmp, name);
      const to = path.join(target, name);
      for (let attempt = 1; ; attempt += 1) {
        stopIfAborted();
        try {
          await fs.rename(from, to);
          break;
        } catch (e) {
          const code = codeOf(e);
          if (code === undefined || !RETRY_CODES.includes(code)) {
            throw new GenerateError(`生成先への移動に失敗しました：${messageOf(e)}`, {
              cause: e,
            });
          }
          if (attempt >= MAX_ATTEMPTS) {
            throw new GenerateError(
              `生成先への移動を ${String(MAX_ATTEMPTS)} 回試しましたが、できませんでした：${messageOf(e)}`,
              { cause: e },
            );
          }
          await fs.sleep(RETRY_WAIT_MS * attempt);
        }
      }
      moved.push(to);
      if (index === items.length - 1) complete = true;
    }
  } catch (e) {
    if (complete) throw e;
    await rollback(fs, { tmp, target, createdTarget, moved }, e);
    throw e;
  }

  // 完了。空になった一時的な場所を消す（再帰の削除ではない）
  try {
    await fs.rmdir(tmp);
  } catch (e) {
    throw new GenerateError(
      `生成は完了しましたが、空の一時的な場所を消せませんでした。手で削除してください：${tmp}（${messageOf(e)}）`,
      { cause: e },
    );
  }
  return { dir: target, interrupted: signal?.aborted === true };
}

/**
 * 完了前の失敗・中断の後始末：移した項目 → 自分が作った生成先（空のときだけ）→ 一時的な場所の順に消す。
 * 消せなかったものは、場所を示したエラーにする（もみ消さない）。
 */
async function rollback(
  fs: FsOps,
  state: { tmp: string; target: string; createdTarget: boolean; moved: string[] },
  original: unknown,
): Promise<void> {
  const problems: string[] = [];
  const attempt = async (place: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (cleanup) {
      problems.push(`${place}（${messageOf(cleanup)}）`);
    }
  };
  for (const item of state.moved) {
    await attempt(item, () => fs.rm(item, { recursive: true, force: true }));
  }
  if (state.createdTarget) await attempt(state.target, () => fs.rmdir(state.target));
  await attempt(state.tmp, () => fs.rm(state.tmp, { recursive: true, force: true }));
  if (problems.length === 0) return;
  const why = original instanceof GenerationInterrupted ? "中断" : "失敗";
  throw new GenerateError(
    `生成の${why}（${messageOf(original)}）の後、次の場所を消せませんでした。手で削除してください：${problems.join("、")}`,
    { cause: original },
  );
}
