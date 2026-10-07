import { execFile } from "node:child_process";
import { valid } from "semver";

export interface GhResult {
  /** 実行できなかった（gh がない・時間切れ等）ときは null */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** gh の実行の差し替え口 */
export type RunGh = (args: string[], timeoutMs: number) => Promise<GhResult>;

export type LatestResult = { ok: true; version: string } | { ok: false; reason: string };

const TIMEOUT_MS = 5000;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const URL_FORM =
  /^(?:git\+)?(?:https?:\/\/(?:www\.)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:|github:)?([^/\s:]+)\/([^/\s]+?)(?:\.git)?\/?$/;

/** リポジトリの書き方（「持ち主/名前」・GitHub の URL・{ url }）から「持ち主/名前」を取り出す。読めない・怪しい文字を含むときは undefined */
export function repositoryOf(repository: unknown): string | undefined {
  const raw =
    typeof repository === "string"
      ? repository
      : typeof repository === "object" &&
          repository !== null &&
          typeof (repository as { url?: unknown }).url === "string"
        ? (repository as { url: string }).url
        : undefined;
  const match = raw === undefined ? null : URL_FORM.exec(raw.trim());
  const owner = match?.[1];
  const name = match?.[2];
  if (owner === undefined || name === undefined || !NAME.test(owner) || !NAME.test(name)) {
    return undefined;
  }
  return `${owner}/${name}`;
}

/** ハーネスの公開のリポジトリ（組織 ysteam0117。個人のアカウント名を含まない） */
export const DEFAULT_REPOSITORY = "ysteam0117/harness";

/**
 * ハーネスの GitHub リポジトリ（「持ち主/名前」）。既定は DEFAULT_REPOSITORY。
 * 環境変数 HARNESS_REPOSITORY で別のリポジトリ（フォーク等）に向けられる。形が違うときは undefined
 */
export function readOwnRepository(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env["HARNESS_REPOSITORY"];
  return value === undefined || value.trim() === ""
    ? DEFAULT_REPOSITORY
    : repositoryOf(value.trim());
}

/** 本物の gh を実行する（時間切れつき）。実行できなければ code: null */
export const defaultRunGh: RunGh = (args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      "gh",
      args,
      { timeout: timeoutMs, windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        resolve({
          code: typeof code === "number" ? code : null,
          stdout,
          stderr: stderr !== "" ? stderr : error.message,
        });
      },
    );
  });

const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? "";

/**
 * 最新の版を、GitHub の Release から取る（gh release view）。
 * 取れないとき（gh がない・ログインしていない・つながらない・Release がない）は、例外にせず ok: false と理由を返す。
 */
export async function fetchLatestVersion(
  repository: string | undefined,
  runGh: RunGh,
): Promise<LatestResult> {
  if (repository === undefined) {
    return {
      ok: false,
      reason:
        "ハーネスの GitHub リポジトリが分かりません（環境変数 HARNESS_REPOSITORY の形が「持ち主/名前」になっていません）",
    };
  }
  let result: GhResult;
  try {
    result = await runGh(
      ["release", "view", "--repo", repository, "--json", "tagName"],
      TIMEOUT_MS,
    );
  } catch (e) {
    return {
      ok: false,
      reason: `gh を実行できませんでした（${e instanceof Error ? e.message : String(e)}）`,
    };
  }
  if (result.code === null) {
    return {
      ok: false,
      reason: `gh を実行できませんでした（gh がない・時間切れなど：${firstLine(result.stderr)}）`,
    };
  }
  if (result.code !== 0) {
    return {
      ok: false,
      reason: `gh release view が失敗しました（ログインしていない・Release がない・つながらないなど：${firstLine(result.stderr)}）`,
    };
  }
  let tag: unknown;
  try {
    tag = (JSON.parse(result.stdout) as { tagName?: unknown }).tagName;
  } catch {
    return { ok: false, reason: "gh の出力を読めませんでした" };
  }
  const version = typeof tag === "string" ? tag.replace(/^v/, "") : "";
  if (valid(version) === null) {
    return {
      ok: false,
      reason: `Release の名前（${String(tag)}）が、バージョンの形ではありません`,
    };
  }
  return { ok: true, version };
}
