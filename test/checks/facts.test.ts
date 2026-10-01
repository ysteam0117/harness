// 想定する型：src/checks/facts.ts（R2・R3・R7・2回目のレビュー）
//   export interface FactsDeps {
//     cwd: string;                                          // 生成先は path.join(cwd, app_name)
//     checkTools?: () => Promise<ToolStatus[]>;             // 既定は tools.ts の checkTools
//     isNonEmptyDir?: (dir: string) => Promise<boolean>;    // 既定は「存在し、中身がある」。#34 と共有する
//     versionsNewerThanVerified?: boolean;                  // #33 が渡す。既定は false
//   }
//   export async function collectFacts(answers: Partial<Answers>, deps: FactsDeps): Promise<Facts>;
//     - invalid_app_name：validateAppName(app_name) が問題を返した（app_name がない場合も）
//     - invalid_app_name が真なら、生成先を調べない（target_dir_not_empty は false。isNonEmptyDir を呼ばない）
//     - missing_tools：ok でない道具の説明（道具の名前を含む日本語の文字列）の配列
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectFacts } from "../../src/checks/facts.js";
import type { ToolStatus } from "../../src/checks/tools.js";
import { baseAnswers, cleanupTmp, makeTmp } from "../questions/helpers.js";

afterEach(cleanupTmp);

const okTools = async (): Promise<ToolStatus[]> => [
  { name: "node", state: "ok", version: "24.0.0" },
  { name: "git", state: "ok", version: "2.45.0" },
  { name: "docker", state: "ok", version: "27.0.1" },
];

describe("#32 AC-3: 事実の収集（facts.ts）", () => {
  it("#32 AC-3: 問題がなければ、すべて偽・空になる（versions_newer_than_verified は常に偽）", async () => {
    const { cwd } = makeTmp();
    const facts = await collectFacts(baseAnswers(), { cwd, checkTools: okTools });
    expect(facts.versions_newer_than_verified).toBe(false);
    expect(facts.invalid_app_name).toBe(false);
    expect(facts.target_dir_not_empty).toBe(false);
    expect(facts.missing_tools ?? []).toEqual([]);
  });

  it("#32 AC-3: #33 が渡す versions_newer_than_verified を、そのまま事実にする", async () => {
    const { cwd } = makeTmp();
    const facts = await collectFacts(baseAnswers(), {
      cwd,
      checkTools: okTools,
      versionsNewerThanVerified: true,
    });
    expect(facts.versions_newer_than_verified).toBe(true);
  });

  it("#32 AC-3: ok でない道具が、名前を含む説明として missing_tools に入る（ない・古い・確かめられない）", async () => {
    const { cwd } = makeTmp();
    const facts = await collectFacts(baseAnswers(), {
      cwd,
      checkTools: async () => [
        {
          name: "node",
          state: "outdated",
          version: "23.0.0",
          guide: "Node.js 24 以上を入れてください",
        },
        { name: "git", state: "ok", version: "2.45.0" },
        { name: "docker", state: "missing", guide: "Docker を入れてください" },
      ],
    });
    expect(facts.missing_tools).toHaveLength(2);
    expect(facts.missing_tools?.some((m) => m.includes("node"))).toBe(true);
    expect(facts.missing_tools?.some((m) => m.includes("docker"))).toBe(true);
    expect(facts.missing_tools?.some((m) => m.includes("git"))).toBe(false);

    const unknown = await collectFacts(baseAnswers(), {
      cwd,
      checkTools: async () => [{ name: "git", state: "unknown", detail: "permission denied" }],
    });
    expect(unknown.missing_tools).toHaveLength(1);
    expect(unknown.missing_tools?.[0]).toContain("git");
  });

  it("#32 AC-3: 生成先（cwd/app_name）が存在しない・空なら false、中身があれば true（実際のフォルダで確かめる）", async () => {
    const { cwd } = makeTmp();
    const deps = { cwd, checkTools: okTools };
    expect((await collectFacts(baseAnswers(), deps)).target_dir_not_empty).toBe(false);

    mkdirSync(path.join(cwd, "testapp-001"));
    expect((await collectFacts(baseAnswers(), deps)).target_dir_not_empty).toBe(false);

    writeFileSync(path.join(cwd, "testapp-001", "keep.txt"), "x");
    expect((await collectFacts(baseAnswers(), deps)).target_dir_not_empty).toBe(true);
  });

  it("#32 AC-3: 生成先はアプリ名から決め直される（app_name を変えると判定も変わる。R3）", async () => {
    const { cwd } = makeTmp();
    mkdirSync(path.join(cwd, "testapp-exists"));
    writeFileSync(path.join(cwd, "testapp-exists", "keep.txt"), "x");
    const deps = { cwd, checkTools: okTools };
    expect(
      (await collectFacts(baseAnswers({ app_name: "testapp-exists" }), deps)).target_dir_not_empty,
    ).toBe(true);
    expect(
      (await collectFacts(baseAnswers({ app_name: "testapp-001" }), deps)).target_dir_not_empty,
    ).toBe(false);
  });

  it("#32 AC-3: 有効なアプリ名なら、isNonEmptyDir に path.join(cwd, app_name) を渡す", async () => {
    const { cwd } = makeTmp();
    const isNonEmptyDir = vi.fn(async () => true);
    const facts = await collectFacts(baseAnswers(), { cwd, checkTools: okTools, isNonEmptyDir });
    expect(isNonEmptyDir).toHaveBeenCalledWith(path.join(cwd, "testapp-001"));
    expect(facts.target_dir_not_empty).toBe(true);
  });
});

describe("#32 AC-1: アプリ名が不正なとき（R2・2回目のレビュー）", () => {
  const bad = ["", "../x", "-abc", "abc-", "a\0b", "Bad_Name", "a/b"];
  for (const name of bad) {
    it(`#32 AC-1: 「${JSON.stringify(name)}」は invalid_app_name が真になり、生成先を調べない`, async () => {
      const { cwd } = makeTmp();
      const isNonEmptyDir = vi.fn(async () => true);
      const facts = await collectFacts(baseAnswers({ app_name: name }), {
        cwd,
        checkTools: okTools,
        isNonEmptyDir,
      });
      expect(facts.invalid_app_name).toBe(true);
      expect(facts.target_dir_not_empty).toBe(false);
      expect(isNonEmptyDir).not.toHaveBeenCalled();
    });
  }

  it("#32 AC-1: app_name がない回答でも、生成先を調べずに invalid_app_name が真になる", async () => {
    const { cwd } = makeTmp();
    const isNonEmptyDir = vi.fn(async () => true);
    const answers = baseAnswers();
    delete (answers as Record<string, unknown>).app_name;
    const facts = await collectFacts(answers, { cwd, checkTools: okTools, isNonEmptyDir });
    expect(facts.invalid_app_name).toBe(true);
    expect(isNonEmptyDir).not.toHaveBeenCalled();
  });
});
