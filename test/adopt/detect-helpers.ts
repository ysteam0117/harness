// #18 技術の判定のテストの道具。偽の fs（メモリ上）で、読んだパスを記録し、シンボリックリンク・ジャンクションを再現する。
// シンボリックリンクを作れない環境（Windows の権限がない CI など）でも、リンクの扱いを確かめられる。
// 実在の個人名・実データは使わない（架空の値だけ）。
import type { Stats } from "node:fs";
import type { DetectFs } from "../../src/adopt/detect.js";

export type MemEntry = string | { dir: true } | { link: string; size?: number };

export interface MemFs extends DetectFs {
  /** readFile で読んだパス（/ 区切り・ドライブ名なし） */
  reads: string[];
  /** readdir で開いたパス */
  lists: string[];
}

const norm = (p: string): string => {
  const slashed = p.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
  const parts: string[] = [];
  for (const part of slashed.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return "/" + parts.join("/");
};

const err = (code: string, p: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: ${p}`), { code });

const isLinkEntry = (e: MemEntry): e is { link: string; size?: number } =>
  typeof e === "object" && "link" in e;
const isDirEntry = (e: MemEntry): boolean => typeof e === "object" && "dir" in e;

/** entries のキーは /proj/... の絶対パス。文字列は通常のファイル、{dir:true} はフォルダ、{link} はリンク（先のパス） */
export function memFs(entries: Record<string, MemEntry>): MemFs {
  const table = new Map<string, MemEntry>();
  for (const [k, v] of Object.entries(entries)) {
    const key = norm(k);
    table.set(key, v);
    // 親のフォルダを補う
    const parts = key.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const parent = "/" + parts.slice(0, i).join("/");
      if (!table.has(parent)) table.set(parent, { dir: true });
    }
  }
  table.set("/", { dir: true });

  /** リンクをたどって本当のパスにする（なければ ENOENT） */
  const resolve = (p: string, depth = 0): string => {
    if (depth > 20) throw err("ELOOP", p);
    const parts = norm(p).split("/").filter(Boolean);
    let current = "";
    for (const [i, part] of parts.entries()) {
      current = `${current}/${part}`;
      const entry = table.get(current);
      if (entry === undefined) throw err("ENOENT", p);
      if (isLinkEntry(entry)) {
        const rest = parts.slice(i + 1).join("/");
        return resolve(rest === "" ? entry.link : `${entry.link}/${rest}`, depth + 1);
      }
    }
    return current === "" ? "/" : current;
  };

  const stats = (entry: MemEntry): Stats => {
    const size =
      typeof entry === "string"
        ? Buffer.byteLength(entry)
        : isLinkEntry(entry)
          ? (entry.size ?? 0)
          : 0;
    return {
      isSymbolicLink: () => isLinkEntry(entry),
      isDirectory: () => isDirEntry(entry),
      isFile: () => typeof entry === "string",
      size,
    } as unknown as Stats;
  };

  const fs: MemFs = {
    reads: [],
    lists: [],
    lstat: (p) => {
      // 本物の lstat と同じく、最後の部分はリンクのまま、途中のリンクはたどる
      const key = norm(p);
      const cut = key.lastIndexOf("/");
      try {
        const parent = cut <= 0 ? "/" : resolve(key.slice(0, cut));
        const real = `${parent === "/" ? "" : parent}/${key.slice(cut + 1)}`;
        const entry = key === "/" ? table.get("/") : table.get(real);
        if (entry === undefined) return Promise.reject(err("ENOENT", p));
        return Promise.resolve(stats(entry));
      } catch (e) {
        return Promise.reject(e as Error);
      }
    },
    realpath: (p) => {
      try {
        return Promise.resolve(resolve(p));
      } catch (e) {
        return Promise.reject(e as Error);
      }
    },
    readFile: (p) => {
      fs.reads.push(norm(p));
      try {
        const entry = table.get(resolve(p));
        if (typeof entry !== "string") return Promise.reject(err("EISDIR", p));
        return Promise.resolve(Buffer.from(entry, "utf8"));
      } catch (e) {
        return Promise.reject(e as Error);
      }
    },
    readdir: (p) => {
      fs.lists.push(norm(p));
      try {
        const real = resolve(p);
        const entry = table.get(real);
        if (entry === undefined || !isDirEntry(entry)) return Promise.reject(err("ENOTDIR", p));
        const prefix = real === "/" ? "/" : `${real}/`;
        const names = new Set<string>();
        for (const key of table.keys()) {
          if (key !== real && key.startsWith(prefix)) {
            names.add(key.slice(prefix.length).split("/")[0] as string);
          }
        }
        return Promise.resolve([...names]);
      } catch (e) {
        return Promise.reject(e as Error);
      }
    },
  };
  return fs;
}

/** 秘密らしいダミーの値は、実行時に連結して作る（ソースに直接書かない） */
export function dummySecret(): string {
  return ["dummy", "secret", "value", "0123"].join("-");
}

export const pkg = (
  deps: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): string => JSON.stringify({ name: "sample", ...extra, dependencies: deps });
