import { readdir, stat } from "node:fs/promises";

/**
 * 生成先として「存在し、中身がある」か。存在しない・空のフォルダは false。
 * フォルダでないもの（同名のファイルなど）がある場合も、上書きできないので true。
 * 存在しない以外の失敗（権限など）は、もみ消さずに投げる。
 * 生成（#34）と同じ判定を使うため、ここに置く。
 */
export async function isNonEmptyDir(dir: string): Promise<boolean> {
  let info;
  try {
    info = await stat(dir);
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === "ENOENT") return false;
    throw e;
  }
  if (!info.isDirectory()) return true;
  return (await readdir(dir)).length > 0;
}
