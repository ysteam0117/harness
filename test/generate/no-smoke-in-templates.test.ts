// smoke（ハーネス自身の確認）は、生成・導入するプロジェクトに入れない（利用者の方針。CLAUDE.md）
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates");

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? allFiles(full) : [full];
  });
}

describe("smoke はハーネス自身だけのもの", () => {
  it("ひな形（templates/）に、smoke のワークフロー・スクリプト・コマンドが無い", () => {
    const found = allFiles(templatesDir).filter((file) => {
      const rel = path.relative(templatesDir, file);
      return (
        /smoke/i.test(rel) ||
        /smoke-generated|smoke\.yml|test:smoke|smoke:generated/.test(readFileSync(file, "utf8"))
      );
    });
    expect(found.map((f) => path.relative(templatesDir, f))).toEqual([]);
  });
});
