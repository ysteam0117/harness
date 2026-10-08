// #21 導入したアプリの harness update：基準線の確認のスクリプトは置き換え、baseline.json（導入先のもの）には触れない。
// 架空の既存のアプリ（test/fixtures/adopt-sample/）に harness adopt を実行して試す。実データ・個人名は使わない。
import { cpSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { BASELINE_SCRIPT_PATH } from "../../src/adopt/ci.js";
import type { AdoptDeps } from "../../src/commands/adopt.js";
import { runUpdate } from "../../src/commands/update.js";
import { fingerprint } from "../../src/generate/config.js";
import { runAdopt } from "../adopt/git-helpers.js";
import { cleanScan } from "../adopt/secret-scan-helpers.js";
import { FakePrompter, baseAnswers } from "../questions/helpers.js";
import { FIXED_NOW } from "../versions/helpers.js";
import {
  cleanupRoots,
  editConfig,
  exists,
  newRoot,
  read,
  readConfig,
  updateSetup,
  write,
} from "../update/helpers.js";

afterEach(() => {
  cleanupRoots();
  vi.restoreAllMocks();
});

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "adopt-sample",
);
const BASELINE_JSON = ".harness/baseline.json";
const OLD_SCRIPT = "// 古い baseline-check（テスト）\n";

async function adoptedApp(): Promise<string> {
  const dir = path.join(newRoot(), "sample-app");
  cpSync(FIXTURE, dir, { recursive: true });
  const answers: Record<string, unknown> = baseAnswers();
  delete answers["app_name"];
  const file = path.join(newRoot(), "answers.yaml");
  writeFileSync(file, stringify(answers));
  const deps: AdoptDeps = {
    prompter: new FakePrompter(),
    cwd: dir,
    interactive: false,
    stderr: () => undefined,
    stdout: () => undefined,
    now: () => FIXED_NOW,
    secretScan: cleanScan,
  };
  const out = await runAdopt({ answers: file, yes: true }, deps);
  if (out.exitCode !== 0) throw new Error("導入に失敗しました");
  return dir;
}

describe("#21 update：基準線の確認のスクリプト", () => {
  it("adopt がスクリプトを置き、記録（managed_files）に入る。baseline.json は作らない・記録しない", async () => {
    const dir = await adoptedApp();
    expect(exists(dir, BASELINE_SCRIPT_PATH)).toBe(true);
    expect(exists(dir, BASELINE_JSON)).toBe(false);
    const managed = readConfig(dir).managed_files;
    expect(Object.keys(managed)).toContain(BASELINE_SCRIPT_PATH);
    expect(Object.keys(managed)).not.toContain(BASELINE_JSON);
  });

  it("古いスクリプト（利用者は書き換えていない）は新しい内容に置き換わる。baseline.json はそのまま", async () => {
    const dir = await adoptedApp();
    write(dir, BASELINE_SCRIPT_PATH, OLD_SCRIPT);
    editConfig(dir, (doc) => {
      doc.managed_files[BASELINE_SCRIPT_PATH] = fingerprint(OLD_SCRIPT);
    });
    const recorded = '{ "version": 1, "apps": {} }\n';
    write(dir, BASELINE_JSON, recorded);
    const s = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
    expect(read(dir, BASELINE_SCRIPT_PATH)).not.toBe(OLD_SCRIPT);
    expect(read(dir, BASELINE_SCRIPT_PATH)).toContain("export function compare");
    expect(read(dir, BASELINE_JSON)).toBe(recorded);
    expect(Object.keys(readConfig(dir).managed_files)).not.toContain(BASELINE_JSON);
  });

  it("baseline.json が無くても、update は作らない", async () => {
    const dir = await adoptedApp();
    const s = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
    expect(exists(dir, BASELINE_JSON)).toBe(false);
  });

  it("利用者がスクリプトを消した：消したまま（記録は removed_files）", async () => {
    const dir = await adoptedApp();
    rmSync(path.join(dir, ...BASELINE_SCRIPT_PATH.split("/")));
    const s = updateSetup(dir);
    expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
    expect(exists(dir, BASELINE_SCRIPT_PATH)).toBe(false);
    expect(readConfig(dir).removed_files).toContain(BASELINE_SCRIPT_PATH);
  });
});
