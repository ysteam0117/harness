// 配布物の確認：組み立て → npm pack → 一時フォルダへインストール → harness --help の確認。
// 手元の環境を汚さないよう、グローバルへのインストールは使わない。
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
    windowsHide: true,
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
const SAMPLE_APP_NAME = "testapp-001";
const SAMPLE_ANSWERS = `app_name: ${SAMPLE_APP_NAME}
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
 * ルールのデータ（data/）・ひな形（templates/）・知見（knowledge/）を読んで、インストール先の一時的なフォルダの中に
 * プロジェクトが生成され（終了コード0）、.harness/config.yaml と AGENTS.md ができることを確かめる。
 * 生成先は一時的なフォルダ（workDir の中）で、pack-check の最後に workDir ごと消える。
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
  if (r.status !== 0) {
    throw new Error(
      `harness create の結果が想定と違います（終了コード ${String(r.status)}。想定は 0）：
${output}`,
    );
  }
  // 生成先は <installDir>/<アプリ名>。記録のファイルと AI 向けの本体ができていること
  const projectDir = path.join(installDir, SAMPLE_APP_NAME);
  for (const rel of [path.join(".harness", "config.yaml"), "AGENTS.md"]) {
    if (!existsSync(path.join(projectDir, rel))) {
      throw new Error(`生成したプロジェクトに ${rel} がありません（生成先：${projectDir}）：
${output}`);
    }
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
  console.log(
    "harness create（データ・ひな形・知見の読み込みと、一時的なフォルダへの生成を含む）の確認に成功しました。",
  );
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
