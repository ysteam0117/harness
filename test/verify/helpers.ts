// #57 テスト共通の道具。本物の npm・Docker は使わない（小さな node の子プロセスは使う）。
// 子プロセスのテストは、固定の短い時間に頼らず、条件で待つ（#77：Windows の CI で時間切れになった反省）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VersionEntry, VersionResult } from "../../src/versions/choose.js";

/** テスト全体の時間の上限（十分に長く取る。条件で待つので、通常はすぐ終わる） */
export const LONG_TEST_MS = 180_000;

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`条件を満たしませんでした：${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const made: string[] = [];

/** 短いパス（TEMP の直下）の作業用フォルダ */
export function makeWorkDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hv57-"));
  made.push(dir);
  return dir;
}

// Windows では、止めた子プロセスがフォルダを手放すまで時間がかかり、削除が EPERM・EBUSY になることがあるため、
// 間を空けてやり直す（最大でおよそ 10 秒。#77）
export function cleanupWorkDirs(): void {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
}

/** 小さな node のスクリプトを書く（CommonJS）。パスを返す */
export function writeScript(dir: string, name: string, source: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, source);
  return file;
}

export const D1_ENV_EXAMPLE = [
  "# 環境の名前",
  "APP_ENV=development",
  "",
  "ALLOWED_ORIGINS=http://localhost:5173",
  "APP_PORT=5173",
  "",
  "SESSION_SECRET=",
  "OIDC_CLIENT_ID=",
  "OIDC_CLIENT_SECRET=",
  "OIDC_ISSUER=",
  "OIDC_REDIRECT_URI=",
  "APP_BASE_URL=",
  "",
].join("\n");

export const PG_ENV_EXAMPLE = [
  "# 環境の名前",
  "APP_ENV=development",
  "ALLOWED_ORIGINS=http://localhost:5173",
  "APP_PORT=5173",
  "POSTGRES_USER=",
  "POSTGRES_PASSWORD=",
  "POSTGRES_DB=app_dev",
  "POSTGRES_PORT=5432",
  "DATABASE_URL=<postgresql://ユーザー名:パスワード@localhost:5432/データベース名>",
  "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=<postgresql://ユーザー名:パスワード@localhost:5432/データベース名>",
  "SESSION_SECRET=",
  "",
].join("\n");

export interface FakeProject {
  dir: string;
}

/** 生成したプロジェクトの代わりの小さなフォルダ（package.json・.env.example） */
export function makeProject(
  options: {
    envExample?: string;
    scripts?: Record<string, string>;
    files?: Record<string, string>;
  } = {},
): FakeProject {
  const dir = path.join(makeWorkDir(), "proj");
  mkdirSync(dir);
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "testapp-001",
      scripts: options.scripts ?? {
        check: "echo",
        typecheck: "echo",
        lint: "echo",
        "test:db": "echo",
        types: "echo",
      },
    }),
  );
  writeFileSync(path.join(dir, ".env.example"), options.envExample ?? D1_ENV_EXAMPLE);
  for (const [name, content] of Object.entries(options.files ?? {})) {
    writeFileSync(path.join(dir, name), content);
  }
  return { dir };
}

export function entry(over: Partial<VersionEntry> & { name: string }): VersionEntry {
  return {
    version: "1.0.0",
    reason: "検証済み",
    surveyedOn: "2026-10-03",
    latestStable: "1.0.0",
    latestStatus: "found",
    verified: "1.0.0",
    newerThanVerified: false,
    majorDiffers: false,
    ...over,
  };
}

export function versionsOf(entries: VersionEntry[]): VersionResult {
  return { entries, newerThanVerified: entries.some((e) => e.newerThanVerified) };
}
