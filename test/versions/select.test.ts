// 想定する型：src/versions/select.ts
//   pickLatestStable(versions: string[], range?: string): string | undefined
//     - 安定版だけ（semver.prerelease が null）、範囲（あれば）に合うもの、の中で最大。なければ undefined
//     - semver として読めない文字列は無視する（例外にしない）
//   compareWithVerified(verified: string, candidate: string): { kind: "same" | "newer" | "older"; majorDiffers: boolean }
//     - 同じ／新しい／古い。majorDiffers は、大きな版（メジャー）が違うか
import { describe, expect, it } from "vitest";
import { compareWithVerified, pickLatestStable } from "../../src/versions/select.js";

describe("#33 AC-1: 最新の安定版を選ぶ（試験版は選ばない）", () => {
  it("#33 AC-1: RC・beta・alpha・next を除いた最大を選ぶ", () => {
    const versions = [
      "1.0.0",
      "1.4.2",
      "2.0.0-rc.1",
      "2.0.0-beta.2",
      "2.0.0-alpha.9",
      "2.0.0-next.4",
    ];
    expect(pickLatestStable(versions)).toBe("1.4.2");
  });

  it("#33 AC-1: 並び順に依らない（数としての最大。1.10.0 は 1.9.0 より新しい）", () => {
    expect(pickLatestStable(["1.9.0", "1.10.0", "1.2.0"])).toBe("1.10.0");
    expect(pickLatestStable(["1.10.0", "1.9.0"])).toBe("1.10.0");
  });

  it("#33 AC-1: 安定版が1つもなければ undefined", () => {
    expect(pickLatestStable(["1.0.0-rc.1", "2.0.0-beta.1"])).toBeUndefined();
    expect(pickLatestStable([])).toBeUndefined();
  });

  it("#33 AC-1: semver として読めない名前（latest など）は無視する", () => {
    expect(pickLatestStable(["latest", "not-a-version", "1.2.3"])).toBe("1.2.3");
  });

  it("#33 AC-1: ビルドの印（+build）つきの安定版は安定版として扱う", () => {
    expect(pickLatestStable(["1.0.0", "1.1.0+build.5"])).toBe("1.1.0+build.5");
  });
});

describe("#33 AC-2: 範囲に合う中で最新を選ぶ", () => {
  const versions = ["3.9.0", "4.0.0", "4.1.11", "4.2.0", "5.0.0", "5.1.0", "5.2.0-rc.1"];

  it("#33 AC-2: ^4 の範囲では 4 系の最大を選ぶ（5 系があっても選ばない）", () => {
    expect(pickLatestStable(versions, "^4")).toBe("4.2.0");
  });

  it("#33 AC-2: 範囲の中でも試験版は選ばない（4.3.0-rc.1 があっても 4.2.0）", () => {
    expect(pickLatestStable([...versions, "4.3.0-rc.1"], "^4")).toBe("4.2.0");
  });

  it("#33 AC-2: >=6.0.0 <6.1.0 のような上限つきの範囲を守る", () => {
    expect(pickLatestStable(["6.0.3", "6.0.9", "6.1.0", "7.0.0"], ">=6.0.0 <6.1.0")).toBe("6.0.9");
  });

  it("#33 AC-2: 範囲に合う安定版がなければ undefined（呼び出し側が検証済みを使う）", () => {
    expect(pickLatestStable(["5.0.0", "5.1.0", "4.0.0-rc.1"], "^4")).toBeUndefined();
  });

  it("#33 AC-2: 範囲なしなら全体の最大", () => {
    expect(pickLatestStable(versions)).toBe("5.1.0");
  });
});

describe("#33 AC-3: 検証済みとの比較", () => {
  it("#33 AC-3: 同じ版は same・大きな版は同じ", () => {
    expect(compareWithVerified("4.1.11", "4.1.11")).toEqual({ kind: "same", majorDiffers: false });
  });

  it("#33 AC-3: 小さな版・修正版だけ新しいときは newer で、大きな版は違わない（警告なし）", () => {
    expect(compareWithVerified("4.1.11", "4.2.0")).toEqual({ kind: "newer", majorDiffers: false });
    expect(compareWithVerified("4.1.11", "4.1.12")).toEqual({ kind: "newer", majorDiffers: false });
  });

  it("#33 AC-3: 大きな版が違うと、majorDiffers が真（警告の対象）", () => {
    expect(compareWithVerified("4.1.11", "5.0.0")).toEqual({ kind: "newer", majorDiffers: true });
  });

  it("#33 AC-3: 0 系は、小さな版が違っても大きな版が違うとは扱わない（0.45.3 → 0.46.0 は newer のみ）", () => {
    // メジャー（先頭の数）で判定する。0.x の細かい扱いは、実装の役割が決めない（単純にメジャーで見る）
    expect(compareWithVerified("0.45.3", "0.46.0")).toEqual({ kind: "newer", majorDiffers: false });
  });

  it("#33 AC-3: 候補が検証済みより古いときは older", () => {
    expect(compareWithVerified("4.1.11", "4.0.0")).toEqual({ kind: "older", majorDiffers: false });
    expect(compareWithVerified("4.1.11", "3.9.0")).toEqual({ kind: "older", majorDiffers: true });
  });
});
