// harness adopt のブランチ作成（F-29 の手順6、C-42）。導入は、新しいブランチ chore/<導入先の Issue 番号>-adopt-harness に書き、main に直接入れない。
// git の実行は RunGit（update.ts と同じ差し替え口）で行う。コミット・push・PR はしない。
import type { RunGit } from "../commands/update.js";

export interface BranchPlan {
  /** 作る（または、すでにいる）ブランチの名前 */
  name: string;
  /** 分ける元のブランチ。HEAD が切り離されているときは undefined */
  from: string | undefined;
  /** 今いるブランチがちょうど同じ名前（作らずに続ける） */
  alreadyOn: boolean;
}

export type PrepareResult = { ok: true; plan: BranchPlan } | { ok: false; message: string };

/** --issue の値。正の整数（数字だけの文字列を含む）なら番号、それ以外は undefined */
export function parseIssue(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

export function branchNameFor(issue: number): string {
  return `chore/${String(issue)}-adopt-harness`;
}

/**
 * 書き込みの前の検査。git のフォルダで、作業ツリーがきれいで、同じ名前のブランチが（今いるもの以外に）ないことを確かめる。
 * 何も書き換えない。止めるときは、理由（日本語）を返す
 */
export async function prepareBranch(
  runGit: RunGit,
  root: string,
  issue: number,
): Promise<PrepareResult> {
  const name = branchNameFor(issue);
  const inRepo = await runGit(["rev-parse", "--is-inside-work-tree"], root).then(
    (r) => r.code === 0 && r.stdout.trim() === "true",
    () => false,
  );
  if (!inRepo) {
    return {
      ok: false,
      message:
        "Git のフォルダではありません（または git を実行できません）。harness adopt は、新しいブランチに導入するため、Git で管理しているプロジェクトにだけ使えます。git init とコミットをしてから、もう一度実行してください。何も書いていません",
    };
  }
  const status = await runGit(["status", "--porcelain", "--untracked-files=all"], root).catch(
    () => undefined,
  );
  if (status === undefined || status.code !== 0) {
    return { ok: false, message: "git status を実行できませんでした。何も書いていません" };
  }
  if (status.stdout.trim() !== "") {
    return {
      ok: false,
      message:
        "Git の作業ツリーに、コミットしていない変更・未追跡のファイルがあります（回答のファイルをプロジェクトの中に置いている場合も同じです）。導入の差分に混ざらないよう、コミットするか退避してから、もう一度実行してください。何も書いていません",
    };
  }
  const current = await runGit(["branch", "--show-current"], root).catch(() => undefined);
  if (current === undefined || current.code !== 0) {
    return { ok: false, message: "今のブランチを確かめられませんでした。何も書いていません" };
  }
  const from = current.stdout.trim() === "" ? undefined : current.stdout.trim();
  const exists = await runGit(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`],
    root,
  ).then(
    (r) => r.code === 0,
    () => false,
  );
  if (exists && from !== name) {
    return {
      ok: false,
      message: `ブランチ ${name} がすでにあります。別の Issue の番号を指定するか、そのブランチを使い終わっているなら削除してから、もう一度実行してください。何も書いていません`,
    };
  }
  return { ok: true, plan: { name, from, alreadyOn: exists } };
}

/** 承認のあと、書く前に、新しいブランチへ移る（git switch -c）。すでに同じ名前のブランチにいれば、何もしない */
export async function createBranch(
  runGit: RunGit,
  root: string,
  plan: BranchPlan,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (plan.alreadyOn) return { ok: true };
  const result = await runGit(["switch", "-c", plan.name], root).catch((e: unknown) => ({
    code: null,
    stdout: "",
    stderr: e instanceof Error ? e.message : String(e),
  }));
  if (result.code !== 0) {
    return {
      ok: false,
      message: `ブランチ ${plan.name} を作れませんでした（${result.stderr.trim()}）。何も書いていません`,
    };
  }
  return { ok: true };
}

/**
 * 書き込み（applyUpdate）の直前の確認。今のブランチが導入用ブランチでなければ、何も書かずに止める。
 * 検査や作成のあと、対話の間などに、別のブランチへ移されていても、main などに書かないため
 */
export async function ensureOnBranch(
  runGit: RunGit,
  root: string,
  name: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const current = await runGit(["branch", "--show-current"], root).catch(() => undefined);
  if (current === undefined || current.code !== 0 || current.stdout.trim() !== name) {
    return {
      ok: false,
      message: `今のブランチが ${name} ではありません（導入の途中で、別のブランチへ移った可能性があります）。何も書いていません。ブランチを確かめて、もう一度実行してください`,
    };
  }
  return { ok: true };
}
