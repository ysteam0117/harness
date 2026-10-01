import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GenerateError } from "./errors.js";

/**
 * templates/ の絶対パスを返す。
 * src/generate/ からも dist/generate/ からも、2つ上の templates/ に届く。作業中のフォルダには依存しない。
 */
export function findTemplatesDir(): string {
  const dir = path.resolve(fileURLToPath(new URL("../../templates/", import.meta.url)));
  let isDir: boolean;
  try {
    isDir = statSync(dir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    throw new GenerateError(`ひな形のフォルダ（templates/）が見つかりません：${dir}`);
  }
  return dir;
}
