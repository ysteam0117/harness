// #6 PR-A：範囲の見直し（AC-2）と、改善の提案の下書き（AC-4 の一部）。架空の登録情報・偽の fetch だけを使う。
import { describe, expect, it } from "vitest";
import {
  findCandidate,
  formatRangeReview,
  rangeTargetsFor,
  reviewRanges,
  type RangeTarget,
} from "../../src/versions/range-review.js";
import { renderRangeFeedbackDraft } from "../../src/versions/range-feedback.js";
import { baseAnswers } from "../questions/helpers.js";
import { fakeFetch, offlineFetch } from "./helpers.js";

const TARGET: RangeTarget = {
  name: "fake-lib",
  range: "^4",
  cause: { package: "fake-pool", kind: "peer" },
  profiles: ["lib/alpha"],
};

const LIB = ["4.0.0", "4.1.0", "5.0.0", "5.1.0", "6.0.0-rc.1"];

describe("#6 AC-2: findCandidate", () => {
  it("原因の対応範囲に合い、ハーネスの範囲の外で、範囲内の最大より新しい最新の安定版を返す", () => {
    expect(findCandidate(LIB, "^4", "^4 || ^5")).toEqual({ inRange: "4.1.0", candidate: "5.1.0" });
  });

  it("原因が範囲内の版にしか対応していなければ、候補なし", () => {
    expect(findCandidate(LIB, "^4", "^4").candidate).toBeUndefined();
  });

  it("範囲の外の版が試験版だけなら、候補なし", () => {
    expect(findCandidate(["4.1.0", "5.0.0-rc.1"], "^4", "^5.0.0-rc.1 || ^4").candidate).toBe(
      undefined,
    );
  });

  it("範囲内の最大より古い版は候補にしない", () => {
    expect(findCandidate(["3.0.0", "4.1.0"], "^4", "<=3 || ^4").candidate).toBeUndefined();
  });
});

describe("#6 AC-2: reviewRanges", () => {
  const registry = (peer: string, causeVersions = ["0.9.0", "1.0.0"]) =>
    fakeFetch({
      npm: { "fake-lib": LIB, "fake-pool": causeVersions },
      peers: { "fake-pool": { "1.0.0": { "fake-lib": peer } } },
    });

  it("原因の peer が ^4 || ^5 で 5.1.0 がある → 候補 5.1.0 と「5 系にも対応」の文言", async () => {
    const review = await reviewRanges([TARGET], registry("^4 || ^5").fn);
    const f = review.findings[0];
    expect(f).toMatchObject({ status: "candidate", candidate: "5.1.0", causeVersion: "1.0.0" });
    const text = formatRangeReview(review) ?? "";
    expect(text).toContain("fake-lib 5 系にも対応");
    expect(text).toContain("まだ試していません");
  });

  it("原因の peer が ^4 のまま → 候補なし（範囲の見直しは何も出さない旨）", async () => {
    const review = await reviewRanges([TARGET], registry("^4").fn);
    expect(review.findings[0]?.status).toBe("none");
    expect(formatRangeReview(review)).toContain("見つかりませんでした");
    expect(renderRangeFeedbackDraft(review)).toBeUndefined();
  });

  it("原因の最新が試験版だけなら、安定版の peer を使う", async () => {
    const f = fakeFetch({
      npm: { "fake-lib": LIB, "fake-pool": ["1.0.0", "2.0.0-rc.1"] },
      peers: {
        "fake-pool": {
          "1.0.0": { "fake-lib": "^4 || ^5" },
          "2.0.0-rc.1": { "fake-lib": "^4" },
        },
      },
    });
    const review = await reviewRanges([TARGET], f.fn);
    expect(review.findings[0]).toMatchObject({ status: "candidate", causeVersion: "1.0.0" });
  });

  it("原因の登録情報に peer がなければ候補なし", async () => {
    const f = fakeFetch({ npm: { "fake-lib": LIB, "fake-pool": ["1.0.0"] } });
    const review = await reviewRanges([TARGET], f.fn);
    expect(review.findings[0]?.status).toBe("none");
  });

  it("全件取得できなければ skipped（理由つき）で、例外にしない", async () => {
    const review = await reviewRanges([TARGET], offlineFetch().fn);
    expect(review.findings[0]).toMatchObject({ status: "skipped" });
    const text = formatRangeReview(review) ?? "";
    expect(text).toContain("飛ばしました");
    expect(renderRangeFeedbackDraft(review)).toBeUndefined();
  });

  it("HTTP エラーも skipped", async () => {
    const f = fakeFetch({ npm: { "fake-lib": 500, "fake-pool": 500 } });
    const review = await reviewRanges([TARGET], f.fn);
    expect(review.findings[0]?.status).toBe("skipped");
  });

  it("self は peer を読まず、取得もしない", async () => {
    const f = registry("^4 || ^5");
    const review = await reviewRanges(
      [{ ...TARGET, cause: { package: "fake-lib", kind: "self" } }],
      f.fn,
    );
    expect(review.findings[0]?.status).toBe("none");
    expect(f.calls).toHaveLength(0);
  });

  it("見直す対象がなければ、文面は undefined", () => {
    expect(formatRangeReview({ findings: [] })).toBeUndefined();
  });
});

describe("#6 AC-4: 改善の提案の下書き（C-78）", () => {
  it("テンプレートの見出し・版の表・未試行の明記があり、アプリ名やパスを含まない", async () => {
    const f = fakeFetch({
      npm: { "fake-lib": LIB, "fake-pool": ["1.0.0"] },
      peers: { "fake-pool": { "1.0.0": { "fake-lib": "^4 || ^5" } } },
    });
    const review = await reviewRanges([TARGET], f.fn);
    const draft = renderRangeFeedbackDraft(review) ?? "";
    for (const h of [
      "## 事象",
      "## 種類",
      "## 関係するルール・ファイル",
      "## 起きた場面",
      "## 影響",
      "## 改善の案",
      "## 急ぎかどうか",
      "## ハーネスのバージョン",
    ]) {
      expect(draft).toContain(h);
    }
    expect(draft).toContain("未試行（登録情報の peerDependencies だけによる候補）");
    expect(draft).toMatch(/fake-lib\s+\^4\s+5\.1\.0/);
    expect(draft).toContain("templates/profiles/lib/alpha/profile.yaml");
    expect(draft).not.toMatch(/[A-Za-z]:\|\/home\/|\/Users\//);
  });
});

describe("#6 AC-1: 実際のプロファイルの範囲の対象", () => {
  it("既定の回答（PostgreSQL）では vitest・typescript・pg の 3 件", () => {
    const targets = rangeTargetsFor(baseAnswers({ database: "postgresql" }));
    expect(targets.map((t) => t.name).sort()).toEqual(["pg", "typescript", "vitest"]);
    expect(targets.find((t) => t.name === "vitest")?.cause.package).toBe(
      "@cloudflare/vitest-pool-workers",
    );
  });
});
