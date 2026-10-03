import type { VersionEntry } from "./choose.js";

/** 表示の幅（East Asian Width の全角・広い文字は 2、それ以外は 1） */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
  return width;
}

function isWide(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6)
  );
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

/** 先頭の列の幅の上限。これを超える名前の行だけは、省略せず、次の列を詰める */
const FIRST_COLUMN_MAX = 34;
const GAP = 2;

/**
 * 列を表示の幅でそろえた表の行（見出し＋各行）を返す。最後の列は詰めず、行末の空白は除く。
 * 先頭の列が長すぎる行は、内容を欠けさせず、その行だけ次の列以降を1つの空白で詰める。
 */
export function alignTable(header: string[], rows: string[][]): string[] {
  const all = [header, ...rows];
  const widths = header.map((_, i) => {
    const candidates = all
      .map((r) => displayWidth(r[i] ?? ""))
      .filter((w) => i !== 0 || w <= FIRST_COLUMN_MAX);
    return Math.max(...candidates, 0);
  });
  return all.map((cells) => {
    const first = cells[0] ?? "";
    if (displayWidth(first) > (widths[0] ?? 0)) {
      return cells.join(" ").trimEnd();
    }
    return cells
      .map((cell, i) => (i === cells.length - 1 ? cell : pad(cell, (widths[i] ?? 0) + GAP)))
      .join("")
      .trimEnd();
  });
}

/** 確認の一覧に出す、短い理由（幅 24 以下）。詳しい理由は VersionEntry.reason と tech-stack.md にある */
export function shortReason(e: VersionEntry): string {
  if (e.verified === null) return "未検証（最新）";
  if (e.version === e.verified) {
    return e.latestStatus === "none_in_range" ? "検証済み（範囲外）" : "検証済み";
  }
  return e.majorDiffers ? "最新（大きな版が違う）" : "最新";
}
