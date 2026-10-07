import path from "node:path";
import { Command } from "commander";
import semver from "semver";
import { CONFIG_PATH, fingerprint, harnessVersion } from "../generate/config.js";
import { GenerateError } from "../generate/errors.js";
import { changesSince, parseChangelog, readBundledChangelog } from "../update/changelog.js";
import { realUpdateFs, type UpdateFs } from "../update/fs.js";
import {
  defaultRunGh,
  fetchLatestVersion,
  readOwnRepository,
  type RunGh,
} from "../update/latest.js";
import { extractBlock } from "../adopt/markers.js";
import { ConfigError, parseConfig, type RecordedConfig } from "../update/read-config.js";
import { messageOf, readState } from "../update/state.js";

export interface StatusDeps {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** gh の実行の差し替え（テスト用）。既定は本物 */
  runGh?: RunGh;
  /** 最新の版を調べる GitHub リポジトリ（持ち主/名前）の差し替え。既定は ysteam0117/harness（環境変数 HARNESS_REPOSITORY で変えられる） */
  repository?: () => string | undefined;
  /** 同梱の CHANGELOG.md の差し替え */
  changelog?: () => string | undefined;
  /** 実行中の CLI のバージョンの差し替え */
  harnessVersion?: () => string;
  /** ファイル操作の差し替え */
  fs?: Partial<UpdateFs>;
}

export interface StatusOptions {
  /** --dir：プロジェクトのフォルダ（既定は作業中のフォルダ） */
  dir?: string;
}

/** 管理するファイルの、書き換え・削除の状態（指紋の比較。何も書かない） */
async function inspectManaged(
  fs: UpdateFs,
  root: string,
  recorded: RecordedConfig,
): Promise<{
  modified: string[];
  missing: string[];
  unreadable: string[];
  brokenMarkers: string[];
}> {
  const modified: string[] = [];
  const missing: string[] = [];
  const unreadable: string[] = [];
  const brokenMarkers: string[] = [];
  const marked = new Set(recorded.markedFiles);
  for (const [p, fp] of Object.entries(recorded.managedFiles)) {
    try {
      const state = await readState(fs, root, p);
      if (state.kind === "absent") {
        missing.push(p);
      } else if (marked.has(p)) {
        // 印で囲んだ文書は、印の中の本文の指紋で比べる（印の外の編集は数えない）
        const located = extractBlock(state.text);
        if (located.kind !== "found") brokenMarkers.push(p);
        else if (fingerprint(located.body) !== fp) modified.push(p);
      } else if (fingerprint(state.text) !== fp) {
        modified.push(p);
      }
    } catch (e) {
      if (!(e instanceof GenerateError)) throw e;
      unreadable.push(p);
    }
  }
  return { modified, missing, unreadable, brokenMarkers };
}

function listLines(paths: string[]): string[] {
  return paths.map((p) => `  - ${p}`);
}

/** harness status（F-27）：プロジェクトのバージョン・インストール済みのバージョン・最新のバージョン・主な変更点 */
export async function runStatus(
  options: StatusOptions,
  deps: StatusDeps,
): Promise<{ exitCode: number }> {
  const fs: UpdateFs = { ...realUpdateFs, ...deps.fs };
  const installed = (deps.harnessVersion ?? harnessVersion)();

  // プロジェクトの記録（なければ、CLI の情報だけ）
  let recorded: RecordedConfig | undefined;
  let root: string | undefined;
  try {
    root = await fs.realpath(path.resolve(deps.cwd, options.dir ?? "."));
  } catch (e) {
    deps.stderr(`エラー: フォルダを開けません（${messageOf(e)}）\n`);
    return { exitCode: 1 };
  }
  try {
    const state = await readState(fs, root, CONFIG_PATH);
    if (state.kind === "file") recorded = parseConfig(state.text);
  } catch (e) {
    if (e instanceof ConfigError || e instanceof GenerateError) {
      deps.stderr(`エラー: ${e.message}\n`);
      return { exitCode: 1 };
    }
    throw e;
  }

  // 最新の版（取れなくても、終了コードは0）
  const latest = await fetchLatestVersion(
    (deps.repository ?? readOwnRepository)(),
    deps.runGh ?? defaultRunGh,
  );

  const lines: string[] = [];
  if (recorded !== undefined) lines.push(`プロジェクトのバージョン：${recorded.harnessVersion}`);
  lines.push(`インストール済みのバージョン：${installed}`);
  lines.push(
    latest.ok
      ? `最新のバージョン：${latest.version}`
      : `最新のバージョン：取得できません（${latest.reason}）`,
  );

  const changelogText = (deps.changelog ?? readBundledChangelog)();
  const entries = changelogText === undefined ? undefined : parseChangelog(changelogText);
  lines.push("");
  if (recorded === undefined) {
    lines.push(
      "このフォルダには .harness/config.yaml がありません（harness create で作ったプロジェクトのフォルダで実行すると、プロジェクトの状態も表示します）。",
    );
    if (entries === undefined) lines.push("主な変更点：変更履歴がありません");
    else {
      lines.push("主な変更点（直近の3つ）：");
      for (const e of entries.slice(0, 3))
        lines.push(`  ${e.version}`, ...e.body.split("\n").map((l) => `    ${l}`));
    }
  } else {
    lines.push(`主な変更点（${recorded.harnessVersion} より新しいもの）：`);
    if (entries === undefined) {
      lines[lines.length - 1] = "主な変更点：変更履歴がありません";
    } else {
      const changes = changesSince(entries, recorded.harnessVersion);
      if (changes.length === 0) lines[lines.length - 1] = "主な変更点：変更点はありません";
      for (const c of changes)
        lines.push(`  ${c.version}`, ...c.body.split("\n").map((l) => `    ${l}`));
    }

    const managed = await inspectManaged(fs, root, recorded);
    lines.push("");
    lines.push(`書き換え済みの管理ファイル：${String(managed.modified.length)} 件`);
    lines.push(...listLines(managed.modified));
    if (managed.missing.length > 0) {
      lines.push(`消えている管理ファイル：${String(managed.missing.length)} 件`);
      lines.push(...listLines(managed.missing));
    }
    if (managed.brokenMarkers.length > 0) {
      lines.push(`印が壊れている管理ファイル：${String(managed.brokenMarkers.length)} 件`);
      lines.push(...listLines(managed.brokenMarkers));
    }
    if (managed.unreadable.length > 0) {
      lines.push(
        `確かめられなかった管理ファイル（リンクなど）：${String(managed.unreadable.length)} 件`,
      );
      lines.push(...listLines(managed.unreadable));
    }

    const newer =
      semver.gt(installed, recorded.harnessVersion) ||
      (latest.ok && semver.gt(latest.version, recorded.harnessVersion));
    if (newer) {
      lines.push("");
      lines.push(
        "新しいバージョンがあります。harness update --dry-run で、何が変わるかを確かめられます。",
      );
    }
  }
  if (latest.ok && semver.gt(latest.version, installed)) {
    const repository = (deps.repository ?? readOwnRepository)();
    lines.push("");
    lines.push(
      repository !== undefined
        ? `インストール済みのハーネスより新しいバージョンがあります。npm install -g github:${repository} で更新できます。`
        : "インストール済みのハーネスより新しいバージョンがあります。",
    );
  }
  deps.stdout(`${lines.join("\n")}\n`);
  return { exitCode: 0 };
}

export function statusCommand(deps: Partial<StatusDeps> = {}): Command {
  return new Command("status")
    .description("今のハーネスのバージョン・最新のバージョン・主な変更点を表示する")
    .option("--dir <フォルダ>", "プロジェクトのフォルダ（既定は作業中のフォルダ）")
    .action(async (options: StatusOptions) => {
      const outcome = await runStatus(options, {
        cwd: deps.cwd ?? process.cwd(),
        stdout: deps.stdout ?? ((text) => void process.stdout.write(text)),
        stderr: deps.stderr ?? ((text) => void process.stderr.write(text)),
        ...(deps.runGh ? { runGh: deps.runGh } : {}),
        ...(deps.repository ? { repository: deps.repository } : {}),
        ...(deps.changelog ? { changelog: deps.changelog } : {}),
        ...(deps.harnessVersion ? { harnessVersion: deps.harnessVersion } : {}),
        ...(deps.fs ? { fs: deps.fs } : {}),
      });
      process.exitCode = outcome.exitCode;
    });
}
