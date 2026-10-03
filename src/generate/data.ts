import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { GenerateError } from "./errors.js";

/** data/（ルールや値のデータ）のフォルダ。src/generate/ からも dist/generate/ からも、2つ上の data/ に届く */
export function dataPath(name: string): string {
  return fileURLToPath(new URL(`../../data/${name}`, import.meta.url));
}

/** data/<name> を YAML として読む。読めない・YAML として誤っているときは GenerateError（日本語） */
export function readDataYaml(name: string): unknown {
  const file = dataPath(name);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new GenerateError(`data/${name} を読めません：${file}（${(e as Error).message}）`, {
      cause: e,
    });
  }
  try {
    return parseYaml(text);
  } catch (e) {
    throw new GenerateError(`data/${name} を YAML として読めません：${(e as Error).message}`, {
      cause: e,
    });
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
