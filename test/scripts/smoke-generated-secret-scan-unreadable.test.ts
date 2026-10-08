// #17 レビュー3回目 smoke：gitleaks が読めないものを黙って飛ばす問題を、実際の Docker で確かめる。
// gitleaks のイメージは root で動くため、既定では chmod 000 のものも読める。読めない環境（rootless Docker・
// root squash の共有フォルダなど）は、root の権限（DAC_OVERRIDE・DAC_READ_SEARCH）を落としてまねる。
// ダミーの値は、実行時に連結して作る。実データ・個人名は使わない（架空の値だけ）。Docker が使えなければ飛ばす。
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decideDockerStep } from "../../scripts/smoke-generated.js";
import { gitleaksImage, scanSecrets } from "../../src/adopt/secret-scan.js";

const docker = spawnSync("docker", ["info"], { stdio: "ignore", windowsHide: true });
const run = decideDockerStep(docker.status === 0, process.env) === "run";

const TAIL = ["aB3dE5gH7j", "K9mN1pQ3sT", "5vW7yZ9bC1", "dE3fG5"].join("");
const NAME = "locked_dir_name_marker";
const DROP_CAPS = ["--cap-drop", "DAC_OVERRIDE", "--cap-drop", "DAC_READ_SEARCH"];

const roots: string[] = [];
afterAll(() => {
  for (const base of roots) {
    // 権限を戻してから消す（読めないフォルダは、ホストから消せないことがある）
    docker_sh(path.join(base, "repo"), "chmod -R 755 /work || true");
    rmSync(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});

function docker_sh(repo: string, script: string): number | null {
  return spawnSync(
    "docker",
    ["run", "--rm", "-v", `${repo}:/work`, "--entrypoint", "sh", gitleaksImage(), "-c", script],
    { stdio: "ignore", windowsHide: true },
  ).status;
}

/** 読めないフォルダ（中に秘密の値のあるファイル）と、読めないファイルがあるリポジトリ */
function lockedRepo(): string {
  const base = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "harness-smoke-locked-")));
  roots.push(base);
  const repo = path.join(base, "repo");
  mkdirSync(repo);
  writeFileSync(path.join(repo, "plain.txt"), "ok\n");
  const value = ["gh", "p_", TAIL].join("");
  const script = [
    "set -e",
    "cd /work",
    `mkdir ${NAME}`,
    `echo "k=${value}" > ${NAME}/a.txt`,
    `chmod 000 ${NAME}/a.txt`,
    `chmod 000 ${NAME}`,
  ].join("\n");
  expect(docker_sh(repo, script)).toBe(0);
  return repo;
}

describe.skipIf(!run)("#17 smoke：読めないファイル・フォルダを見逃さない", () => {
  it("読めない環境（root の権限なし）：unreadable で止まる。名前も値も結果に出ない", async () => {
    const repo = lockedRepo();
    const result = await scanSecrets(repo, { extraDockerArgs: DROP_CAPS });
    expect(result.kind).toBe("unreadable");
    if (result.kind === "unreadable") expect(result.count).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(NAME);
    expect(JSON.stringify(result)).not.toContain(TAIL);
  }, 180_000);

  it("既定（root で動き、読める）：読めないものはなく、中の秘密も見つかる", async () => {
    const repo = lockedRepo();
    const result = await scanSecrets(repo);
    expect(result.kind).toBe("leaks");
    expect(JSON.stringify(result)).not.toContain(TAIL);
  }, 180_000);

  it("読めないものが無い通常のフォルダは、そのまま確認できる", async () => {
    const base = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "harness-smoke-plain-")));
    roots.push(base);
    mkdirSync(path.join(base, "repo"));
    writeFileSync(path.join(base, "repo", "plain.txt"), "ok\n");
    const result = await scanSecrets(path.join(base, "repo"), { extraDockerArgs: DROP_CAPS });
    expect(result).toMatchObject({ kind: "clean", scope: "worktree" });
  }, 180_000);
});
