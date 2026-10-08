// #18 harness adopt：既存の技術の判定・記録・表示。架空のアプリ（test/fixtures/adopt-*/）を一時フォルダに写して実行する。
// 本物のネットワーク・gh・Docker は使わない。秘密らしいダミーの値は、実行時に連結して作る。
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { runAdopt, type AdoptDeps } from "../../src/commands/adopt.js";
import { runUpdate } from "../../src/commands/update.js";
import { realUpdateFs } from "../../src/update/fs.js";
import { dummySecret } from "../adopt/detect-helpers.js";
import { cleanScan } from "../adopt/secret-scan-helpers.js";
import { FakePrompter, baseAnswers } from "../questions/helpers.js";
import { FIXED_NOW } from "../versions/helpers.js";
import {
  cleanupRoots,
  editConfig,
  newRoot,
  readConfig,
  snapshot,
  updateSetup,
  write,
} from "../update/helpers.js";

afterEach(() => {
  cleanupRoots();
  vi.restoreAllMocks();
});

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/** 架空のアプリを、アプリ名と同じ名前のフォルダに写す */
function app(fixture: string): string {
  const dir = path.join(newRoot(), "sample-app");
  cpSync(path.join(FIXTURES, fixture), dir, { recursive: true });
  return dir;
}

function answersFile(over: Record<string, unknown> = {}): string {
  const file = path.join(newRoot(), "answers.yaml");
  const answers: Record<string, unknown> = { ...baseAnswers(over) };
  delete answers["app_name"];
  writeFileSync(file, stringify(answers));
  return file;
}

function setup(dir: string, over: Partial<AdoptDeps> = {}) {
  const errs: string[] = [];
  const outs: string[] = [];
  const reads: string[] = [];
  const deps: AdoptDeps = {
    prompter: new FakePrompter({}),
    cwd: dir,
    interactive: false,
    stderr: (s) => errs.push(s),
    stdout: (s) => outs.push(s),
    now: () => FIXED_NOW,
    secretScan: cleanScan,
    fs: {
      readFile: (p) => {
        reads.push(p.replace(/\\/g, "/"));
        return realUpdateFs.readFile(p);
      },
    },
    ...over,
  };
  return { deps, reads, err: () => errs.join(""), out: () => outs.join("") };
}

interface Recorded {
  detected_stack: {
    apps: { dir: string; items: { category: string; technology: string; evidence: string[] }[] }[];
    notes: { path: string; reason: string }[];
  };
  profiles: {
    applied: { profile: string; apps: string[] }[];
    none: { category: string; technology: string; apps: string[]; partial?: string[] }[];
  };
}
const recorded = (dir: string): Recorded => readConfig(dir) as unknown as Recorded;

describe("#18 adopt：TypeScript（Hono・React）", () => {
  it("--dry-run でも、技術の判定とプロファイルの一覧（当てる予定）を表示する。何も書かない", async () => {
    const dir = app("adopt-hono-react");
    write(dir, ".env", `DATABASE_URL=${dummySecret()}\n`);
    write(dir, ".env.local", `API_TOKEN=${dummySecret()}\n`);
    const before = snapshot(dir);
    const s = setup(dir);
    const out = await runAdopt({ answers: answersFile(), dryRun: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    const text = s.out();
    expect(text).toContain("### 技術の判定");
    expect(text).toContain("Hono");
    expect(text).toContain("backend/package.json");
    expect(text).toContain("### 技術プロファイル");
    expect(text).toContain("当てる予定（#18 の続きで入れる）");
    for (const key of [
      "backend-framework/hono",
      "logger/structured-logger",
      "frontend-build/vite-react-router",
      "test-framework/vitest-playwright",
      "quality/typescript-standard",
      "data-access/drizzle",
    ]) {
      expect(text, key).toContain(key);
    }
    expect(text).not.toContain("### プロファイルなし");
    expect(text).not.toContain(dummySecret());
    expect(snapshot(dir)).toEqual(before);
  });

  it(".env・.env.local は開かない（.env.example だけ開く）。値はどこにも出ない", async () => {
    const dir = app("adopt-hono-react");
    write(dir, ".env", `DATABASE_URL=${dummySecret()}\n`);
    write(dir, ".env.local", `API_TOKEN=${dummySecret()}\n`);
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode, s.err()).toBe(
      0,
    );
    const secretReads = s.reads.filter(
      (p) => /\/\.env(\.|$)/.test(p) && !p.endsWith("/.env.example"),
    );
    expect(secretReads).toEqual([]);
    expect(s.reads.some((p) => p.endsWith("/.env.example"))).toBe(true);
    const config = readFileSync(path.join(dir, ".harness", "config.yaml"), "utf8");
    expect(config).not.toContain(dummySecret());
    expect(s.out() + s.err()).not.toContain(dummySecret());
  });

  it("導入すると、config.yaml に detected_stack と profiles（applied・none）を記録する", async () => {
    const dir = app("adopt-hono-react");
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode, s.err()).toBe(
      0,
    );
    const config = recorded(dir);
    const backend = config.detected_stack.apps.find((a) => a.dir === "backend");
    expect(backend?.items).toContainEqual({
      category: "backend",
      technology: "Hono",
      evidence: ["backend/package.json"],
    });
    expect(config.profiles.applied.map((a) => a.profile)).toEqual([
      "backend-framework/hono",
      "data-access/drizzle",
      "frontend-build/vite-react-router",
      "logger/structured-logger",
      "quality/typescript-standard",
      "test-framework/vitest-playwright",
    ]);
    expect(
      config.profiles.applied.find((a) => a.profile === "frontend-build/vite-react-router")?.apps,
    ).toEqual(["frontend"]);
    expect(config.profiles.none).toEqual([]);
  });

  it("update の後も、detected_stack・profiles が残る", async () => {
    const dir = app("adopt-hono-react");
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode, s.err()).toBe(
      0,
    );
    const before = recorded(dir);
    const u = updateSetup(dir);
    expect((await runUpdate({ yes: true }, u.deps)).exitCode, u.err()).toBe(0);
    const after = recorded(dir);
    expect(after.detected_stack).toEqual(before.detected_stack);
    expect(after.profiles).toEqual(before.profiles);
    expect(readConfig(dir)["mode"]).toBe("adopt");
  });
});

describe("#18 古い config（detected_stack・profiles が無い）でも update が動く", () => {
  it("記録が無いままで、update は成功し、記録を作らない", async () => {
    const dir = app("adopt-hono-react");
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode, s.err()).toBe(
      0,
    );
    editConfig(dir, (doc) => {
      delete doc["detected_stack"];
      delete doc["profiles"];
    });
    const u = updateSetup(dir);
    expect((await runUpdate({ yes: true }, u.deps)).exitCode, u.err()).toBe(0);
    expect(readConfig(dir)["detected_stack"]).toBeUndefined();
    expect(readConfig(dir)["profiles"]).toBeUndefined();
    expect(readConfig(dir)["mode"]).toBe("adopt");
  });
});

describe("#18 adopt：技術プロファイルのない既存のアプリ", () => {
  it("Python：言語だけを判定し、applied は空で、プロファイルなし（Python）と改善の提案を表示する", async () => {
    const dir = app("adopt-django");
    const s = setup(dir);
    const out = await runAdopt({ answers: answersFile(), dryRun: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    const text = s.out();
    expect(text).toContain("### プロファイルなし");
    expect(text).toContain("プロファイルなし（Python）");
    expect(text).toContain(
      "Python の技術プロファイルを作る提案：ハーネスのリポジトリに Issue を作ってください",
    );
    expect(text).not.toContain("Django");
    expect(text).not.toContain("pytest");
    expect(text).not.toContain("当てる予定");
  });

  it("Go：Go 1.23 と判定し、applied は空", async () => {
    const dir = app("adopt-go");
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode, s.err()).toBe(
      0,
    );
    const config = recorded(dir);
    expect(config.profiles.applied).toEqual([]);
    expect(JSON.stringify(config.detected_stack)).toContain("1.23");
    expect(s.out()).toContain("Go");
    expect(s.out()).toContain("1.23");
    expect(s.out()).toContain("Go の技術プロファイルを作る提案");
  });

  it("Hono のバックエンド＋Vue・vite のフロント：Hono は applied、フロントは「プロファイルなし（一部一致：vite）」", async () => {
    const dir = app("adopt-mixed");
    const s = setup(dir);
    expect((await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode, s.err()).toBe(
      0,
    );
    const config = recorded(dir);
    expect(config.profiles.applied.map((a) => a.profile)).toContain("backend-framework/hono");
    expect(config.profiles.none).toEqual([
      { category: "frontend", technology: "Vite・Vue", apps: ["frontend"], partial: ["vite"] },
    ]);
    expect(s.out()).toContain("プロファイルなし（一部一致：vite）");
  });

  it("出力のファイルは、判定の結果によらず同じ（技術のないアプリと比べて）", async () => {
    const files = async (fixture: string) => {
      const dir = app(fixture);
      const s = setup(dir);
      expect(
        (await runAdopt({ answers: answersFile(), yes: true }, s.deps)).exitCode,
        s.err(),
      ).toBe(0);
      const snap = snapshot(dir, (rel) => rel.startsWith(".claude/") || rel === "CLAUDE.md");
      return snap;
    };
    const react = await files("adopt-hono-react");
    const django = await files("adopt-django");
    const go = await files("adopt-go");
    expect([...django.entries()]).toEqual([...react.entries()]);
    expect([...go.entries()]).toEqual([...react.entries()]);
  });
});
