const MARKER = "もとになった共通仕様";
const HTML_COMMENT_LINE_RE = /^[ \t]*<!--.*-->[ \t]*$/;
const MARKER_LINE_RE = /^[ \t]*(?:<!--.*-->|\/\/.*|#.*|\/\*.*\*\/)[ \t]*$/;
const HEADING_RE = /^#{1,6}\s/;

/**
 * 文書（Markdown）の最初の部分（最初の見出しより前）にある、ハーネス用の説明のコメントの行
 * （<!-- ... -->）を取り除く。文書の途中のコメントは残す。コメントがなければ何も変えない。
 */
export function stripPreambleComments(text: string, atFileStart: boolean): string {
  const lines = text.split("\n");
  let h = lines.findIndex((line) => HEADING_RE.test(line));
  if (h < 0) h = lines.length;
  const preamble = lines.slice(0, h);
  if (!preamble.some((line) => HTML_COMMENT_LINE_RE.test(line))) return text;
  const kept: string[] = [];
  for (const line of preamble) {
    if (HTML_COMMENT_LINE_RE.test(line)) continue;
    if (line === "" && kept[kept.length - 1] === "") continue;
    kept.push(line);
  }
  while (atFileStart && kept[0] === "") kept.shift();
  return [...kept, ...lines.slice(h)].join("\n");
}

/**
 * コードなどのファイルの先頭にある、「もとになった共通仕様」を書いたコメントの行だけを取り除く。
 * ほかのコメント（通常のコードのコメント）は残す。
 */
function stripMarkerLines(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const isMarker = MARKER_LINE_RE.test(line) && line.includes(MARKER);
    if (!isMarker && line.trim() !== "") break;
    i += 1;
  }
  const head = lines.slice(0, i);
  if (!head.some((line) => line.includes(MARKER))) return text;
  const kept = head.filter((line) => !line.includes(MARKER));
  while (kept[0] !== undefined && kept[0].trim() === "") kept.shift();
  return [...kept, ...lines.slice(i)].join("\n");
}

/**
 * ハーネス用の説明のコメントを取り除く（すべての出力に共通）。
 * Markdown（.md）は、Skill の冒頭（---）の直後・文書の最初の部分のコメントの行を取り除く。
 * それ以外のファイルは、先頭の「もとになった共通仕様」のコメントの行だけを取り除く。
 */
export function stripHarnessComments(text: string, fileName: string): string {
  if (!fileName.endsWith(".md")) return stripMarkerLines(text);
  const m = /^(---\n[\s\S]*?\n---\n)([\s\S]*)$/.exec(text);
  if (!m) return stripPreambleComments(text, true);
  return (m[1] ?? "") + stripPreambleComments(m[2] ?? "", false);
}

const MARKER_COMMENT_RE = /^[ \t]*<!--.*もとになった共通仕様.*-->[ \t]*$/;

/**
 * 文書（Markdown）のどこにあっても、「もとになった共通仕様」を書いた1行のコメントを取り除く
 * （見出しの後ろにある場合も含む）。ほかのコメントは残す。コメントの前後の空行が重ならないようにする。
 */
export function stripMarkerComments(text: string): string {
  const lines = text.split("\n");
  if (!lines.some((line) => MARKER_COMMENT_RE.test(line))) return text;
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!MARKER_COMMENT_RE.test(line)) {
      kept.push(line);
      continue;
    }
    const previousBlank = kept.length === 0 || kept[kept.length - 1] === "";
    if (previousBlank && lines[i + 1] === "") i += 1;
  }
  return kept.join("\n");
}
