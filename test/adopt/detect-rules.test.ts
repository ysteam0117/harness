// #18 判定のルール（data/adopt-detection.yaml）の整合。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadDetectionRules } from "../../src/adopt/detect.js";
import { findTemplatesDir } from "../../src/generate/templates-dir.js";

describe("判定のルール", () => {
  const rules = loadDetectionRules();
  const profileFile = (key: string): string => {
    const [category, id] = key.split("/");
    return path.join(findTemplatesDir(), "profiles", category ?? "", id ?? "", "profile.yaml");
  };

  it("当てるプロファイルは、templates/profiles にある", () => {
    expect(rules.profiles.length).toBeGreaterThan(0);
    for (const rule of rules.profiles) {
      expect(existsSync(profileFile(rule.profile)), rule.profile).toBe(true);
    }
  });

  it("requires は、profile.yaml から読む（Hono は共通ロガーを求める）", () => {
    const hono = rules.profiles.find((r) => r.profile === "backend-framework/hono");
    expect(hono?.requires).toEqual(["logger/structured-logger"]);
    const raw = parse(readFileSync(profileFile("backend-framework/hono"), "utf8")) as {
      requires: string[];
    };
    expect(raw.requires).toEqual(hono?.requires);
  });

  it("手がかりを持たないプロファイルは requires_only の印がある", () => {
    for (const rule of rules.profiles) {
      if (rule.needs.length === 0) expect(rule.requiresOnly, rule.profile).toBe(true);
    }
  });

  it("必須の手がかりの対応（計画どおり）", () => {
    const need = (key: string) => rules.profiles.find((r) => r.profile === key)?.needs;
    expect(need("backend-framework/hono")).toEqual([["hono"]]);
    expect(need("frontend-build/vite-react-router")).toEqual([
      ["vite"],
      ["react-router", "react-router-dom"],
    ]);
    expect(need("test-framework/vitest-playwright")).toEqual([["vitest"]]);
    expect(need("quality/typescript-standard")).toEqual([["typescript"]]);
    expect(need("data-access/drizzle")).toEqual([["drizzle-orm"]]);
  });
});
