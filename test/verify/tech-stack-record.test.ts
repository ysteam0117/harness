// #57 AC-1：docs/tech-stack.md の末尾に「## 動作確認」の節を足す（純粋な関数）
import { describe, expect, it } from "vitest";
import { appendVerifiedRecord, verifiedSentence } from "../../src/verify/tech-stack-record.js";

const BASE = "# 技術スタック\n\n| a | b |\n\n## 組み合わせの条件\n\n- メモ\n";

describe("#57 AC-1: appendVerifiedRecord", () => {
  it("末尾に「## 動作確認」の節を足し、日付と手順（npm install・npm run check）を書く", () => {
    const out = appendVerifiedRecord(BASE, "2026-10-03");
    expect(out.startsWith(BASE.trimEnd())).toBe(true);
    expect(out).toContain("## 動作確認");
    expect(out).toContain(
      "このプロジェクトで動作確認済み（2026-10-03、npm install・npm run check）",
    );
    expect(out.endsWith("\n")).toBe(true);
    expect(verifiedSentence("2026-10-03")).toContain("2026-10-03");
  });

  it("冪等：何度足しても、節は1つ。同じ日付なら結果も同じ", () => {
    const once = appendVerifiedRecord(BASE, "2026-10-03");
    const twice = appendVerifiedRecord(once, "2026-10-03");
    expect(twice).toBe(once);
    expect(twice.match(/## 動作確認/g)).toHaveLength(1);
  });

  it("日付が変わったときは、節を置き換える（古い日付は残らない）", () => {
    const first = appendVerifiedRecord(BASE, "2026-10-03");
    const second = appendVerifiedRecord(first, "2026-11-20");
    expect(second).toContain("2026-11-20");
    expect(second).not.toContain("2026-10-03");
    expect(second.match(/## 動作確認/g)).toHaveLength(1);
  });

  it("節の後ろに別の節があっても、後ろの節は残す", () => {
    const text = `${BASE}\n## 動作確認\n\n古い記録\n\n## 別の節\n\n- 残る\n`;
    const out = appendVerifiedRecord(text, "2026-10-03");
    expect(out).toContain("## 別の節");
    expect(out).toContain("- 残る");
    expect(out).not.toContain("古い記録");
    expect(out.match(/## 動作確認/g)).toHaveLength(1);
  });

  it("元の中身（動作確認の節以外）は、変えない", () => {
    const out = appendVerifiedRecord(BASE, "2026-10-03");
    expect(out).toContain("## 組み合わせの条件\n\n- メモ");
  });
});
