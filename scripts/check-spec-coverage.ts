// F-22：共通仕様の番号（C-xx）がいずれかのテンプレートに割り当てられているかを確認する。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "もとになった共通仕様";
const RANGE_SEPARATOR = /[〜～]/;
const SINGLE_ID = /^C-(\d+)$/;

function formatId(n: number): string {
  return `C-${String(n).padStart(2, "0")}`;
}

/** 「C-12〜C-20」のような範囲を、C-12…C-20 の一覧に展開する */
export function expandRange(text: string): string[] {
  const parts = text.trim().split(RANGE_SEPARATOR);
  const start = parts[0] === undefined ? null : SINGLE_ID.exec(parts[0].trim());
  const end = parts[1] === undefined ? null : SINGLE_ID.exec(parts[1].trim());
  if (parts.length !== 2 || !start?.[1] || !end?.[1]) {
    throw new Error(`範囲の形が正しくありません：${text}`);
  }
  const from = Number(start[1]);
  const to = Number(end[1]);
  if (from > to) {
    throw new Error(`範囲の順序が逆です：${text}`);
  }
  const ids: string[] = [];
  for (let n = from; n <= to; n++) {
    ids.push(formatId(n));
  }
  return ids;
}

const COMMENT_LINE = new RegExp(String.raw`^\s*<!--\s*${MARKER}[：:](.*?)-->\s*$`);
const HASH_LINE = new RegExp(String.raw`^\s*#\s*${MARKER}[：:](.*)$`);

/** 「もとになった共通仕様：…」の1行から C-xx の一覧を取り出す（F-xx と後ろの括弧は数えない） */
export function parseSourceLine(line: string): string[] {
  const match = COMMENT_LINE.exec(line) ?? HASH_LINE.exec(line);
  if (!match || match[1] === undefined) {
    throw new Error(`「${MARKER}」の行の形が正しくありません：${line}`);
  }
  const ids: string[] = [];
  for (const rawItem of match[1].split("・")) {
    const item = rawItem.replace(/[（(].*$/, "").trim();
    if (/^F-\d+$/.test(item)) {
      continue;
    }
    const single = SINGLE_ID.exec(item);
    if (single?.[1]) {
      ids.push(formatId(Number(single[1])));
    } else if (RANGE_SEPARATOR.test(item)) {
      ids.push(...expandRange(item));
    } else {
      throw new Error(`解釈できない項目です：「${item}」（行：${line}）`);
    }
  }
  return ids;
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/** テンプレート全体から、割り当て済みの C-xx を集める（各ファイルの最初の該当行だけを読む） */
export function collectSpecIds(templatesDir: string): Set<string> {
  const ids = new Set<string>();
  for (const file of listFiles(templatesDir)) {
    const line = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .find((l) => l.includes(`${MARKER}：`) || l.includes(`${MARKER}:`));
    if (line === undefined) {
      continue;
    }
    try {
      for (const id of parseSourceLine(line)) {
        ids.add(id);
      }
    } catch (e) {
      throw new Error(`${file}：${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }
  return ids;
}

function readReadmeIds(readmePath: string): string[] {
  const ids: string[] = [];
  for (const line of readFileSync(readmePath, "utf8").split(/\r?\n/)) {
    const m = /^\| \[C-(\d+)\]/.exec(line);
    if (m?.[1]) {
      ids.push(formatId(Number(m[1])));
    }
  }
  return ids;
}

/** README にあるのにどのテンプレートにも割り当てられていない C-xx を昇順で返す */
export function findUnassigned(readmePath: string, templatesDir: string): string[] {
  const readmeIds = new Set(readReadmeIds(readmePath));
  const assigned = collectSpecIds(templatesDir);
  const unknown = [...assigned].filter((id) => !readmeIds.has(id)).sort();
  if (unknown.length > 0) {
    throw new Error(`README に無い番号がテンプレートにあります：${unknown.join("、")}`);
  }
  return [...readmeIds].filter((id) => !assigned.has(id)).sort();
}

function main(): void {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const unassigned = findUnassigned(
    path.join(rootDir, "docs", "requirements", "README.md"),
    path.join(rootDir, "templates"),
  );
  if (unassigned.length > 0) {
    console.error("どのテンプレートにも割り当てられていない共通仕様があります：");
    for (const id of unassigned) {
      console.error(`  - ${id}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("すべての共通仕様がいずれかのテンプレートに割り当てられています。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
