// #35 テスト共通の道具（一時フォルダに create の出力を作り、更新を試す）。
// 本物の gh・ネットワークは使わない。実データ・個人名は使わない（架空の値だけ）。
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { parse, stringify } from "yaml";
import type { ToolStatus } from "../../src/checks/tools.js";
import { runCreate, type CreateDeps } from "../../src/commands/create.js";
import type { GitResult, UpdateDeps } from "../../src/commands/update.js";
import { fingerprint } from "../../src/generate/config.js";
import { isManagedPath } from "../../src/generate/project.js";
import { FakePrompter, baseAnswers } from "../questions/helpers.js";
import { FIXED_NOW, offlineFetch } from "../versions/helpers.js";

export const okTools = async (): Promise<ToolStatus[]> => [
  { name: "node", state: "ok", version: "24.0.0" },
  { name: "git", state: "ok", version: "2.45.0" },
  { name: "docker", state: "ok", version: "27.0.1" },
];

const roots: string[] = [];
const templateRoots: string[] = [];

const removeDir = (dir: string): void =>
  rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });

// 見本は、ファイルの最後にまとめて消す（テストごとには消さない）
afterAll(() => {
  for (const dir of templateRoots.splice(0)) removeDir(dir);
  templates.clear();
});

/** 一時フォルダを作る（後で cleanupRoots で消す） */
export function newRoot(): string {
  // macOS の一時フォルダはリンク（/var → /private/var）、Windows の CI は短い名前（RUNNER~1）を含むため、
  // 実装が使う本当のパス（realpath）にそろえる（パスで照合するテストのため）
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "harness-q35-")));
  roots.push(root);
  return root;
}

/** 一時フォルダを消す。Windows で一時的に消せないことがあるため、やり直しを付ける */
export function cleanupRoots(): void {
  for (const dir of roots.splice(0)) removeDir(dir);
}

const templates = new Map<string, string>();

/** create の出力（更新の対象）の見本。同じ回答なら1度だけ作る */
async function projectTemplate(over: Record<string, unknown>, warnings: string[]): Promise<string> {
  const key = JSON.stringify([over, warnings]);
  const cached = templates.get(key);
  if (cached !== undefined) return cached;
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "harness-q35-t-")));
  templateRoots.push(root);
  const cwd = path.join(root, "work");
  mkdirSync(cwd);
  const answersFile = path.join(root, "answers.yaml");
  writeFileSync(
    answersFile,
    stringify({
      ...baseAnswers(over),
      ...(warnings.length > 0 ? { accepted_warnings: warnings } : {}),
    }),
  );
  const errs: string[] = [];
  const deps: CreateDeps = {
    prompter: new FakePrompter(),
    cwd,
    interactive: false,
    stderr: (s) => errs.push(s),
    checkTools: okTools,
    fetch: offlineFetch().fn,
    now: () => FIXED_NOW,
  };
  const out = await runCreate({ answers: answersFile, yes: true }, deps);
  if (out.exitCode !== 0 || out.projectDir === undefined) {
    throw new Error(`見本の生成に失敗しました：${errs.join("")}`);
  }
  templates.set(key, out.projectDir);
  return out.projectDir;
}

/** create の出力を、新しい一時フォルダにコピーして返す（テストごとに独立） */
export async function freshProject(
  over: Record<string, unknown> = {},
  warnings: string[] = [],
): Promise<string> {
  const source = await projectTemplate(over, warnings);
  const dir = path.join(newRoot(), path.basename(source));
  cpSync(source, dir, { recursive: true });
  return dir;
}

/** 問題なし（Git のフォルダで、変更なし）を返す git の差し替え */
export const cleanGit = async (args: string[]): Promise<GitResult> =>
  args[0] === "rev-parse"
    ? { code: 0, stdout: "true\n", stderr: "" }
    : { code: 0, stdout: "", stderr: "" };

export interface UpdateSetup {
  deps: UpdateDeps;
  prompter: FakePrompter;
  errs: string[];
  outs: string[];
  err: () => string;
  out: () => string;
}

export function updateSetup(
  dir: string,
  script: Record<string, unknown[]> = {},
  over: Partial<UpdateDeps> = {},
  prompter: FakePrompter = new FakePrompter(script),
): UpdateSetup {
  const errs: string[] = [];
  const outs: string[] = [];
  const deps: UpdateDeps = {
    prompter,
    cwd: dir,
    interactive: false,
    stderr: (s) => errs.push(s),
    stdout: (s) => outs.push(s),
    checkTools: okTools,
    now: () => FIXED_NOW,
    runGit: cleanGit,
    ...over,
  };
  return {
    deps,
    prompter,
    errs,
    outs,
    err: () => errs.join(""),
    out: () => outs.join(""),
  };
}

export const read = (dir: string, rel: string): string =>
  readFileSync(path.join(dir, ...rel.split("/")), "utf8");

export const write = (dir: string, rel: string, text: string): void => {
  const full = path.join(dir, ...rel.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
};

export const exists = (dir: string, rel: string): boolean =>
  existsSync(path.join(dir, ...rel.split("/")));

export const sha = (buf: Buffer | string): string => createHash("sha256").update(buf).digest("hex");

export type ConfigDoc = Record<string, unknown> & {
  managed_files: Record<string, string>;
  answers: Record<string, unknown>;
  versions: { name: string; version: string; reason: string }[];
  accepted_warnings: { id: string }[];
  removed_files?: string[];
};

export const readConfig = (dir: string): ConfigDoc =>
  parse(read(dir, ".harness/config.yaml")) as ConfigDoc;

/** config.yaml を、一部だけ書き換える */
export function editConfig(dir: string, edit: (doc: ConfigDoc) => void): void {
  const doc = readConfig(dir);
  edit(doc);
  write(dir, ".harness/config.yaml", stringify(doc, { lineWidth: 0 }));
}

/** 古いハーネスが書いたファイルの状態を作る：中身を差し替え、記録の指紋もその中身に合わせる（利用者は書き換えていない） */
export function simulateOldVersion(dir: string, rel: string, oldText: string): void {
  write(dir, rel, oldText);
  editConfig(dir, (doc) => {
    doc.managed_files[rel] = fingerprint(oldText);
  });
}

/** 全ファイルのパス → 中身の sha256（"/" 区切り）。.git は除く */
export function snapshot(dir: string, filter: (rel: string) => boolean = () => true) {
  const out = new Map<string, string>();
  const walk = (current: string, prefix: string): void => {
    for (const name of readdirSync(current)) {
      if (name === ".git") continue;
      const full = path.join(current, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(full).isDirectory()) walk(full, rel);
      else if (filter(rel)) out.set(rel, sha(readFileSync(full)));
    }
  };
  walk(dir, "");
  return out;
}

/** 管理しないファイルだけ（.harness は除く） */
export const unmanagedSnapshot = (dir: string) =>
  snapshot(dir, (rel) => !isManagedPath(rel) && !rel.startsWith(".harness/"));
