/** ハーネスの部分を囲む印（F-29）。AGENTS.md・CLAUDE.md のように、利用者の文章と同じファイルに入れる文書で使う */
export const BEGIN = "<!-- harness:begin -->";
export const END = "<!-- harness:end -->";

export type BlockLocation =
  | { kind: "none" }
  /** body は印の中の本文（改行は LF。印の行の改行は含めない）。start は BEGIN の位置、end は END の直後の位置 */
  | { kind: "found"; body: string; start: number; end: number }
  | { kind: "broken"; reason: string };

/** 印が壊れている・本文に印の文字列がある */
export class MarkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkerError";
  }
}

function occurrences(text: string, word: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) {
    found.push(at);
  }
  return found;
}

/** 文書から、ハーネスの印で囲んだ部分を探す。印が1組なら found、1つもなければ none、それ以外は broken */
export function extractBlock(text: string): BlockLocation {
  const begins = occurrences(text, BEGIN);
  const ends = occurrences(text, END);
  if (begins.length === 0 && ends.length === 0) return { kind: "none" };
  if (begins.length === 1 && ends.length === 0) {
    return { kind: "broken", reason: "開始の印（begin）だけがあり、終了の印（end）がありません" };
  }
  if (begins.length === 0 && ends.length === 1) {
    return { kind: "broken", reason: "終了の印（end）だけがあり、開始の印（begin）がありません" };
  }
  if (begins.length !== 1 || ends.length !== 1) {
    return {
      kind: "broken",
      reason: `印が複数あります（begin ${String(begins.length)} 個・end ${String(ends.length)} 個）。1組だけにしてください`,
    };
  }
  const start = begins[0] as number;
  const endAt = ends[0] as number;
  if (endAt < start) {
    return { kind: "broken", reason: "終了の印（end）が、開始の印（begin）より前にあります" };
  }
  const inner = text
    .slice(start + BEGIN.length, endAt)
    .replace(/\r\n?/g, "\n")
    .replace(/^\n/, "")
    .replace(/\n$/, "");
  return { kind: "found", body: inner, start, end: endAt + END.length };
}

/** 文書の改行。CRLF が LF より多ければ CRLF、そうでなければ LF */
function eolOf(text: string): "\r\n" | "\n" {
  const crlf = text.split("\r\n").length - 1;
  const lf = text.split("\n").length - 1 - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

/**
 * 既存の文書に、ハーネスの本文を印で囲んで統合する（純粋な関数。何度適用しても同じ結果になる）。
 * - 既存が無い（undefined）：印で囲んだ本文だけ
 * - 印が無い：既存の末尾に「空行＋印で囲んだ本文」を足す（既存の文章は変えない）
 * - 印が1組：中だけを置き換える（印の外は変えない）
 * - 印が壊れている・本文に印の文字列がある：MarkerError
 * 改行は、既存の文書の改行（LF／CRLF）にそろえる。
 */
export function mergeBlock(existing: string | undefined, body: string): string {
  if (body.includes(BEGIN) || body.includes(END)) {
    throw new MarkerError("統合する本文の中に、印の文字列が含まれています");
  }
  const eol = existing === undefined ? "\n" : eolOf(existing);
  const lines = body.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  const block = [BEGIN, ...lines, END].join(eol);
  if (existing === undefined || existing === "") return `${block}${eol}`;

  const located = extractBlock(existing);
  if (located.kind === "broken") throw new MarkerError(located.reason);
  if (located.kind === "found") {
    return `${existing.slice(0, located.start)}${block}${existing.slice(located.end)}`;
  }
  const lead = existing.endsWith("\n") ? "" : eol;
  return `${existing}${lead}${eol}${block}${eol}`;
}
