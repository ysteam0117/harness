import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines: { node: string };
  scripts: Record<string, string>;
};
const libs = ["@clack/prompts", "commander", "yaml", "diff", "semver"];

describe("#30 AC-3: ライブラリのバージョンの固定", () => {
  it("Node.js の最低対応版は脆弱性修正版の 24.22.1", () => {
    expect(pkg.engines.node).toBe(">=24.22.1");
  });

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

describe("C-61 #74: 手元の確認と CI が、同じ1つのコマンド", () => {
  const PARTS = ["check", "test:smoke", "pack:check"];

  it("C-61 #74 AC-1: check:all は、check・test:smoke・pack:check を、この順に実行する", () => {
    expect(pkg.scripts["check:all"]).toBe(PARTS.map((name) => `npm run ${name}`).join(" && "));
  });

  it("C-61 #74 AC-3: check・test:smoke・pack:check は、単独のコマンドとしても残っている", () => {
    for (const name of PARTS) {
      expect(pkg.scripts[name], name).toBeTypeOf("string");
    }
    // check が check:all を呼ぶと、呼び出しが循環する
    expect(pkg.scripts["check"]).not.toContain("check:all");
  });

  it("C-61 #74 AC-2: ci.yml が実行するのは、npm ci と npm run check:all だけ（手元と違う手順を持たない）", () => {
    const workflow = parse(
      readFileSync(path.join(rootDir, ".github", "workflows", "ci.yml"), "utf8"),
    ) as { jobs: Record<string, { steps: { run?: string }[] }> };
    const jobs = Object.values(workflow.jobs);
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      const commands = job.steps.flatMap((step) => (step.run === undefined ? [] : [step.run]));
      expect(commands).toEqual(["npm ci", "npm run check:all"]);
    }
  });
});
