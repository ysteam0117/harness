// 作業のブランチを、品質チェック（npm run check）が通った場合だけ、main に Squash で取り込む（GitHub を使わないプロジェクト、C-83）。
// 使い方：npm run merge:check（今のブランチを取り込む）／npm run merge:check -- <ブランチ名>（指定したブランチを取り込む）
// 取り込む内容（main に作業のブランチの変更を足した状態）で品質チェックを行い、失敗したら main には何も残さない。
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAIN = "main";
const BRANCH_PATTERN = /^(feature|fix|docs|refactor|chore)\/(\d+)-([a-z0-9][a-z0-9-]*)$/;
const COMMIT_TYPES = {
  feature: "feat",
  fix: "fix",
  docs: "docs",
  refactor: "refactor",
  chore: "chore",
};

/** 取り込めない理由。メッセージを表示して、取り込みを止める */
class Abort extends Error {}

class Interrupted extends Abort {
  constructor(signal) {
    super(`${signal} により中断しました`);
    this.exitCode = signal === "SIGTERM" ? 143 : 130;
  }
}

function checkInterrupted(result) {
  if (result.status === null && result.signal) throw new Interrupted(result.signal);
}

// spawnSync の間に届いた親へのシグナルを、次の変更に進む前に処理する。
const receiveSignals = () => new Promise((resolve) => setImmediate(resolve));

function git(args, { allowFail = false } = {}) {
  const result = spawnSync("git", args, { encoding: "utf8", windowsHide: true });
  checkInterrupted(result);
  if (result.error) throw new Abort(`git を実行できません：${result.error.message}`);
  if (result.status !== 0 && !allowFail) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Abort(`git ${args.join(" ")} に失敗しました。${detail}`);
  }
  return { ok: result.status === 0, out: (result.stdout ?? "").trim() };
}

/** パスの比較用（記号リンク・大文字小文字・区切りの違いをそろえる） */
function samePath(a, b) {
  const normalize = (p) => {
    let resolved;
    try {
      resolved = realpathSync.native(p);
    } catch {
      resolved = path.resolve(p);
    }
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
}

/** main をチェックアウトしている作業ツリーのパス（なければ undefined） */
function worktreeHoldingMain() {
  const blocks = git(["worktree", "list", "--porcelain"]).out.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (lines.includes(`branch refs/heads/${MAIN}`)) {
      const line = lines.find((l) => l.startsWith("worktree "));
      return line?.slice("worktree ".length);
    }
  }
  return undefined;
}

function markFile() {
  return path.resolve(git(["rev-parse", "--git-path", "harness-merge-check"]).out);
}

function runCheck() {
  // 固定のコマンドだけを渡す（Windows の npm.cmd のため shell を使う）
  // nosemgrep: semgrep.spawn-shell-true 外からの値を含まない固定の文字列だけを渡す（Windows の npm.cmd を起動するため）
  const result = spawnSync("npm run check", { stdio: "inherit", shell: true, windowsHide: true });
  checkInterrupted(result);
  return result.status === 0;
}

function installDependencies() {
  // lock がないときは、取り込む内容に含まれない lock を作らない
  const command = existsSync("package-lock.json") ? "npm ci" : "npm install --no-package-lock";
  // nosemgrep: semgrep.spawn-shell-true command は上の2つの固定の文字列のどちらかだけ（Windows の npm.cmd を起動するため）
  const result = spawnSync(command, { stdio: "inherit", shell: true, windowsHide: true });
  checkInterrupted(result);
  return result.status === 0;
}

/** 存在しないファイルも区別して、依存の定義の中身を記録する */
function dependencyContents() {
  return ["package.json", "package-lock.json"].map((file) =>
    existsSync(file) ? readFileSync(file, "utf8") : null,
  );
}

function sameDependencies(a, b) {
  return a.every((content, index) => content === b[index]);
}

/** docs/issues/<番号4桁>-*.md の状態を「完了」にする。見つからない・状態の行がないときは止める */
function completeIssue(number) {
  const prefix = `${String(number).padStart(4, "0")}-`;
  const dir = "docs/issues";
  const names = existsSync(dir)
    ? readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith(".md"))
    : [];
  if (names.length !== 1) {
    throw new Abort(
      names.length === 0
        ? `${dir}/${prefix}*.md（Issue のファイル）が見つかりません`
        : `${dir}/${prefix}*.md が複数あります：${names.join("、")}`,
    );
  }
  const file = `${dir}/${names[0]}`;
  const text = readFileSync(file, "utf8");
  if (!/^- 状態：.*$/m.test(text)) {
    throw new Abort(`${file} に「- 状態：」の行がありません`);
  }
  writeFileSync(file, text.replace(/^- 状態：.*$/m, "- 状態：完了"));
  git(["add", "--", file]);
}

/** 取り込むブランチを決めて、名前の形を確かめる */
function chooseBranch(argument, original) {
  let branch = argument;
  if (branch === undefined) {
    if (original === "") throw new Abort("ブランチに切り替えていません。ブランチ名を指定してください");
    if (original === MAIN) {
      throw new Abort(`今は ${MAIN} です。ブランチ名を指定してください（npm run merge:check -- <ブランチ名>）`);
    }
    branch = original;
  }
  if (branch === MAIN) throw new Abort(`${MAIN} は取り込めません。作業のブランチを指定してください`);
  const match = BRANCH_PATTERN.exec(branch);
  if (!match) {
    throw new Abort(`ブランチ名 ${branch} が、<種類>/<番号>-<内容>（例：feature/12-login）の形ではありません`);
  }
  return { branch, match };
}

/** 取り込む前の確かめ（何も変えない） */
function verifyReady(branch, top) {
  for (const name of [branch, MAIN]) {
    if (!git(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], { allowFail: true }).ok) {
      throw new Abort(`ブランチ ${name} がありません`);
    }
  }
  if (git(["status", "--porcelain"]).out !== "") {
    throw new Abort("作業ツリーに、コミットしていない変更があります。コミットするか退避してから実行してください");
  }
  const holder = worktreeHoldingMain();
  if (holder !== undefined && !samePath(holder, top)) {
    throw new Abort(
      `${MAIN} は ${holder} で使用中です。その作業ツリーで npm run merge:check -- ${branch} を実行してください`,
    );
  }
}

async function main() {
  const top = git(["rev-parse", "--show-toplevel"]).out;
  process.chdir(top);

  const original = git(["symbolic-ref", "--short", "-q", "HEAD"], { allowFail: true }).out;
  const originalCommit = git(["rev-parse", "HEAD"]).out;
  const { branch, match } = chooseBranch(process.argv[2], original);
  verifyReady(branch, top);
  const originalDependencies = dependencyContents();

  const [, kind, numberText, slug] = match;
  const message = `${COMMIT_TYPES[kind]}: ${slug.replaceAll("-", " ")} (#${numberText})`;
  const mark = markFile();
  const mainCommit = git(["rev-parse", MAIN]).out;
  let onMain = original === MAIN;
  let installedDependencies = originalDependencies;
  const restore = () => {
    rollback(original, originalCommit, mark, onMain ? mainCommit : undefined);
    if (!sameDependencies(installedDependencies, originalDependencies)) {
      try {
        if (installDependencies()) return;
      } catch {
        // 復元中の中断も、依存の復元失敗として案内する。
      }
      console.error("依存を元に戻せませんでした。npm install を実行してください");
    }
  };
  const interrupt = (signal) => {
    restore();
    console.error(`取り込みませんでした：${signal} により中断しました`);
    process.exit(signal === "SIGTERM" ? 143 : 130);
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  // ここから先は、失敗したら元に戻す
  try {
    if (original !== MAIN) git(["checkout", MAIN, "--"]);
    onMain = true;
    await receiveSignals();
    git(["merge", "--squash", branch]);
    if (git(["diff", "--cached", "--quiet"], { allowFail: true }).ok) {
      throw new Abort(`${branch} に、${MAIN} へ取り込む変更がありません`);
    }
    const validationDependencies = dependencyContents();
    if (!sameDependencies(validationDependencies, originalDependencies)) {
      // 失敗・中断で一部だけ更新された場合も、巻き戻し後の復元が必要。
      installedDependencies = validationDependencies;
      const installed = installDependencies();
      await receiveSignals();
      if (!installed) throw new Abort("依存のインストールが失敗しました");
    }
    console.log(`取り込む内容（${MAIN} に ${branch} を足した状態）で、品質チェックを行います`);
    const passed = runCheck();
    await receiveSignals();
    if (!passed) throw new Abort("品質チェックが失敗しました");
    completeIssue(Number(numberText));
    // 印：このコミットだけ、pre-commit が main への直接のコミットを許す（ステージした内容の木の hash が一致するときだけ）
    writeFileSync(mark, `${git(["write-tree"]).out}\n`);
    try {
      git(["commit", "-m", message]);
      await receiveSignals();
    } finally {
      rmSync(mark, { force: true });
    }
  } catch (error) {
    await receiveSignals();
    restore();
    throw error;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
  console.log(`${branch} を ${MAIN} に取り込みました：${message}`);
  console.log(`作業のブランチ ${branch} は残しています。不要になったら、利用者が削除してください`);
}

/** 取り込みの途中で止めたとき、main と作業ツリーとインデックスを、取り込む前の状態に戻す */
function rollback(original, originalCommit, mark, mainCommit) {
  rmSync(mark, { force: true });
  git(mainCommit ? ["reset", "--hard", mainCommit] : ["reset", "--merge"], { allowFail: true });
  if (original === "") {
    git(["checkout", "--detach", originalCommit], { allowFail: true });
  } else if (original !== MAIN) {
    git(["checkout", original, "--"], { allowFail: true });
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof Abort) {
    console.error(`取り込みませんでした：${error.message}`);
    process.exit(error instanceof Interrupted ? error.exitCode : 1);
  }
  throw error;
}
