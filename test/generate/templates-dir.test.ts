// 想定する型（実装は src/generate/templates-dir.ts をこれに合わせる）
//
//   export function findTemplatesDir(): string;
//        // templates/ の絶対パス（URL ではなくファイルのパス）を返す。
//        // new URL("../../templates/", import.meta.url) で探す：src/generate/ からも dist/generate/ からも、
//        // 直下の templates/ に届く。作業中のフォルダ（process.cwd()）には依存しない。
//        // なければ GenerateError。
//        // import するのは node の標準モジュールと ./errors.js だけにする（配布物の再現テストのため）
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { afterAll, describe, expect, it, vi } from "vitest";
import { GenerateError } from "../../src/generate/errors.js";
import { findTemplatesDir } from "../../src/generate/templates-dir.js";
import { cleanupTemplates, realTemplatesDir } from "./helpers.js";

const repoRoot = path.resolve(realTemplatesDir, "..");
const tmpRoots: string[] = [];

afterAll(() => {
  vi.restoreAllMocks();
  cleanupTemplates();
  for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** src/generate の指定のファイルを JS にして、tmp/dist/generate/ に置く（配布物の形を再現する） */
function buildDistLike(withTemplates: boolean): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-test-dist-"));
  tmpRoots.push(root);
  const outDir = path.join(root, "dist", "generate");
  mkdirSync(outDir, { recursive: true });
  for (const name of ["templates-dir", "errors"]) {
    const source = readFileSync(path.join(repoRoot, "src", "generate", `${name}.ts`), "utf8");
    const js = ts.transpileModule(source, {
      fileName: `${name}.mts`,
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext },
    }).outputText;
    // 書き出した JS の中の .ts への import は、ビルドと同じく .js にそろっている前提
    writeFileSync(path.join(outDir, `${name}.js`), js, "utf8");
  }
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n', "utf8");
  if (withTemplates) {
    mkdirSync(path.join(root, "templates"), { recursive: true });
    writeFileSync(path.join(root, "templates", "AGENTS.md"), "# 架空\n", "utf8");
  }
  return root;
}

describe("#31 AC-3: templates の場所の解決", () => {
  it("#31 AC-3: 開発時（src）に、リポジトリ直下の templates/ が見つかる", () => {
    const found = findTemplatesDir();
    expect(path.isAbsolute(found)).toBe(true);
    expect(path.resolve(found)).toBe(path.resolve(realTemplatesDir));
  });

  it("#31 AC-3: 作業中のフォルダを変えても見つかる", () => {
    const elsewhere = mkdtempSync(path.join(os.tmpdir(), "harness-test-cwd-"));
    tmpRoots.push(elsewhere);
    vi.spyOn(process, "cwd").mockReturnValue(elsewhere);
    expect(path.resolve(findTemplatesDir())).toBe(path.resolve(realTemplatesDir));
  });

  it("#31 AC-3: 組み立て後（dist/generate）の形でも、dist の隣の templates/ が見つかる", async () => {
    const root = buildDistLike(true);
    const mod = (await import(
      pathToFileURL(path.join(root, "dist", "generate", "templates-dir.js")).href
    )) as { findTemplatesDir: () => string };
    expect(path.resolve(mod.findTemplatesDir())).toBe(path.join(root, "templates"));
  });

  it("#31 AC-3: templates/ がなければ GenerateError にする", async () => {
    const root = buildDistLike(false);
    const mod = (await import(
      pathToFileURL(path.join(root, "dist", "generate", "templates-dir.js")).href
    )) as { findTemplatesDir: () => string };
    expect(() => mod.findTemplatesDir()).toThrowError(
      expect.objectContaining({ name: GenerateError.name }),
    );
  });
});
