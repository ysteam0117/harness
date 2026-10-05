export const VERIFIED_HEADING = "## 動作確認";

/** 動作確認の節の文。日付は YYYY-MM-DD */
export function verifiedSentence(date: string): string {
  return `このプロジェクトで動作確認済み（${date}、npm install・npm run check）`;
}

/**
 * docs/tech-stack.md の末尾に「## 動作確認」の節を足した中身を返す。
 * すでに節があるときは、その節を新しい日付に置き換える（何度実行しても、節は1つ）。
 */
export function appendVerifiedRecord(techStack: string, date: string): string {
  const section = `${VERIFIED_HEADING}\n\n${verifiedSentence(date)}\n`;
  const lines = techStack.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l === VERIFIED_HEADING);
  if (start === -1) {
    return `${techStack.replace(/\s+$/, "")}\n\n${section}`;
  }
  let end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
  if (end === -1) end = lines.length;
  const before = lines.slice(0, start).join("\n").replace(/\s+$/, "");
  const after = lines.slice(end).join("\n").replace(/^\s+/, "");
  return `${before}\n\n${section}${after === "" ? "" : `\n${after}`}`;
}
