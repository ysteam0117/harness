// #6 PR-C：status の登録情報の判定。架空の登録情報・偽の fetch だけを使う。
import { describe, expect, it } from "vitest";
import type { VersionEntry } from "../../src/versions/choose.js";
import { checkMajorUpdates, safeReason } from "../../src/versions/status-review.js";
import { fakeFetch } from "./helpers.js";

const entry = (name: string, version: string): VersionEntry => ({
  name,
  version,
  reason: "テスト用",
  surveyedOn: "2026-10-03",
  latestStable: null,
  latestStatus: "failed",
  verified: null,
  newerThanVerified: false,
  majorDiffers: false,
});

describe("#6 AC-5: checkMajorUpdates", () => {
  it("大きな版が新しい最新の安定版だけを返す（試験版・同じ大きな版・古い版は除く）", async () => {
    const f = fakeFetch({
      npm: {
        "fake-a": ["1.0.0", "1.5.0", "2.0.0", "3.0.0-rc.1"],
        "fake-b": ["1.0.0", "1.9.0"],
        "fake-c": ["1.0.0"],
      },
    });
    const out = await checkMajorUpdates(
      [entry("fake-a", "1.0.0"), entry("fake-b", "1.0.0"), entry("fake-c", "2.0.0")],
      f.fn,
    );
    expect(out).toEqual({
      status: "ok",
      updates: [{ name: "fake-a", adopted: "1.0.0", latest: "2.0.0" }],
      skipped: [],
    });
  });

  it("版として読めない記録は飛ばす。取得できないものは固定の理由で飛ばす", async () => {
    const f = fakeFetch({ npm: { "fake-a": 500 }, npmFallback: () => undefined });
    const out = await checkMajorUpdates([entry("fake-a", "1.0.0"), entry("fake-x", "abc")], f.fn);
    expect(out).toEqual({
      status: "ok",
      updates: [],
      skipped: [
        { name: "fake-x", reason: "版の形ではありません" },
        { name: "fake-a", reason: "HTTP 500" },
      ],
    });
  });

  it("記録が空なら empty（問い合わせない）", async () => {
    const f = fakeFetch();
    expect(await checkMajorUpdates([], f.fn)).toEqual({ status: "empty" });
    expect(f.calls).toEqual([]);
  });
});

describe("#6 AC-5: safeReason", () => {
  it("理由を固定の分類に変え、元の文字列を返さない", () => {
    expect(safeReason("時間切れ（10 秒以内に応答がありませんでした）")).toBe("時間切れ");
    expect(safeReason("HTTP 404 が返されました（https://registry.npmjs.org/x）")).toBe("HTTP 404");
    expect(safeReason("応答を JSON として読めません（https://example.com/x）")).toBe(
      "応答を読めません",
    );
    expect(safeReason("登録情報の形が想定と違います（versions がありません）")).toBe(
      "応答を読めません",
    );
    expect(safeReason("接続できません：HTTP 500 /home/x")).toBe("接続できません");
  });
});
