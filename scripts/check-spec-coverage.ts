// F-22：共通仕様の番号（C-xx）がいずれかのテンプレートに割り当てられていることと、
// テンプレートの冒頭の番号の一覧が F-21 の表と一致していることを確認する。
import { readdirSync, readFileSync, statSync } from "node:fs";
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

/** F-21 の Skill の表の名前と、テンプレートのフォルダ（templates/skills/<フォルダ>） */
const SKILL_FOLDERS: Record<string, string> = {
  実装の進め方: "implementation-process",
  バックエンド: "backend",
  フロントエンド: "frontend",
  テスト: "testing",
  セキュリティ: "security",
  "エラー応答・API": "error-api",
  "環境・デプロイ": "env-deploy",
  レビュー: "review",
  知見: "knowledge",
};

/** 文書の中のリンクの番号（[C-12](…)・範囲 [C-12](…)〜[C-20](…)）を集める */
function linkedIds(text: string): string[] {
  const ids: string[] = [];
  const re = /\[C-(\d+)\]\([^)]*\)\s*[〜～]\s*\[C-(\d+)\]|\[C-(\d+)\]/g;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined && m[2] !== undefined) {
      ids.push(...expandRange(`C-${m[1]}〜C-${m[2]}`));
    } else if (m[3] !== undefined) {
      ids.push(formatId(Number(m[3])));
    }
  }
  return ids;
}

/** F-21 の表から、テンプレート（templates/ からの相対パス）ごとの番号の集合を読む */
export function readF21Assignments(functionalPath: string): Map<string, Set<string>> {
  const md = readFileSync(functionalPath, "utf8");
  const start = md.indexOf('<a id="f-21">');
  const end = md.indexOf('<a id="f-22">');
  if (start < 0 || end < start) throw new Error(`${functionalPath} に F-21 の節がありません`);
  const section = md.slice(start, end);
  const coreStart = section.indexOf("**核");
  const skillStart = section.indexOf("**Skill");
  if (coreStart < 0 || skillStart < coreStart) {
    throw new Error("F-21 の「核」「Skill」の見出しがありません");
  }
  const core = section.slice(coreStart, skillStart);
  const claudeAt = core.indexOf("`CLAUDE.md`：");
  const result = new Map<string, Set<string>>();
  result.set("AGENTS.md", new Set(linkedIds(claudeAt < 0 ? core : core.slice(0, claudeAt))));
  result.set("CLAUDE.md", new Set(claudeAt < 0 ? [] : linkedIds(core.slice(claudeAt))));
  for (const line of section.slice(skillStart).split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const name = cells[1];
    if (name === undefined || name === "Skill" || /^-+$/.test(name)) continue;
    const folder = SKILL_FOLDERS[name];
    if (folder === undefined) {
      throw new Error(`F-21 の Skill の表に、知らない名前があります：${name}`);
    }
    const rel = `skills/${folder}/SKILL.md`;
    if (result.has(rel)) {
      // 同じ Skill の行が重なると、後の行が先の行を上書きして食い違いを見逃すため
      throw new Error(`F-21 の Skill の表に、同じ Skill の行が複数あります：${name}`);
    }
    result.set(rel, new Set(linkedIds(cells[2] ?? "")));
  }
  return result;
}

/**
 * テンプレートの冒頭（最初の Markdown の見出しより前）にある「もとになった共通仕様」の行の番号。
 * 冒頭に無ければ undefined（本文や末尾にだけある一覧は、冒頭の一覧として扱わない）
 */
function templateIds(file: string): string[] | undefined {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const firstHeading = lines.findIndex((l) => /^#{1,6}\s/.test(l));
  const head = firstHeading < 0 ? lines : lines.slice(0, firstHeading);
  const line = head.find((l) => l.includes(MARKER));
  return line === undefined ? undefined : parseSourceLine(line);
}

/**
 * F-21 の表と、各テンプレート（AGENTS.md・CLAUDE.md・skills/<名前>/SKILL.md）の冒頭の番号の一覧を突き合わせる（F-22）。
 * 食い違い・一覧の欠け・表に無い Skill の文言の配列を返す（無ければ空）
 */
export function findTableMismatches(functionalPath: string, templatesDir: string): string[] {
  const table = readF21Assignments(functionalPath);
  const problems: string[] = [];
  const skillsDir = path.join(templatesDir, "skills");
  for (const name of readdirSync(skillsDir)) {
    const rel = `skills/${name}/SKILL.md`;
    if (!table.has(rel) && statSync(path.join(skillsDir, name)).isDirectory()) {
      problems.push(`templates/${rel}：F-21 の Skill の表にありません`);
    }
  }
  for (const [rel, expected] of table) {
    const ids = templateIds(path.join(templatesDir, ...rel.split("/")));
    if (ids === undefined) {
      problems.push(`templates/${rel}：冒頭に「${MARKER}」の番号の一覧がありません`);
      continue;
    }
    const actual = new Set(ids);
    const missing = [...expected].filter((id) => !actual.has(id)).sort();
    const extra = [...actual].filter((id) => !expected.has(id)).sort();
    if (missing.length > 0) {
      problems.push(`templates/${rel}：F-21 の表にあるのに、一覧に無い番号：${missing.join("、")}`);
    }
    if (extra.length > 0) {
      problems.push(`templates/${rel}：一覧にあるのに、F-21 の表に無い番号：${extra.join("、")}`);
    }
  }
  return problems;
}

function main(): void {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let failed = false;
  const unassigned = findUnassigned(
    path.join(rootDir, "docs", "requirements", "README.md"),
    path.join(rootDir, "templates"),
  );
  if (unassigned.length > 0) {
    console.error("どのテンプレートにも割り当てられていない共通仕様があります：");
    for (const id of unassigned) {
      console.error(`  - ${id}`);
    }
    failed = true;
  }
  const mismatches = findTableMismatches(
    path.join(rootDir, "docs", "requirements", "functional.md"),
    path.join(rootDir, "templates"),
  );
  if (mismatches.length > 0) {
    console.error("F-21 の表と、テンプレートの番号の一覧が食い違っています（F-22）：");
    for (const line of mismatches) {
      console.error(`  - ${line}`);
    }
    failed = true;
  }
  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log(
    "すべての共通仕様がいずれかのテンプレートに割り当てられ、F-21 の表とテンプレートの番号の一覧が一致しています。",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
