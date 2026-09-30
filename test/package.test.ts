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
