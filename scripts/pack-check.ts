// 配布物の確認：組み立て → npm pack → 一時フォルダへインストール → harness --help の確認。
// 手元の環境を汚さないよう、グローバルへのインストールは使わない。
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * main を実行し、成功・失敗にかかわらず cleanup を必ず1回呼ぶ。
 * 本処理だけ失敗：本処理のエラーをそのまま投げる。片付けだけ失敗：片付けのエラーをそのまま投げる。
 * 両方失敗：AggregateError に [本処理, 片付け] の順で入れて投げる（どちらも隠さない）。
 */
export async function runWithCleanup<T>(
  main: () => T | Promise<T>,
  cleanup: () => void | Promise<void>,
): Promise<T> {
  let result: T | undefined;
  let mainFailed = false;
  let mainError: unknown;
  try {
    result = await main();
  } catch (e) {
    mainFailed = true;
    mainError = e;
  }
  try {
    await cleanup();
  } catch (cleanupError) {
    if (mainFailed) {
      throw new AggregateError(
        [mainError, cleanupError],
        "本処理と後始末の両方で失敗しました（errors の順は、本処理・後始末）",
        { cause: cleanupError },
      );
    }
    throw cleanupError;
  }
  if (mainFailed) {
    throw mainError;
  }
  return result as T;
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

/**
 * npm は「npm run」経由で起動されたときの npm_execpath（npm-cli.js）を node で実行する。
 * shell を使わないので、Windows・macOS・Linux で同じ動きになる。
 */
function npm(args: string[], cwd: string): string {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("npm run pack:check で実行してください（npm_execpath が見つかりません）");
  }
  return run(process.execPath, [npmCli, ...args], cwd);
}

/** 配布物の確認に使う、架空の回答（実在しない値だけ）。手元の道具の警告は環境で変わるため、承知済みにしておく */
const SAMPLE_ANSWERS = `app_name: testapp-001
ais: [claude]
visibility: private
team_size: solo
database: d1
auth: oidc
idp: google
personal_data: none
admin: no
critical_ops: "no"
collaborative: "no"
org_separation: "no"
realtime: "no"
availability: tolerant
file_upload: "no"
check_location: both
version_policy: verified
accepted_warnings: [missing-tools]
`;

/**
 * インストールした配布物で `harness create --answers <架空の回答> --yes` を実行し、
 * ルールのデータ（data/）を読めて「生成は Issue #34 で実装予定」で終わる（終了コード1）ことを確かめる。
 * 失敗する終了コードを例外にせず、内容を確かめるため spawnSync を使う（shell は使わない）。
 */
function checkCreate(workDir: string, installDir: string): void {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("npm run pack:check で実行してください（npm_execpath が見つかりません）");
  }
  const answersFile = path.join(workDir, "answers.yaml");
  writeFileSync(answersFile, SAMPLE_ANSWERS);
  const r = spawnSync(
    process.execPath,
    [npmCli, "exec", "--no", "--", "harness", "create", "--answers", answersFile, "--yes"],
    { cwd: installDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  if (r.error) {
    throw new Error(`harness create を起動できませんでした：${r.error.message}`);
  }
  const output = `${r.stdout}
${r.stderr}`;
  if (r.status !== 1 || !output.includes("生成は Issue #34 で実装予定")) {
    throw new Error(
      `harness create の結果が想定と違います（終了コード ${String(r.status)}。想定は 1 と「生成は Issue #34 で実装予定」の表示）：
${output}`,
    );
  }
}

function checkPackage(workDir: string): void {
  const installDir = path.join(workDir, "install");
  mkdirSync(installDir);
  npm(["run", "build"], rootDir);
  // npm pack は最後の行に作ったファイル名を出す
  const packOutput = npm(["pack", "--pack-destination", workDir], rootDir);
  const tgz = packOutput.trim().split(/\r?\n/).at(-1);
  if (!tgz || !readdirSync(workDir).includes(tgz)) {
    throw new Error(`npm pack が作ったファイルが見つかりません：${packOutput}`);
  }
  npm(["init", "-y"], installDir);
  npm(["install", "--no-audit", "--no-fund", path.join(workDir, tgz)], installDir);
  // 利用者が使うコマンド名（bin の登録）で起動する
  const help = npm(["exec", "--no", "--", "harness", "--help"], installDir);
  for (const name of ["create", "update", "status"]) {
    if (!help.includes(name)) {
      throw new Error(`harness --help の出力に ${name} がありません：\n${help}`);
    }
  }
  console.log(help);
  checkCreate(workDir, installDir);
  console.log("harness create（ルールのデータの読み込みを含む）の確認に成功しました。");
  console.log("配布物の確認に成功しました。");
}

async function main(): Promise<void> {
  let workDir: string | undefined;
  await runWithCleanup(
    () => {
      workDir = mkdtempSync(path.join(os.tmpdir(), "harness-pack-check-"));
      checkPackage(workDir);
    },
    () => {
      if (workDir !== undefined) {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
  );
}

function describeError(e: unknown): string {
  if (e instanceof AggregateError) {
    return [e.message, ...e.errors.map((inner) => `- ${describeError(inner)}`)].join("\n");
  }
  return e instanceof Error ? e.message : String(e);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (e) {
    console.error(describeError(e));
    process.exitCode = 1;
  }
}
