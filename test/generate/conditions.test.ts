// #72 条件の組み合わせ（all）：src/generate/conditions.ts の parseWhen・whenMatches
//
// 書き方：when: { all: [ { answer: database, equals: d1 }, { answer: auth, notEquals: none } ] }
//   all は、answer 条件の並び（1つ以上）。すべて合うときだけ true。all は answer・equals・in・notEquals と同時に書けない。
//   all の中に all は書けない（入れ子は禁止）。既存の answer 条件の書き方は、そのまま動く（後方互換）。
import { describe, expect, it } from "vitest";
import { parseWhen, whenMatches } from "../../src/generate/conditions.js";
import { GenerateError } from "../../src/generate/errors.js";

const ALL_RAW = {
  all: [
    { answer: "database", equals: "d1" },
    { answer: "auth", notEquals: "none" },
  ],
};

describe("#72 AC-1: all の読み込み（parseWhen）", () => {
  it("#72 AC-1: all を読み、answer 条件の並びにする", () => {
    expect(parseWhen(ALL_RAW, "テスト")).toEqual({
      all: [
        { answer: "database", equals: "d1" },
        { answer: "auth", notEquals: "none" },
      ],
    });
  });

  it("#72 AC-1: 既存の answer 条件は、そのまま読める（後方互換）", () => {
    expect(parseWhen({ answer: "auth", in: ["app", "both"] }, "テスト")).toEqual({
      answer: "auth",
      in: ["app", "both"],
    });
    expect(parseWhen({ answer: "database", equals: "d1" }, "テスト")).toEqual({
      answer: "database",
      equals: "d1",
    });
  });

  it("#72 AC-1: all は他の演算子・answer と同時に書けない（場所を示す）", () => {
    for (const extra of [{ answer: "auth" }, { equals: "d1" }, { in: ["a"] }, { notEquals: "x" }]) {
      expect(() => parseWhen({ ...ALL_RAW, ...extra }, "場所A")).toThrow(GenerateError);
      expect(() => parseWhen({ ...ALL_RAW, ...extra }, "場所A")).toThrow(/場所A.*all/);
    }
  });

  it("#72 AC-1: 空の all・配列でない all はエラー", () => {
    expect(() => parseWhen({ all: [] }, "場所B")).toThrow(/場所B.*all/);
    expect(() => parseWhen({ all: { answer: "auth", equals: "none" } }, "場所B")).toThrow(
      /場所B.*all/,
    );
  });

  it("#72 AC-1: all の中の知らない質問の id は、番目と id を示すエラー", () => {
    const raw = {
      all: [
        { answer: "database", equals: "d1" },
        { answer: "no_such", equals: "x" },
      ],
    };
    expect(() => parseWhen(raw, "場所C")).toThrow(/場所C.*2 番目.*no_such/);
  });

  it("#72 AC-1: all の中の演算子の誤りもエラー（番目を示す）", () => {
    const raw = { all: [{ answer: "database" }] };
    expect(() => parseWhen(raw, "場所D")).toThrow(/場所D.*1 番目/);
  });

  it("#72 AC-1: all の中の all（入れ子）は書けない", () => {
    const raw = { all: [{ all: [{ answer: "database", equals: "d1" }] }] };
    expect(() => parseWhen(raw, "場所E")).toThrow(GenerateError);
    expect(() => parseWhen(raw, "場所E")).toThrow(/場所E.*入れ子/);
  });
});

describe("#72 AC-1: all の判定（whenMatches）", () => {
  const when = parseWhen(ALL_RAW, "テスト");

  it("#72 AC-1: すべて合うときだけ true", () => {
    expect(whenMatches(when, { database: "d1", auth: "app" })).toBe(true);
    expect(whenMatches(when, { database: "d1", auth: "none" })).toBe(false);
    expect(whenMatches(when, { database: "postgresql", auth: "app" })).toBe(false);
    expect(whenMatches(when, { database: "none", auth: "none" })).toBe(false);
  });

  it("#72 AC-1: in と組み合わせられる", () => {
    const w = parseWhen(
      {
        all: [
          { answer: "auth", in: ["app", "both"] },
          { answer: "database", notEquals: "none" },
        ],
      },
      "テスト",
    );
    expect(whenMatches(w, { auth: "both", database: "d1" })).toBe(true);
    expect(whenMatches(w, { auth: "oidc", database: "d1" })).toBe(false);
  });

  it("#72 AC-1: 既存の条件・条件なしは、これまでどおり", () => {
    expect(whenMatches(undefined, {})).toBe(true);
    expect(whenMatches({ answer: "auth", equals: "none" }, { auth: "none" })).toBe(true);
    expect(whenMatches({ answer: "auth", equals: "none" }, { auth: "app" })).toBe(false);
  });
});
