import type { Stats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";

/** 更新のファイル操作の窓口。テストでは一部だけを差し替える（本物は node:fs/promises） */
export interface UpdateFs {
  mkdir(dir: string, opts?: { recursive: boolean }): Promise<unknown>;
  /** 文字列は UTF-8 で、バイト列はそのまま書く */
  writeFile(file: string, content: string | Uint8Array): Promise<void>;
  /** すでにあれば code: "EEXIST" で失敗する（ロックの作成に使う） */
  createExclusive(file: string, content: string): Promise<void>;
  readFile(file: string): Promise<Buffer>;
  /** 実行の権限を付ける（Windows では実質何も変わらない） */
  chmod(file: string, mode: number): Promise<void>;
  /** リンクをたどらない。なければ code: "ENOENT" で失敗する */
  lstat(p: string): Promise<Stats>;
  readdir(p: string): Promise<string[]>;
  /** 空でなければ失敗する操作（再帰の削除ではない） */
  rmdir(p: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** 一時的な場所・ロックを消す。なくても失敗しない */
  rm(p: string, opts: { recursive: true; force: true }): Promise<void>;
  realpath(p: string): Promise<string>;
}

export const realUpdateFs: UpdateFs = {
  mkdir: (dir, opts) => mkdir(dir, opts),
  writeFile: (file, content) =>
    typeof content === "string" ? writeFile(file, content, "utf8") : writeFile(file, content),
  createExclusive: (file, content) => writeFile(file, content, { encoding: "utf8", flag: "wx" }),
  readFile: (file) => readFile(file),
  chmod: (file, mode) => chmod(file, mode),
  lstat: (p) => lstat(p),
  readdir: (p) => readdir(p),
  rmdir: (p) => rmdir(p),
  rename: (from, to) => rename(from, to),
  rm: (p, opts) => rm(p, { ...opts, maxRetries: 5, retryDelay: 100 }),
  realpath: (p) => realpath(p),
};
