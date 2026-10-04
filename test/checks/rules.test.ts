// 想定する型：src/checks/rules.ts・data/consistency-rules.yaml
//   export type Level = "error" | "warning" | "info";
//   export interface Facts {                          // 回答以外の事実（facts.ts が集める）
//     versions_newer_than_verified?: boolean;         // #33 が渡す。#32 では常に偽
//     missing_tools?: string[];                       // 足りない・古い・確かめられない道具の説明（空なら偽）
//     target_dir_not_empty?: boolean;
//     invalid_app_name?: boolean;
//   }
//   export interface Rule { id: string; level: Level; message: string; reason: string; fix: string[]; when: unknown }
//   export interface RuleHit { id: string; level: Level; message: string; reason: string; fix: string[] }
//   export interface CheckResult { errors: RuleHit[]; warnings: RuleHit[]; infos: RuleHit[] }
//   export class RulesError extends Error { errors: string[] }
//   export function parseRules(yamlText: string, definitions?: readonly QuestionDefinition[]): Rule[];     // 形を検証する。知らない level・質問の id・fact、必須項目の欠け、id の重複は RulesError
//   export function loadRules(): Rule[];                       // data/consistency-rules.yaml を読む（new URL("../../data/", import.meta.url)）
//   export function evaluateRules(rules: Rule[], answers: Partial<Answers>, facts: Facts): CheckResult;   // ルールの並びの順
//
// ルールの id（この Issue で決める）：
//   1 auth-needs-db / 2 upload-needs-db / 3 upload-without-auth / 4 team-needs-ci / 5 public-needs-ci /
//   6 postgresql-needs-service / 7 version-newer-than-verified / 8 missing-tools / 9 invalid-app-name / 10 target-dir-not-empty
import { describe, expect, it } from "vitest";
import {
  RulesError,
  evaluateRules,
  loadRules,
  parseRules,
  type Facts,
} from "../../src/checks/rules.js";
import { baseAnswers } from "../questions/helpers.js";

const NO_FACTS: Facts = {
  versions_newer_than_verified: false,
  missing_tools: [],
  target_dir_not_empty: false,
  invalid_app_name: false,
};

const rules = loadRules();
const hitIds = (answers: Record<string, unknown>, facts: Facts = NO_FACTS) => {
  const r = evaluateRules(rules, baseAnswers(answers), facts);
  return [...r.errors, ...r.warnings, ...r.infos].map((h) => h.id);
};

describe("#32 AC-3: ルールのデータ（data/consistency-rules.yaml）", () => {
  it("#32 AC-3: F-08 のルールが、表の順に読み込める", () => {
    expect(rules.map((r) => r.id)).toEqual([
      "auth-needs-db",
      "upload-needs-db",
      "upload-without-auth",
      "team-needs-ci",
      "public-needs-ci",
      "team-without-remote",
      "postgresql-needs-service",
      "version-newer-than-verified",
      "missing-tools",
      "invalid-app-name",
      "target-dir-not-empty",
    ]);
  });

  it("#32 AC-3: 段階が F-08 の表のとおり（エラー・警告・情報）", () => {
    const level = (id: string) => rules.find((r) => r.id === id)?.level;
    expect(level("auth-needs-db")).toBe("error");
    expect(level("upload-needs-db")).toBe("error");
    expect(level("upload-without-auth")).toBe("warning");
    expect(level("team-needs-ci")).toBe("warning");
    expect(level("public-needs-ci")).toBe("warning");
    expect(level("postgresql-needs-service")).toBe("info");
    expect(level("version-newer-than-verified")).toBe("warning");
    expect(level("missing-tools")).toBe("warning");
    expect(level("invalid-app-name")).toBe("error");
    expect(level("target-dir-not-empty")).toBe("error");
  });

  it("#32 AC-3: すべてに日本語のメッセージと理由がある", () => {
    for (const r of rules) {
      expect(r.message).toMatch(/[ぁ-んァ-ヶ一-龠]/);
      expect(r.reason).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    }
    expect(rules[0]?.message).toContain(
      "認証が「アプリ独自認証」または「併用」で、DBが「なし」です",
    );
  });

  it("#32 AC-3: fix は、ルール7・8 以外のすべてに付き、知っている質問の id だけを指す（R3）", async () => {
    const { questionDefinitions } = await import("../../src/questions/definitions.js");
    const ids = new Set(questionDefinitions.map((d) => d.id));
    for (const r of rules) {
      if (r.id === "version-newer-than-verified" || r.id === "missing-tools") {
        expect(r.fix).toEqual([]);
      } else {
        expect(r.fix.length).toBeGreaterThan(0);
      }
      for (const q of r.fix) expect(ids.has(q)).toBe(true);
    }
    const fix = (id: string) => rules.find((r) => r.id === id)?.fix;
    expect(fix("auth-needs-db")).toEqual(expect.arrayContaining(["auth", "database"]));
    expect(fix("invalid-app-name")).toEqual(["app_name"]);
    expect(fix("target-dir-not-empty")).toEqual(["app_name"]);
  });
});

describe("#32 AC-3: 10件のルールの判定（当たる・当たらない）", () => {
  it("#32 AC-3: 問題のない回答・事実では、どのルールにも当たらない", () => {
    expect(hitIds({})).toEqual([]);
  });

  it("#32 AC-3: ルール1（エラー）認証が app・both で DB が none", () => {
    expect(hitIds({ auth: "app", idp: undefined, database: "none" })).toEqual(["auth-needs-db"]);
    expect(hitIds({ auth: "both", database: "none" })).toEqual(["auth-needs-db"]);
    expect(hitIds({ auth: "app", idp: undefined, database: "d1" })).toEqual([]);
    expect(hitIds({ auth: "oidc", database: "none" })).toEqual([]);
    expect(hitIds({ auth: "none", idp: undefined, database: "none" })).toEqual([]);
  });

  it("#32 AC-3: ルール2（エラー）ファイルのアップロードを使い、DB が none", () => {
    const upload = { file_upload: "yes", file_kinds: ["image"] };
    expect(hitIds({ ...upload, database: "none" })).toEqual(["upload-needs-db"]);
    expect(hitIds({ ...upload, database: "d1" })).toEqual([]);
    expect(hitIds({ file_upload: "no", database: "none" })).toEqual([]);
  });

  it("#32 AC-3: ルール3（警告）ファイルのアップロードを使い、認証が none", () => {
    const upload = { file_upload: "yes", file_kinds: ["image"] };
    expect(hitIds({ ...upload, auth: "none", idp: undefined })).toEqual(["upload-without-auth"]);
    expect(hitIds({ ...upload, auth: "oidc" })).toEqual([]);
    expect(hitIds({ file_upload: "no", auth: "none", idp: undefined })).toEqual([]);
  });

  it("#32 AC-3: ルール4（警告）複数人で、品質チェックがローカルのみ", () => {
    expect(hitIds({ team_size: "team", check_location: "local" })).toEqual(["team-needs-ci"]);
    expect(hitIds({ team_size: "team", check_location: "both" })).toEqual([]);
    expect(hitIds({ team_size: "team", check_location: "github_actions" })).toEqual([]);
    expect(hitIds({ team_size: "solo", check_location: "local" })).toEqual([]);
  });

  it("#32 AC-3: ルール5（警告）公開で、品質チェックがローカルのみ", () => {
    expect(hitIds({ visibility: "public", check_location: "local" })).toEqual(["public-needs-ci"]);
    expect(hitIds({ visibility: "public", check_location: "both" })).toEqual([]);
    expect(hitIds({ visibility: "private", check_location: "local" })).toEqual([]);
  });

  it("#32 AC-3: ルール6（情報）DB が postgresql", () => {
    expect(hitIds({ database: "postgresql", postgres_provider: "neon" })).toEqual([
      "postgresql-needs-service",
    ]);
    expect(hitIds({ database: "d1" })).toEqual([]);
    expect(hitIds({ database: "none" })).toEqual([]);
  });

  it("#32 AC-3: ルール7（警告）最新を選び、検証済みより新しい（事実）", () => {
    const newer: Facts = { ...NO_FACTS, versions_newer_than_verified: true };
    expect(hitIds({ version_policy: "latest" }, newer)).toEqual(["version-newer-than-verified"]);
    expect(hitIds({ version_policy: "verified" }, newer)).toEqual([]);
    expect(hitIds({ version_policy: "latest" }, NO_FACTS)).toEqual([]);
  });

  it("#32 AC-3: ルール8（警告）このPCに必要なツールがない（事実）", () => {
    expect(hitIds({}, { ...NO_FACTS, missing_tools: ["docker：見つかりません"] })).toEqual([
      "missing-tools",
    ]);
    expect(hitIds({}, { ...NO_FACTS, missing_tools: [] })).toEqual([]);
  });

  it("#32 AC-3: ルール9（エラー）アプリ名が命名規則に合わない（事実）", () => {
    expect(hitIds({ app_name: "Bad_Name" }, { ...NO_FACTS, invalid_app_name: true })).toEqual([
      "invalid-app-name",
    ]);
    expect(hitIds({}, { ...NO_FACTS, invalid_app_name: false })).toEqual([]);
  });

  it("#32 AC-3: ルール10（エラー）生成先のフォルダに中身がある（事実）", () => {
    expect(hitIds({}, { ...NO_FACTS, target_dir_not_empty: true })).toEqual([
      "target-dir-not-empty",
    ]);
    expect(hitIds({}, { ...NO_FACTS, target_dir_not_empty: false })).toEqual([]);
  });

  it("#32 AC-3: 結果は errors・warnings・infos の3段階に分かれる。各項目は id・段階・メッセージ・理由・fix を持つ", () => {
    const result = evaluateRules(
      rules,
      baseAnswers({
        auth: "app",
        idp: undefined,
        database: "none",
        team_size: "team",
        check_location: "local",
      }),
      NO_FACTS,
    );
    expect(result.errors.map((h) => h.id)).toEqual(["auth-needs-db"]);
    expect(result.warnings.map((h) => h.id)).toEqual(["team-needs-ci"]);
    expect(result.infos).toEqual([]);
    expect(result.errors[0]).toMatchObject({ id: "auth-needs-db", level: "error" });
    expect(result.errors[0]?.message).toBeTruthy();
    expect(result.errors[0]?.reason).toBeTruthy();
    expect(result.errors[0]?.fix).toEqual(expect.arrayContaining(["auth", "database"]));
    const info = evaluateRules(
      rules,
      baseAnswers({ database: "postgresql", postgres_provider: "neon" }),
      NO_FACTS,
    );
    expect(info.infos.map((h) => h.id)).toEqual(["postgresql-needs-service"]);
  });

  it("#32 AC-3: 同じ入力なら同じ結果になる", () => {
    const a = baseAnswers({ team_size: "team", check_location: "local" });
    expect(evaluateRules(rules, a, NO_FACTS)).toEqual(evaluateRules(rules, a, NO_FACTS));
  });
});

describe("#32 AC-3: ルールのデータの検証（parseRules）", () => {
  const rule = (over: string = "") => `
- id: sample-rule
  level: warning
  when:
    all:
      - { answer: team_size, equals: team }
      - { answer: check_location, in: [local] }
  message: テストのメッセージです
  reason: テストの理由です
  fix: [team_size]
${over}`;

  it("#32 AC-3: 正しいルールは読める（all・any、answer の equals・in・notEquals、fact の equals・in・truthy）", () => {
    const text = `
- id: r-all
  level: error
  when:
    all:
      - { answer: team_size, equals: team }
      - { answer: check_location, notEquals: both }
  message: m
  reason: r
  fix: [team_size]
- id: r-any
  level: info
  when:
    any:
      - { answer: database, in: [postgresql, d1] }
      - { fact: invalid_app_name, truthy: true }
      - { fact: target_dir_not_empty, equals: true }
      - { fact: missing_tools, in: [x] }
  message: m
  reason: r
  fix: []
`;
    expect(parseRules(text).map((r) => r.id)).toEqual(["r-all", "r-any"]);
    expect(parseRules(rule()).map((r) => r.id)).toEqual(["sample-rule"]);
  });

  it("#32 AC-3: 知らない level はエラー", () => {
    expect(() => parseRules(rule().replace("level: warning", "level: fatal"))).toThrow(RulesError);
  });

  it("#32 AC-3: 知らない質問の id（answer・fix）はエラー", () => {
    expect(() =>
      parseRules(rule().replace("answer: team_size", "answer: no_such_question")),
    ).toThrow(RulesError);
    expect(() => parseRules(rule().replace("fix: [team_size]", "fix: [no_such_question]"))).toThrow(
      RulesError,
    );
  });

  it("#32 AC-3: 知らない fact はエラー", () => {
    const text = rule().replace(
      "- { answer: team_size, equals: team }",
      "- { fact: no_such_fact, truthy: true }",
    );
    expect(() => parseRules(text)).toThrow(RulesError);
  });

  it("#32 AC-3: 必須項目（message・reason・when）の欠けはエラー", () => {
    expect(() => parseRules(rule().replace("  message: テストのメッセージです\n", ""))).toThrow(
      RulesError,
    );
    expect(() => parseRules(rule().replace("  reason: テストの理由です\n", ""))).toThrow(
      RulesError,
    );
    expect(() =>
      parseRules("- id: x\n  level: error\n  message: m\n  reason: r\n  fix: []\n"),
    ).toThrow(RulesError);
  });

  it("#32 AC-3: id の重複はエラー", () => {
    expect(() => parseRules(rule() + rule())).toThrow(RulesError);
  });

  it("#32 AC-3: エラーは RulesError にまとめて入り、日本語の文で理由を示す", () => {
    try {
      parseRules(
        rule()
          .replace("level: warning", "level: fatal")
          .replace("answer: team_size", "answer: zzz"),
      );
      throw new Error("エラーになるはずが成功しました");
    } catch (e) {
      expect(e).toBeInstanceOf(RulesError);
      const errors = (e as InstanceType<typeof RulesError>).errors;
      expect(errors.length).toBeGreaterThanOrEqual(2);
      expect(errors[0]).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    }
  });
});
