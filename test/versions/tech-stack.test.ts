// 想定する型：src/versions/tech-stack.ts
//   renderTechStack(result: VersionResult, profiles: Pick<Profile, "key" | "name" | "compatibilityNotes">[]): string
//     - docs/tech-stack.md の中身（Markdown）。書き込みは #34
//     - 表の1行が1つの技術：技術・採用したバージョン・選定理由・調べた日・確認した最新の安定版・検証済み
//     - 最新の安定版が null（取得できなかった）なら、その欄に「未確認」と書く（調べたと誤解させない）
//     - latestStatus が failed なら「未確認（取得できませんでした）」、none_in_range なら「範囲に合う安定版なし」（取得できた旨）と書く。両者を区別する
//     - 検証済みが null（unverified）なら、その欄に「なし」か「未検証」と書く
//     - 組み合わせの条件（profiles の compatibilityNotes）も載せる
import { describe, expect, it } from "vitest";
import type { VersionEntry, VersionResult } from "../../src/versions/choose.js";
import { renderTechStack } from "../../src/versions/tech-stack.js";

const e = (over: Partial<VersionEntry>): VersionEntry => ({
  name: "fake-lib",
  version: "1.3.0",
  reason: "範囲内の最新の安定版",
  surveyedOn: "2026-10-03",
  latestStable: "1.3.0",
  latestStatus: "found",
  verified: "1.2.0",
  newerThanVerified: true,
  majorDiffers: false,
  ...over,
});

const profiles = [
  {
    key: "lib/alpha",
    name: "架空のライブラリ Alpha",
    compatibilityNotes: ["fake-lib は fake-ranged 4系にだけ対応する（5系は不可）"],
  },
  { key: "lib/beta", name: "架空 Beta", compatibilityNotes: [] },
];

function rowOf(md: string, name: string): string {
  const row = md.split("\n").find(
    (l) =>
      l.trimStart().startsWith("|") &&
      l
        .split("|")
        .slice(1)
        .some((c) => c.trim().replaceAll("`", "") === name),
  );
  if (!row) throw new Error(`${name} の行が表にありません：\n${md}`);
  return row;
}

describe("#33 AC-5: tech-stack.md の中身", () => {
  it("#33 AC-5: 技術ごとの行に、採用した版・選定理由・調べた日・最新の安定版・検証済みが入る", () => {
    const result: VersionResult = {
      entries: [
        e({}),
        e({
          name: "fake-ranged",
          version: "4.1.0",
          reason: "ハーネス検証済み",
          latestStable: "4.2.0",
          verified: "4.1.0",
          newerThanVerified: false,
        }),
      ],
      newerThanVerified: true,
    };
    const md = renderTechStack(result, profiles);
    const lib = rowOf(md, "fake-lib");
    expect(lib).toContain("1.3.0");
    expect(lib).toContain("範囲内の最新の安定版");
    expect(lib).toContain("2026-10-03");
    expect(lib).toContain("1.2.0"); // 検証済み
    const ranged = rowOf(md, "fake-ranged");
    expect(ranged).toContain("4.1.0");
    expect(ranged).toContain("ハーネス検証済み");
    expect(ranged).toContain("4.2.0"); // 確認した最新の安定版
    // 表の見出し
    for (const head of ["技術", "採用", "選定理由", "調べた日", "最新", "検証済み"]) {
      expect(md).toContain(head);
    }
  });

  it("#33 AC-5: 同じ入力なら同じ出力（日時などの揺れを入れない）", () => {
    const result: VersionResult = { entries: [e({})], newerThanVerified: true };
    expect(renderTechStack(result, profiles)).toBe(renderTechStack(result, profiles));
  });

  it("#33 AC-5: 結果の並びのとおりに行が並ぶ", () => {
    const result: VersionResult = {
      entries: [e({ name: "zzz-lib" }), e({ name: "aaa-lib" })],
      newerThanVerified: true,
    };
    const md = renderTechStack(result, profiles);
    expect(md.indexOf("zzz-lib")).toBeLessThan(md.indexOf("aaa-lib"));
  });

  it("#33 AC-5: 組み合わせの条件（compatibility_notes）も載せる", () => {
    const md = renderTechStack({ entries: [e({})], newerThanVerified: true }, profiles);
    expect(md).toContain("fake-lib は fake-ranged 4系にだけ対応する（5系は不可）");
    expect(md).toContain("架空のライブラリ Alpha");
  });

  it("#33 AC-5: 大きな版が違う版を採用した場合は、その旨（ハーネスで動作を確認していない）が分かる", () => {
    const md = renderTechStack(
      {
        entries: [
          e({
            name: "fake-major",
            version: "2.0.0",
            verified: "1.0.0",
            latestStable: "2.0.0",
            majorDiffers: true,
          }),
        ],
        newerThanVerified: true,
      },
      profiles,
    );
    expect(md).toMatch(/ハーネスで動作を確認して(いない|いません)|大きな版/);
  });
});

describe("#33 R6: 調べていない（取得できなかった）場合は「未確認」と書く", () => {
  it("#33 R6: latestStable が null の行は「未確認」と書かれ、調べた最新の安定版の版は書かれない", () => {
    const md = renderTechStack(
      {
        entries: [
          e({
            name: "fake-lib",
            version: "1.2.0",
            reason: "ハーネス検証済み",
            latestStable: null,
            latestStatus: "failed",
            newerThanVerified: false,
          }),
        ],
        newerThanVerified: false,
      },
      profiles,
    );
    const row = rowOf(md, "fake-lib");
    expect(row).toContain("未確認");
    expect(row).toContain("1.2.0");
  });

  it("#33 R6: 取得できた行には「未確認」と書かない", () => {
    const md = renderTechStack({ entries: [e({})], newerThanVerified: true }, profiles);
    expect(rowOf(md, "fake-lib")).not.toContain("未確認");
  });

  it("#33 R1: 検証済みがない（unverified）行は、検証済みの欄に版を書かず、理由に未検証と出る", () => {
    const md = renderTechStack(
      {
        entries: [
          e({
            name: "fake-new",
            version: "14.2.0",
            reason: "ハーネスで未検証（範囲内の最新の安定版）",
            latestStable: "14.2.0",
            verified: null,
            newerThanVerified: false,
          }),
        ],
        newerThanVerified: false,
      },
      profiles,
    );
    const row = rowOf(md, "fake-new");
    expect(row).toContain("未検証");
    expect(row).toContain("14.2.0");
  });
});

describe("#33 レビュー指摘3：取得できなかった場合と、範囲に合う安定版がない場合を区別する", () => {
  const none = e({
    name: "fake-ranged",
    version: "4.1.0",
    reason: "範囲 ^4 に合う安定版がないため検証済み",
    latestStable: null,
    latestStatus: "none_in_range",
    verified: "4.1.0",
    newerThanVerified: false,
  });
  const failed = e({
    name: "fake-down",
    version: "1.2.0",
    reason: "ハーネス検証済み",
    latestStable: null,
    latestStatus: "failed",
    fetchFailure: "connect ECONNREFUSED (fake)",
    newerThanVerified: false,
  });
  const md = renderTechStack({ entries: [none, failed], newerThanVerified: false }, profiles);

  it("#33 レビュー指摘3：範囲に合う安定版がない行は「範囲に合う安定版なし」と書き、「未確認」とは書かない（取得できた）", () => {
    const row = rowOf(md, "fake-ranged");
    expect(row).toContain("範囲に合う安定版なし");
    expect(row).not.toContain("未確認");
  });

  it("#33 レビュー指摘3：取得できなかった行は「未確認（取得できませんでした）」と書き、「範囲に合う安定版なし」とは書かない", () => {
    const row = rowOf(md, "fake-down");
    expect(row).toContain("未確認（取得できませんでした）");
    expect(row).not.toContain("範囲に合う安定版なし");
  });
});
