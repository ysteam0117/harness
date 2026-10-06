import { createHash } from "node:crypto";
import path from "node:path";
import { GenerateError } from "../generate/errors.js";
import { checkRelative } from "../generate/write.js";
import type { UpdateFs } from "./fs.js";

/** ファイルの今の状態。sha は、改行をそろえない生のバイト列の sha256（判定の後の変化を確かめるのに使う） */
export type FileSnapshot = { kind: "absent" } | { kind: "file"; text: string; sha: string };

/** 生のバイト列の sha256（改行をそろえない） */
export function rawSha(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function codeOf(e: unknown): string | undefined {
  return typeof e === "object" && e !== null ? (e as NodeJS.ErrnoException).code : undefined;
}

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 生成先の中の相対パスが、リンク（シンボリックリンク・ジャンクション）をたどらないかを確かめる。
 * 途中のフォルダ・ファイル自身がリンクなら GenerateError。まだ無い部分は確かめない。
 * ファイルのはずの場所がフォルダのときも GenerateError。
 */
export async function assertNoLinks(fs: UpdateFs, root: string, rel: string): Promise<void> {
  checkRelative(rel);
  const parts = rel.split("/");
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (e) {
      if (codeOf(e) === "ENOENT") return;
      throw new GenerateError(`${rel} を確かめられません（${messageOf(e)}）`, { cause: e });
    }
    if (stat.isSymbolicLink()) {
      throw new GenerateError(
        `${rel} の途中がリンク（シンボリックリンク・ジャンクション）のため、扱いません：${part}（リンクの先には書きません）`,
      );
    }
    const last = index === parts.length - 1;
    if (last && !stat.isFile()) {
      throw new GenerateError(`${rel} が、ファイルではありません（フォルダなど）`);
    }
    if (!last && !stat.isDirectory()) {
      throw new GenerateError(`${rel} の途中の ${part} が、フォルダではありません`);
    }
  }
}

/** 生成先の中のファイルを読む（リンクは拒む）。無ければ absent */
export async function readState(fs: UpdateFs, root: string, rel: string): Promise<FileSnapshot> {
  await assertNoLinks(fs, root, rel);
  const full = path.join(root, ...rel.split("/"));
  let buf: Buffer;
  try {
    buf = await fs.readFile(full);
  } catch (e) {
    if (codeOf(e) === "ENOENT") return { kind: "absent" };
    throw new GenerateError(`${rel} を読めません（${messageOf(e)}）`, { cause: e });
  }
  return { kind: "file", text: buf.toString("utf8"), sha: rawSha(buf) };
}
