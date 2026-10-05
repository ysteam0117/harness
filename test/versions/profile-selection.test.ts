// 想定する型：src/versions/profile-selection.ts（data/profile-selection.yaml を読む）
//   interface SelectionRule { profile: string; when?: { answer: string; equals?: string; in?: string[]; notEquals?: string } }
//   parseProfileSelection(text: string, templatesDir?: string): SelectionRule[]
//     - YAML は「- profile: <分類>/<id>」の並び。when を書かなければ常に選ぶ。when は consistency-rules.yaml の answer 条件と同じ書き方
//     - 知らないプロファイル（templatesDir に無い。既定は実際の templates/）・知らない質問の id・形の誤りは GenerateError（日本語。名前を示す）
//   selectProfiles(answers: Partial<Answers>, rules?: SelectionRule[]): string[]
//     - 条件に合うルールの profile の key を、書いた順に返す（重複なし）。rules の既定は data/profile-selection.yaml
// 実際の data/profile-selection.yaml は、実装の役割が書く前提：常に 7 つ、database ≠ none のとき data-access/drizzle を足す
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GenerateError } from "../../src/generate/errors.js";
import { loadProfile } from "../../src/generate/profile.js";
import { parseProfileSelection, selectProfiles } from "../../src/versions/profile-selection.js";
import { baseAnswers } from "../questions/helpers.js";
import { realTemplatesDir } from "../generate/helpers.js";

const dataFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/profile-selection.yaml",
);

const ALWAYS = [
  "backend-framework/hono",
  "logger/structured-logger",
  "frontend-build/vite-react-router",
  "http-client/axios",
  "frontend-state/tanstack-query-rhf-zod",
  "test-framework/vitest-playwright",
  "quality/typescript-standard",
];

describe("#33 selectProfiles：回答から使うプロファイルを決める", () => {
  it("#33 AC-2: database が d1 のとき、常に使う 7 つと data-access/drizzle を選ぶ", () => {
    // 認証のプロファイル（auth/*。#72）は、別のテストで確かめる
    const keys = selectProfiles(baseAnswers({ database: "d1" })).filter(
      (k) => !k.startsWith("auth/"),
    );
    expect(keys).toHaveLength(8);
    expect(keys).toEqual(expect.arrayContaining([...ALWAYS, "data-access/drizzle"]));
  });

  it("#33 AC-2: database が postgresql のときも drizzle を含む", () => {
    expect(
      selectProfiles(baseAnswers({ database: "postgresql", postgres_provider: "neon" })),
    ).toContain("data-access/drizzle");
  });

  it("#33 AC-2: database = none のとき drizzle を含まない（常に使う 7 つだけ）", () => {
    const keys = selectProfiles(baseAnswers({ database: "none", auth: "none", idp: undefined }));
    expect(keys).not.toContain("data-access/drizzle");
    expect(keys).toHaveLength(7);
    expect(keys).toEqual(expect.arrayContaining(ALWAYS));
  });

  it("#33 AC-2: 同じ回答なら同じ結果（重複なし）", () => {
    const a = selectProfiles(baseAnswers());
    expect(selectProfiles(baseAnswers())).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
  });

  it("#33 AC-2: 選んだプロファイルは、すべて実際の templates/ にあり、requires を満たす（hono は logger を要る）", () => {
    for (const key of selectProfiles(baseAnswers())) {
      const profile = loadProfile(realTemplatesDir, key);
      for (const req of profile.requires) {
        expect(selectProfiles(baseAnswers())).toContain(req);
      }
    }
  });

  it("#33 AC-2: ルールを渡すと、それを使う（条件 in・notEquals・when なし）", () => {
    const rules = parseProfileSelection(
      `- profile: logger/structured-logger
- profile: data-access/drizzle
  when: { answer: database, in: [d1, postgresql] }
- profile: http-client/axios
  when: { answer: auth, notEquals: none }
`,
      realTemplatesDir,
    );
    expect(
      selectProfiles(baseAnswers({ database: "none", auth: "none", idp: undefined }), rules),
    ).toEqual(["logger/structured-logger"]);
    expect(selectProfiles(baseAnswers({ database: "d1", auth: "oidc" }), rules)).toEqual([
      "logger/structured-logger",
      "data-access/drizzle",
      "http-client/axios",
    ]);
  });
});

describe("#33 selectProfiles：データの検証", () => {
  it("#33 AC-2: 実際の data/profile-selection.yaml が、実際のプロファイルと質問に対して正しく読める", () => {
    const rules = parseProfileSelection(readFileSync(dataFile, "utf8"), realTemplatesDir);
    expect(rules.map((r) => r.profile)).toEqual(
      expect.arrayContaining([...ALWAYS, "data-access/drizzle"]),
    );
  });

  it("#33 AC-2: 知らないプロファイルはエラー（名前を示す）", () => {
    const text = "- profile: nothing/ghost\n";
    expect(() => parseProfileSelection(text, realTemplatesDir)).toThrow(GenerateError);
    expect(() => parseProfileSelection(text, realTemplatesDir)).toThrow(/nothing\/ghost/);
  });

  it("#33 AC-2: 知らない質問の id はエラー（id を示す）", () => {
    const text =
      "- profile: data-access/drizzle\n  when: { answer: no_such_question, equals: x }\n";
    expect(() => parseProfileSelection(text, realTemplatesDir)).toThrow(GenerateError);
    expect(() => parseProfileSelection(text, realTemplatesDir)).toThrow(/no_such_question/);
  });

  it("#33 AC-2: 形の誤り（連想配列でない・profile がない・YAML の構文エラー）はエラー", () => {
    for (const text of [
      "profile: data-access/drizzle\n",
      "- when: { answer: database, equals: d1 }\n",
      "- [unclosed\n",
    ]) {
      expect(() => parseProfileSelection(text, realTemplatesDir), text).toThrow(GenerateError);
    }
  });
});

describe("#72 認証のプロファイルの選択（auth/session・auth/app-auth・auth/oidc-auth）", () => {
  const authKeys = (auth: "none" | "app" | "oidc" | "both") =>
    selectProfiles(
      baseAnswers({
        database: "d1",
        auth,
        idp: auth === "oidc" || auth === "both" ? "google" : undefined,
      }),
    ).filter((k) => k.startsWith("auth/"));

  it("#72 AC-1: auth が none のとき、auth/* は選ばれない", () => {
    expect(authKeys("none")).toEqual([]);
  });
  it("#72 AC-1: app のとき auth/session と auth/app-auth", () => {
    expect(authKeys("app")).toEqual(["auth/session", "auth/app-auth"]);
  });
  it("#72 AC-1: oidc のとき auth/session と auth/oidc-auth", () => {
    expect(authKeys("oidc")).toEqual(["auth/session", "auth/oidc-auth"]);
  });
  it("#72 AC-1: both のとき 3 つとも", () => {
    expect(authKeys("both")).toEqual(["auth/session", "auth/app-auth", "auth/oidc-auth"]);
  });

  it("#72 AC-1: 認証のプロファイルは packages が空で読め、実際の templates/ にある", () => {
    for (const key of ["auth/session", "auth/app-auth", "auth/oidc-auth"]) {
      const p = loadProfile(realTemplatesDir, key);
      expect(p.category).toBe("auth");
      expect(p.packages).toEqual([]);
    }
  });

  it("#72 AC-1・#73: 方式ごとのプロファイル（app-auth・oidc-auth）は枠だけ（files なし）。共通の auth/session には中身がある", () => {
    for (const key of ["auth/app-auth", "auth/oidc-auth"]) {
      expect(loadProfile(realTemplatesDir, key).files).toEqual([]);
    }
    const session = loadProfile(realTemplatesDir, "auth/session");
    expect(session.files.length).toBeGreaterThan(0);
    expect(session.filesWhen.length).toBe(2); // D1・PostgreSQL
  });

  it("#72 AC-1: プロファイルの選択でも all が使える", () => {
    const text =
      "- profile: data-access/drizzle\n  when: { all: [{ answer: database, equals: d1 }, { answer: auth, notEquals: none }] }\n";
    const rules = parseProfileSelection(text, realTemplatesDir);
    expect(
      selectProfiles(baseAnswers({ database: "d1", auth: "app", idp: undefined }), rules),
    ).toEqual(["data-access/drizzle"]);
    expect(
      selectProfiles(baseAnswers({ database: "d1", auth: "none", idp: undefined }), rules),
    ).toEqual([]);
    expect(
      selectProfiles(baseAnswers({ database: "none", auth: "app", idp: undefined }), rules),
    ).toEqual([]);
  });

  it("#72 AC-1: all の誤り（空・知らない質問）はエラー（プロファイルを示す）", () => {
    for (const when of ["{ all: [] }", "{ all: [{ answer: nope, equals: x }] }"]) {
      const text = `- profile: data-access/drizzle\n  when: ${when}\n`;
      expect(() => parseProfileSelection(text, realTemplatesDir), when).toThrow(
        /data-access\/drizzle/,
      );
    }
  });
});
