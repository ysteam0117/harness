// #6 PR-B：試した結果つきの、ハーネスの改善の提案の下書きと、結果の表示。手で作った架空の結果だけを使う。
import { describe, expect, it } from "vitest";
import { renderRangeFeedbackDraft } from "../../src/versions/range-feedback.js";
import type { CandidateFinding, RangeReview } from "../../src/versions/range-review.js";
import { formatTrialResults } from "../../src/versions/range-trial-messages.js";
import type { TrialResult } from "../../src/versions/range-trial.js";

const finding = (name: string, candidate: string, cause: string): CandidateFinding => ({
  status: "candidate",
  target: {
    name,
    range: "^4",
    cause: { package: cause, kind: "peer" },
    profiles: ["lib/alpha"],
  },
  causeVersion: "1.0.0",
  peerRange: "^4 || ^5",
  inRange: "4.1.0",
  candidate,
});

const A = finding("fake-lib", "5.1.0", "fake-pool");
const B = finding("fake-two", "3.0.0", "fake-pool-two");
const C = finding("fake-three", "2.0.0", "fake-pool-three");
const review: RangeReview = { findings: [A, B, C] };

const TAIL = "TAIL_MARKER /tmp/secret-dir/testapp-001 failed";

const mixed = (): TrialResult[] => [
  {
    finding: A,
    replaced: [
      { name: "fake-lib", adopted: "4.1.0", trial: "5.1.0" },
      { name: "fake-pool", adopted: "0.9.0", trial: "1.0.0" },
    ],
    outcome: { kind: "passed" },
    cleanupFailures: [],
  },
  {
    finding: B,
    replaced: [{ name: "fake-two", adopted: "2.0.0", trial: "3.0.0" }],
    outcome: {
      kind: "failed",
      failedStep: "check",
      failedScripts: ["typecheck"],
      timedOut: false,
      suspects: [
        {
          name: "fake-two",
          version: "3.0.0",
          verified: "2.0.0",
          newerThanVerified: true,
          majorDiffers: true,
          named: true,
        },
      ],
      outputTail: TAIL,
      outputSuppressed: false,
    },
    cleanupFailures: [{ kind: "tmp-remove", path: "/tmp/secret-dir/left" }],
  },
  {
    finding: C,
    replaced: [],
    outcome: { kind: "skipped", reason: "build-failed" },
    cleanupFailures: [],
  },
];

describe("#6 AC-4：結果つきの下書き", () => {
  it("trials が無ければ、従来どおりの「未試行」の本文（回帰）", () => {
    const base = renderRangeFeedbackDraft(review) ?? "";
    expect(renderRangeFeedbackDraft(review, undefined)).toBe(base);
    expect(base).toContain("未試行");
    expect(base).toContain("候補の版で npm run check が通るかを試し");
  });

  it("通った・失敗・飛ばしの混在：表・影響・改善の案が結果つき。出力の終わり・パスは入らない", () => {
    const draft = renderRangeFeedbackDraft(review, mixed()) ?? "";
    expect(draft).toContain("## 事象");
    expect(draft).toContain("通った");
    expect(draft).toContain("失敗（npm run check）");
    expect(draft).toContain("飛ばした（試し用のプロジェクトを組み立てられなかった）");
    expect(draft).toContain("fake-pool");
    expect(draft).toContain("範囲を広げられる見込み");
    expect(draft).toContain("実際に試すと失敗した");
    expect(draft).toContain("失敗した品質チェック：typecheck");
    expect(draft).toContain("verified_versions を更新する案");
    expect(draft).toContain("範囲は今のまま");
    expect(draft).toContain("--try-wider-ranges");
    expect(draft).not.toContain("TAIL_MARKER");
    expect(draft).not.toContain("secret-dir");
    expect(draft).not.toContain("testapp-001");
    expect(draft).not.toContain("/tmp");
  });

  it("全件が飛ばし・中断なら「未試行（理由）」", () => {
    const skipped: TrialResult[] = [
      {
        finding: A,
        replaced: [],
        outcome: { kind: "skipped", reason: "docker-unavailable" },
        cleanupFailures: [],
      },
      { finding: B, replaced: [], outcome: { kind: "interrupted" }, cleanupFailures: [] },
    ];
    const draft = renderRangeFeedbackDraft(review, skipped) ?? "";
    expect(draft).toContain("未試行（Docker を使えなかった、中断した）");
    expect(draft).toContain("候補の版で npm run check が通るかを試し");
  });
});

describe("#6 AC-3：結果の表示", () => {
  it("表に、パッケージ・範囲・試した版・原因・結果が並び、失敗は原因の候補と出力の終わりを添える。後始末の失敗はパスつき", () => {
    const text = formatTrialResults(mixed());
    for (const word of ["パッケージ", "範囲", "試した版", "原因", "結果", "fake-pool 1.0.0"]) {
      expect(text).toContain(word);
    }
    expect(text).toContain("原因の候補のパッケージ");
    expect(text).toContain(TAIL);
    expect(text).toContain("手で削除してください：/tmp/secret-dir/left");
    expect(text).toContain("生成したプロジェクトは変えていません");
  });
});
