// #18 config.yaml への記録（detected_stack・profiles）と、読み戻し。古い記録（無い）でも動く。
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  detectedStackEntry,
  profilesEntry,
  readDetectedStack,
  readProfiles,
} from "../../src/adopt/record.js";
import { buildConfigText, toUpdateConfigText } from "../../src/generate/config.js";
import { judge } from "../../src/generate/judgment.js";
import { rolesFor } from "../../src/generate/roles.js";
import { parseConfig } from "../../src/update/read-config.js";
import { baseAnswers } from "../questions/helpers.js";
import { FIXED_NOW } from "../versions/helpers.js";
import type { Answers } from "../../src/questions/answers.js";

const stack = {
  apps: [
    {
      dir: "backend",
      app: true,
      packages: ["hono"],
      items: [
        { class: "backend" as const, technology: "Hono", evidence: ["backend/package.json"] },
        { class: "language" as const, technology: "Go", version: "1.23", evidence: ["go.mod"] },
      ],
    },
    { dir: "empty", app: false, packages: [], items: [] },
  ],
  notes: [{ path: "package.json", reason: "リンクのため読まない" }],
};
const match = {
  applied: [{ profile: "backend-framework/hono", apps: ["backend"] }],
  none: [
    { category: "frontend" as const, technology: "Vue", apps: ["frontend"], partial: ["vite"] },
  ],
};

function config(extra: object = {}): string {
  const answers = baseAnswers() as unknown as Answers;
  return buildConfigText({
    answers,
    acceptedWarnings: [],
    judgment: judge(answers),
    versions: { entries: [], newerThanVerified: false },
    roles: rolesFor(answers.ais),
    managed: [],
    now: FIXED_NOW,
    mode: "adopt",
    ...extra,
  });
}

describe("detected_stack・profiles の記録", () => {
  it("分類・技術・版・根拠だけを書く（依存の名前の一覧は書かない。項目のないフォルダは省く）", () => {
    expect(detectedStackEntry(stack)).toEqual({
      apps: [
        {
          dir: "backend",
          items: [
            { category: "backend", technology: "Hono", evidence: ["backend/package.json"] },
            { category: "language", technology: "Go", version: "1.23", evidence: ["go.mod"] },
          ],
        },
      ],
      notes: [{ path: "package.json", reason: "リンクのため読まない" }],
    });
    expect(profilesEntry(match)).toEqual({
      applied: [{ profile: "backend-framework/hono", apps: ["backend"] }],
      none: [{ category: "frontend", technology: "Vue", apps: ["frontend"], partial: ["vite"] }],
    });
  });

  it("buildConfigText が書き、parseConfig が読み戻す", () => {
    const text = config({ detectedStack: stack, profiles: match });
    const doc = parse(text) as Record<string, unknown>;
    expect(doc["detected_stack"]).toEqual(detectedStackEntry(stack));
    expect(doc["profiles"]).toEqual(profilesEntry(match));
    const read = parseConfig(text);
    expect(read.detectedStack).toEqual(detectedStackEntry(stack));
    expect(read.profiles).toEqual(match);
  });

  it("記録が無い古い config でも読める（無ければ undefined）", () => {
    const text = config();
    expect(text).not.toContain("detected_stack");
    expect(text).not.toContain("profiles:");
    const read = parseConfig(text);
    expect(read.detectedStack).toBeUndefined();
    expect(read.profiles).toBeUndefined();
  });

  it("形が誤っていても、更新は止めない（読めないものは無いものとして扱う）", () => {
    expect(readDetectedStack({ apps: "x" })).toBeUndefined();
    expect(readDetectedStack(["a"])).toBeUndefined();
    expect(readProfiles({ applied: [{ profile: 1 }], none: [] })).toBeUndefined();
    expect(readProfiles("x")).toBeUndefined();
    const doc = parse(config()) as Record<string, unknown>;
    doc["detected_stack"] = "壊れた記録";
    doc["profiles"] = 5;
    const read = parseConfig(JSON.stringify(doc));
    expect(read.detectedStack).toBeUndefined();
    expect(read.profiles).toBeUndefined();
  });

  it("toUpdateConfigText は、渡された記録を引き継ぐ", () => {
    const created = config();
    const text = toUpdateConfigText(created, {
      generatedOn: "2026-10-01",
      updatedOn: "2026-10-08",
      managedFiles: {},
      removedFiles: [],
      mode: "adopt",
      detectedStack: detectedStackEntry(stack),
      profiles: match,
    });
    const doc = parse(text) as Record<string, unknown>;
    expect(doc["detected_stack"]).toEqual(detectedStackEntry(stack));
    expect(doc["profiles"]).toEqual(profilesEntry(match));
    const without = parse(
      toUpdateConfigText(created, {
        generatedOn: "2026-10-01",
        updatedOn: "2026-10-08",
        managedFiles: {},
        removedFiles: [],
      }),
    ) as Record<string, unknown>;
    expect("detected_stack" in without).toBe(false);
    expect("profiles" in without).toBe(false);
  });
});
