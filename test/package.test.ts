import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const libs = ["@clack/prompts", "commander", "yaml", "diff", "semver"];

describe("#30 AC-3: ライブラリのバージョンの固定", () => {
  it("#30 AC-3: dependencies と devDependencies のすべての値が x.y.z の形（範囲指定なし）", () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all).length).toBeGreaterThan(0);
    for (const [name, version] of Object.entries(all)) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("#30 AC-3: dependencies に5つのライブラリがある", () => {
    for (const lib of libs) {
      expect(Object.keys(pkg.dependencies), lib).toContain(lib);
    }
  });

  it("#30 AC-3: docs/tech-stack.md に5つのライブラリの名前と package.json と同じバージョンがある", () => {
    const doc = readFileSync(path.join(rootDir, "docs", "tech-stack.md"), "utf8");
    for (const lib of libs) {
      const version = pkg.dependencies[lib] as string;
      expect(doc, `${lib} の名前`).toContain(lib);
      expect(doc, `${lib} ${version}`).toContain(version);
    }
  });
});

describe("#34 AC-3: 配布物に、生成に使うものが入る", () => {
  const files = (
    JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")) as {
      files: string[];
    }
  ).files;

  it("#34 AC-3: package.json の files に、dist・templates・data・knowledge がある（知見は Skill に写すため配布物に入れる）", () => {
    for (const name of ["dist", "templates", "data", "knowledge"]) {
      expect(files, name).toContain(name);
    }
  });

  it("#34 AC-3: 生成に使うデータ（data/）がそろっている", () => {
    for (const file of [
      "template-values.yaml",
      "env-items.yaml",
      "role-models.yaml",
      "knowledge-selection.yaml",
      "runtimes.yaml",
      "profile-selection.yaml",
      "consistency-rules.yaml",
    ]) {
      const full = path.join(rootDir, "data", file);
      expect(() => readFileSync(full, "utf8"), file).not.toThrow();
    }
  });
});

describe("#35: 配布物に、変更履歴（status が読む）が入る", () => {
  it("#35 AC-5: package.json の files に CHANGELOG.md がある（ファイル自体は #36 で作る。無ければ status は「変更履歴がありません」と表示する）", () => {
    const files = (
      JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")) as { files: string[] }
    ).files;
    expect(files).toContain("CHANGELOG.md");
  });
});
