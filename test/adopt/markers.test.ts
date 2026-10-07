// #15 印（<!-- harness:begin -->〜<!-- harness:end -->）の検出と統合。純粋な関数なので、ディスクは使わない。
// 想定する型：src/adopt/markers.ts（BEGIN・END・extractBlock・mergeBlock・MarkerError）
import { describe, expect, it } from "vitest";
import { BEGIN, END, MarkerError, extractBlock, mergeBlock } from "../../src/adopt/markers.js";

const BODY = "# ハーネスのルール\n\n- 日本語で書く";

describe("#15 AC-1: 印の検出", () => {
  it("#15 AC-1: 印の文字列は決まった形である", () => {
    expect(BEGIN).toBe("<!-- harness:begin -->");
    expect(END).toBe("<!-- harness:end -->");
  });

  it("#15 AC-1: 印がなければ none", () => {
    expect(extractBlock("# 既存のルール\n").kind).toBe("none");
    expect(extractBlock("").kind).toBe("none");
  });

  it("#15 AC-1: 1組あれば、中の本文と前後の範囲を返す", () => {
    const text = `前の文章\n\n${BEGIN}\n${BODY}\n${END}\n\n後ろの文章\n`;
    const found = extractBlock(text);
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(found.body).toBe(BODY);
    expect(text.slice(0, found.start)).toBe("前の文章\n\n");
    expect(text.slice(found.end)).toBe("\n\n後ろの文章\n");
  });

  it("#15 AC-1: 中の本文は LF にそろえて返す（CRLF のファイル）", () => {
    const text = `前\r\n${BEGIN}\r\na\r\nb\r\n${END}\r\n後\r\n`;
    const found = extractBlock(text);
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(found.body).toBe("a\nb");
  });

  it.each([
    ["begin だけ", `${BEGIN}\n本文\n`],
    ["end だけ", `本文\n${END}\n`],
    ["順番が逆", `${END}\n本文\n${BEGIN}\n`],
    ["begin が2つ", `${BEGIN}\na\n${BEGIN}\nb\n${END}\n`],
    ["end が2つ", `${BEGIN}\na\n${END}\nb\n${END}\n`],
    ["複数組", `${BEGIN}\na\n${END}\n${BEGIN}\nb\n${END}\n`],
  ])("#15 AC-1: 壊れている（%s）", (_name, text) => {
    const found = extractBlock(text);
    expect(found.kind).toBe("broken");
    if (found.kind === "broken") expect(found.reason).not.toBe("");
  });
});

describe("#15 AC-1: 印で囲んだ本文の統合", () => {
  it("#15 AC-1: ファイルが無ければ、印で囲んだ本文だけのファイルにする", () => {
    expect(mergeBlock(undefined, BODY)).toBe(`${BEGIN}\n${BODY}\n${END}\n`);
  });

  it("#15 AC-1: 既存で印が無ければ、末尾に「空行＋印で囲んだ本文」を足す。既存の文章は1文字も変えない", () => {
    const existing = "# 既存のルール\n\n- 大事なこと\n";
    const merged = mergeBlock(existing, BODY);
    expect(merged.startsWith(existing)).toBe(true);
    expect(merged).toBe(`${existing}\n${BEGIN}\n${BODY}\n${END}\n`);
  });

  it("#15 AC-1: 既存の末尾に改行が無くても、空行を挟んで足す", () => {
    expect(mergeBlock("既存", BODY)).toBe(`既存\n\n${BEGIN}\n${BODY}\n${END}\n`);
  });

  it("#15 AC-1: 空のファイルは、印で囲んだ本文だけにする", () => {
    expect(mergeBlock("", BODY)).toBe(`${BEGIN}\n${BODY}\n${END}\n`);
  });

  it("#15 AC-1: 印が1組あれば、中だけを置き換える。印の外は1文字も変えない", () => {
    const existing = `前の文章\n${BEGIN}\n古い本文\n${END}\n後ろの文章（末尾の改行なし）`;
    const merged = mergeBlock(existing, BODY);
    expect(merged).toBe(`前の文章\n${BEGIN}\n${BODY}\n${END}\n後ろの文章（末尾の改行なし）`);
  });

  it("#15 AC-1: 何度適用しても同じ結果になる（冪等）", () => {
    const once = mergeBlock("# 既存\n", BODY);
    expect(mergeBlock(once, BODY)).toBe(once);
    const created = mergeBlock(undefined, BODY);
    expect(mergeBlock(created, BODY)).toBe(created);
  });

  it("#15 AC-1: 既存が CRLF なら、足す部分も CRLF にそろえる", () => {
    const merged = mergeBlock("# 既存\r\n\r\n- 項目\r\n", BODY);
    expect(merged).toBe(
      `# 既存\r\n\r\n- 項目\r\n\r\n${BEGIN}\r\n# ハーネスのルール\r\n\r\n- 日本語で書く\r\n${END}\r\n`,
    );
    expect(merged.replace(/\r\n/g, "")).not.toContain("\n");
    expect(mergeBlock(merged, BODY)).toBe(merged);
  });

  it("#15 AC-1: 既存が CRLF で印が1組あれば、中だけを CRLF で置き換える", () => {
    const existing = `前\r\n${BEGIN}\r\n古い\r\n${END}\r\n後\r\n`;
    expect(mergeBlock(existing, "新しい\n二行目")).toBe(
      `前\r\n${BEGIN}\r\n新しい\r\n二行目\r\n${END}\r\n後\r\n`,
    );
  });

  it("#15 AC-1: 印が壊れていれば MarkerError（何も返さない）", () => {
    expect(() => mergeBlock(`${BEGIN}\n途中\n`, BODY)).toThrow(MarkerError);
    expect(() => mergeBlock(`${END}\n${BEGIN}\n`, BODY)).toThrow(MarkerError);
  });

  it("#15 AC-1: 本文の中に印の文字列があれば MarkerError（二重に数えてしまうため）", () => {
    expect(() => mergeBlock(undefined, `説明 ${BEGIN} 説明`)).toThrow(MarkerError);
  });
});
