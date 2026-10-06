import { randomBytes } from "node:crypto";
import path from "node:path";
import { checkRelative } from "../generate/write.js";
import { realUpdateFs, type UpdateFs } from "./fs.js";
import { assertNoLinks, messageOf, rawSha } from "./state.js";

export type { UpdateFs } from "./fs.js";
export { rawSha } from "./state.js";

export type ApplyOp =
  | {
      kind: "replace";
      path: string;
      content: string;
      executable?: true;
      /** 判定のときに読んだ、今のファイルの生のバイト列の sha256 */
      expected: string;
    }
  | { kind: "create"; path: string; content: string; executable?: true };

export interface ApplyInput {
  /** 生成先（realpath 済み） */
  root: string;
  /** 適用の順。config.yaml は最後 */
  ops: ApplyOp[];
  /** 操作のほかに、適用の直前にも変わっていないことを確かめるもの（null は「無い」） */
  checks?: { path: string; sha: string | null }[];
  fs?: Partial<UpdateFs>;
  signal?: AbortSignal;
}

/** 判定の後に、対象のファイルが変わっていた（何も書いていない、または書いた分は元に戻した） */
export class ChangedAfterJudgment extends Error {
  readonly changed: string[];
  constructor(changed: string[]) {
    super("判定の後にファイルが変わりました。もう一度 harness update を実行してください");
    this.name = "ChangedAfterJudgment";
    this.changed = changed;
  }
}

/** 中断の要求を受けて止めた（書いた分は元に戻した） */
export class UpdateInterrupted extends Error {
  constructor(message = "中断の要求を受けたため、更新を止めて元に戻しました") {
    super(message);
    this.name = "UpdateInterrupted";
  }
}

/** 失敗したが、すべて元に戻した */
export class ApplyFailed extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "ApplyFailed";
  }
}

/** 元に戻せなかったものがある（元の内容の退避を残した） */
export class RollbackIncomplete extends Error {
  readonly problems: string[];
  readonly backupDir: string;
  constructor(message: string, problems: string[], backupDir: string) {
    super(message);
    this.name = "RollbackIncomplete";
    this.problems = problems;
    this.backupDir = backupDir;
  }
}

/** rename が一時的に失敗する場合（Windows のウイルス対策ソフト・インデクサ等）のやり直し */
const RETRY_CODES = ["EPERM", "EBUSY", "EACCES"];
const MAX_ATTEMPTS = 5;
const RETRY_WAIT_MS = 50;

function codeOf(e: unknown): string | undefined {
  return typeof e === "object" && e !== null ? (e as NodeJS.ErrnoException).code : undefined;
}

async function renameWithRetry(fs: UpdateFs, from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e) {
      const code = codeOf(e);
      if (code === undefined || !RETRY_CODES.includes(code) || attempt >= MAX_ATTEMPTS) throw e;
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS * attempt));
    }
  }
}

type Phase = "pending" | "backed-up" | "placed";

interface Entry {
  op: ApplyOp;
  index: number;
  phase: Phase;
  /** こちらが書いた新しい内容の生の sha256 */
  newSha: string;
  /** 新しく作ったフォルダ（上位から順） */
  createdDirs: string[];
}

const hexOf = (): string => randomBytes(6).toString("hex");

/** 今のファイルの生の sha256。無ければ null */
async function currentSha(fs: UpdateFs, root: string, rel: string): Promise<string | null> {
  await assertNoLinks(fs, root, rel);
  try {
    return rawSha(await fs.readFile(path.join(root, ...rel.split("/"))));
  } catch (e) {
    if (codeOf(e) === "ENOENT") return null;
    throw e;
  }
}

async function exists(fs: UpdateFs, file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch (e) {
    if (codeOf(e) === "ENOENT") return false;
    throw e;
  }
}

/**
 * 更新を原子的に適用する。
 * 1. 適用の直前に、判定のときに読んだ各対象の生の指紋を、もう一度読んで比べる（違えば何も書かずに止まる）
 * 2. 新しい内容をすべて <root>/.harness/.update-tmp-<乱数>/ に書く
 * 3. 1ファイルずつ入れ替える：元のファイルを退避（.harness/.update-backup-<乱数>/）へ rename → 退避した中身を確かめる →
 *    新しい内容を rename で置く。新しく作るファイルは、無いことを確かめてから rename で置く。config.yaml は最後
 * 4. 途中の失敗・中断・変化の検知では、入れ替えた分を逆の順に戻す。戻す直前に今の中身を確かめ、
 *    こちらが書いた内容と違えば（利用者が編集した）上書きせず、退避を残して案内する
 * 5. すべて戻せた・成功したときだけ、一時的な場所と退避を消す
 */
export async function applyUpdate(input: ApplyInput): Promise<{ cleanupWarnings: string[] }> {
  const fs: UpdateFs = { ...realUpdateFs, ...input.fs };
  const { root, ops, signal } = input;
  for (const op of ops) checkRelative(op.path);
  const stopIfAborted = (): void => {
    if (signal?.aborted) throw new UpdateInterrupted();
  };
  const full = (rel: string): string => path.join(root, ...rel.split("/"));

  stopIfAborted();
  // 1. 判定の後の変化を確かめる（生のバイト列の指紋）
  const expectations = [
    ...ops.map((op) => ({ path: op.path, sha: op.kind === "replace" ? op.expected : null })),
    ...(input.checks ?? []),
  ];
  const changed: string[] = [];
  for (const e of expectations) {
    if ((await currentSha(fs, root, e.path)) !== e.sha) changed.push(e.path);
  }
  if (changed.length > 0) throw new ChangedAfterJudgment(changed);

  const id = hexOf();
  const tmp = path.join(root, ".harness", `.update-tmp-${id}`);
  const backup = path.join(root, ".harness", `.update-backup-${id}`);
  const entries: Entry[] = ops.map((op, index) => ({
    op,
    index,
    phase: "pending",
    newSha: rawSha(Buffer.from(op.content, "utf8")),
    createdDirs: [],
  }));
  const tmpOf = (index: number): string => path.join(tmp, String(index));

  try {
    // 2. 新しい内容を一時的な場所に書く
    await fs.mkdir(tmp, { recursive: true });
    for (const entry of entries) {
      stopIfAborted();
      const file = tmpOf(entry.index);
      await fs.writeFile(file, entry.op.content);
      if (entry.op.executable) await fs.chmod(file, 0o755);
    }
    stopIfAborted();

    // 3. 入れ替える
    for (const entry of entries) {
      stopIfAborted();
      const { op } = entry;
      const target = full(op.path);
      await assertNoLinks(fs, root, op.path);
      if (op.kind === "replace") {
        const saved = path.join(backup, ...op.path.split("/"));
        await fs.mkdir(path.dirname(saved), { recursive: true });
        await renameWithRetry(fs, target, saved);
        entry.phase = "backed-up";
        // 退避した中身が、判定のときと同じか（退避の直前に編集されていないか）
        if (rawSha(await fs.readFile(saved)) !== op.expected) {
          throw new ChangedAfterJudgment([op.path]);
        }
        stopIfAborted();
        await renameWithRetry(fs, tmpOf(entry.index), target);
        entry.phase = "placed";
      } else {
        // 新しく作る：無いことを、置く直前にも確かめる
        if (await exists(fs, target)) throw new ChangedAfterJudgment([op.path]);
        const missingDirs: string[] = [];
        let dir = path.dirname(target);
        while (dir !== root && !(await exists(fs, dir))) {
          missingDirs.unshift(dir);
          dir = path.dirname(dir);
        }
        entry.createdDirs = missingDirs;
        await fs.mkdir(path.dirname(target), { recursive: true });
        await renameWithRetry(fs, tmpOf(entry.index), target);
        entry.phase = "placed";
      }
    }
    stopIfAborted();
  } catch (original) {
    throw await rollback(fs, { root, tmp, backup, entries, original });
  }

  // 5. 成功：一時的な場所と退避を消す（消せなくても、更新は完了している）
  const cleanupWarnings: string[] = [];
  for (const place of [tmp, backup]) {
    try {
      await fs.rm(place, { recursive: true, force: true });
    } catch (e) {
      cleanupWarnings.push(
        `更新は完了しましたが、一時的な場所を消せませんでした。手で削除してください：${place}（${messageOf(e)}）`,
      );
    }
  }
  return { cleanupWarnings };
}

/** 新しく作ったフォルダを、空なら消す（空でない・消せないものはそのままにする） */
async function removeCreatedDirs(fs: UpdateFs, entry: Entry): Promise<void> {
  for (const dir of [...entry.createdDirs].reverse()) {
    try {
      await fs.rmdir(dir);
    } catch {
      // 空でない・消せないフォルダはそのままにする
    }
  }
}

/** 4. 入れ替えた分を戻す。投げるエラーを返す（呼び出し側が throw する） */
async function rollback(
  fs: UpdateFs,
  state: {
    root: string;
    tmp: string;
    backup: string;
    entries: Entry[];
    original: unknown;
  },
): Promise<Error> {
  const { root, tmp, backup, entries, original } = state;
  const problems: string[] = [];
  let backupNeeded = false;
  const full = (rel: string): string => path.join(root, ...rel.split("/"));

  const sameAsNew = async (target: string, entry: Entry): Promise<boolean> => {
    try {
      return rawSha(await fs.readFile(target)) === entry.newSha;
    } catch {
      return false;
    }
  };

  for (const entry of [...entries].reverse()) {
    const { op } = entry;
    const target = full(op.path);
    if (op.kind === "replace") {
      if (entry.phase === "pending") continue;
      const saved = path.join(backup, ...op.path.split("/"));
      const keep = (why: string): void => {
        backupNeeded = true;
        problems.push(
          `元に戻せなかったファイル：${op.path}。元の内容は ${saved} にあります（${why}）`,
        );
      };
      try {
        if (entry.phase === "backed-up") {
          if (await exists(fs, target)) {
            keep(
              "元の場所に別のファイルができたため、上書きしていません。今のファイルはそのまま残しています",
            );
          } else {
            await renameWithRetry(fs, saved, target);
          }
        } else if (await sameAsNew(target, entry)) {
          await renameWithRetry(fs, saved, target);
        } else {
          keep(
            "復元の直前に変更されたため、上書きしていません。今のファイルはそのまま残しています",
          );
        }
      } catch (e) {
        keep(messageOf(e));
      }
    } else if (entry.phase === "pending") {
      await removeCreatedDirs(fs, entry);
    } else {
      try {
        if (await sameAsNew(target, entry)) {
          await fs.rm(target, { recursive: true, force: true });
          await removeCreatedDirs(fs, entry);
        } else {
          problems.push(
            `新しく作ったファイル ${op.path} は、更新の後に変更されたため、そのまま残しました`,
          );
        }
      } catch (e) {
        problems.push(`新しく作ったファイル ${op.path} を消せませんでした（${messageOf(e)}）`);
      }
    }
  }

  // 新しい内容の一時的な場所は消してよい。退避は、すべて戻せたときだけ消す
  try {
    await fs.rm(tmp, { recursive: true, force: true });
  } catch (e) {
    problems.push(`一時的な場所を消せませんでした：${tmp}（${messageOf(e)}）`);
  }
  if (!backupNeeded) {
    try {
      await fs.rm(backup, { recursive: true, force: true });
    } catch (e) {
      problems.push(`退避の場所を消せませんでした：${backup}（${messageOf(e)}）`);
    }
  }

  if (problems.length > 0) {
    const why =
      original instanceof Error
        ? `更新を止めました（${original.message}）。`
        : "更新を止めました。";
    return new RollbackIncomplete(
      `${why}一部を元に戻せませんでした。\n${problems.join("\n")}`,
      problems,
      backup,
    );
  }
  if (original instanceof ChangedAfterJudgment || original instanceof UpdateInterrupted) {
    return original;
  }
  return new ApplyFailed(`更新に失敗しました（${messageOf(original)}）。すべて元に戻しました`, {
    cause: original,
  });
}
