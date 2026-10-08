// #17 レビュー2回目 smoke：実際の gitleaks のテンプレートの出力が、特殊なファイル名でも JSON として読める。
// 日本語・空白・引用符・バックスラッシュ・制御文字（ESC・ベル・改行）を含むファイル名を、gitleaks のイメージの
// 中の sh と git で作る（Windows のファイルシステムでは作れない名前があるため）。Docker が使えなければ飛ばす。
// ダミーの値は、実行時に連結して作る。実データ・個人名は使わない（架空の値だけ）。
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decideDockerStep } from "../../scripts/smoke-generated.js";
import { linuxDockerAvailable, removeWithContainer } from "./docker-helpers.js";
import { gitleaksImage, scanSecrets } from "../../src/adopt/secret-scan.js";

const run = decideDockerStep(linuxDockerAvailable(), process.env) === "run";

const TAIL = ["aB3dE5gH7j", "K9mN1pQ3sT", "5vW7yZ9bC1", "dE3fG5"].join("");
const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) removeWithContainer(dir, [path.join(dir, "repo")]);
});

// sh の printf の書式。日本語（UTF-8 の8進数）・空白・"・\・ESC(\033)・ベル(\007)・改行(\n)
const NAME_FORMAT = String.raw`dir/\346\227\245\346\234\254 \350\252\236 "q"\\b\033e\007c\nn.txt`;
const SCRIPT = [
  "set -e",
  "cd /work",
  "git init -q",
  `V="gh""p_${TAIL}"`,
  `N=$(printf '${NAME_FORMAT}')`,
  `mkdir -p dir`,
  `printf 'k=%s\\n' "$V" > "./$N"`,
  "git add -A",
  "git -c user.name=testuser_001 -c user.email=testuser_001@example.com commit -qm one",
].join("\n");

describe.skipIf(!run)("#17 smoke：特殊なファイル名でも、実際のテンプレートの出力を読める", () => {
  it("見つかったものとして、制御文字を逃がした名前で表示される。値は出ない", async () => {
    const base = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "harness-smoke-names-")));
    roots.push(base);
    const repo = path.join(base, "repo");
    mkdirSync(repo);
    const scriptFile = path.join(base, "make.sh");
    writeFileSync(scriptFile, SCRIPT);
    const made = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "-v",
        `${repo}:/work`,
        "-v",
        `${scriptFile}:/make.sh:ro`,
        "--entrypoint",
        "sh",
        gitleaksImage(),
        "/make.sh",
      ],
      { stdio: "ignore", windowsHide: true },
    );
    expect(made.status).toBe(0);

    const result = await scanSecrets(repo);
    // 作業フォルダ（Windows 側）には名前のファイルが見えないことがあるため、履歴のほうを確かめる
    expect(result.kind).toBe("leaks");
    if (result.kind !== "leaks") return;
    const shown = result.history[0]?.file ?? "";
    expect(shown).toContain("日本 語");
    expect(shown).toContain('"q"');
    expect(shown).toContain("\\x1b");
    expect(shown).toContain("\\x07");
    expect(shown).toContain("\\x0a");
    expect(JSON.stringify(result)).not.toContain(TAIL);
  }, 180_000);
});
