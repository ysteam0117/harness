import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Answers } from "../questions/answers.js";
import { parseWhen, whenMatches, type When } from "./conditions.js";
import { isPlainObject, readDataYaml } from "./data.js";
import { GenerateError } from "./errors.js";
import { normalizeNewlines } from "./template.js";

export interface KnowledgeEntry {
  /** knowledge/ からの相対パス（"db/index-design.md"）。"/" 区切り */
  source: string;
  /** 分野（source の最初のフォルダ） */
  field: string;
  /** ファイル名 */
  file: string;
  /** ファイルの最初の見出し */
  title: string;
  /** 中身（改行は LF） */
  content: string;
}

interface SelectionRule {
  /** "<フォルダ>/*" か、ファイルのパス */
  path: string;
  when: When;
}

const DATA_FILE = "knowledge-selection.yaml";

function defaultKnowledgeDir(): string {
  return fileURLToPath(new URL("../../knowledge/", import.meta.url));
}

let cachedRules: SelectionRule[] | undefined;

/** data/knowledge-selection.yaml（知見のファイル → 回答の条件）を読む */
function loadRules(): SelectionRule[] {
  if (cachedRules) return cachedRules;
  const doc = readDataYaml(DATA_FILE);
  if (!Array.isArray(doc)) {
    throw new GenerateError(`data/${DATA_FILE}：「- path: <フォルダ>/*」の並びで書いてください`);
  }
  cachedRules = doc.map((item, index): SelectionRule => {
    const at = `data/${DATA_FILE} の ${index + 1} 番目`;
    if (!isPlainObject(item)) throw new GenerateError(`${at}：「項目: 値」の形で書いてください`);
    for (const key of Object.keys(item)) {
      if (key !== "path" && key !== "when") {
        throw new GenerateError(`${at}：知らない項目 ${key} があります（書き間違いの可能性）`);
      }
    }
    const p = item["path"];
    if (typeof p !== "string" || !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+|\/\*)$/.test(p)) {
      throw new GenerateError(
        `${at}：path は "<分野>/<ファイル名>" か "<分野>/*" の形で書いてください`,
      );
    }
    return { path: p, when: parseWhen(item["when"], at) };
  });
  return cachedRules;
}

function matchesPath(pattern: string, source: string): boolean {
  return pattern.endsWith("/*")
    ? source.startsWith(pattern.slice(0, -1)) && !source.slice(pattern.length - 1).includes("/")
    : pattern === source;
}

/** ファイルの最初の見出し（"# " の行の文字） */
function firstTitle(content: string, source: string): string {
  for (const line of content.split("\n")) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) return m[1] ?? "";
  }
  throw new GenerateError(`知見 ${source} に、最初の見出し（# の行）がありません`);
}

function listMarkdown(root: string): string[] {
  let names: string[];
  try {
    names = readdirSync(root, { recursive: true, encoding: "utf8" });
  } catch (e) {
    throw new GenerateError(`知見のフォルダを読めません：${root}（${(e as Error).message}）`, {
      cause: e,
    });
  }
  return names
    .map((n) => n.split(path.sep).join("/"))
    .filter((n) => n.endsWith(".md") && path.posix.basename(n) !== "README.md")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * 回答に関係する知見だけを選ぶ（README は除く。source の順）。
 * data/knowledge-selection.yaml に条件が書かれたファイルは、条件に合うときだけ選ぶ。書かれていないファイルは常に選ぶ。
 */
export function selectKnowledge(
  answers: Answers,
  opts: { knowledgeDir?: string } = {},
): KnowledgeEntry[] {
  const dir = opts.knowledgeDir ?? defaultKnowledgeDir();
  const rules = loadRules();
  const out: KnowledgeEntry[] = [];
  for (const source of listMarkdown(dir)) {
    const applicable = rules.filter((r) => matchesPath(r.path, source));
    if (!applicable.every((r) => whenMatches(r.when, answers))) continue;
    let raw: string;
    try {
      raw = readFileSync(path.join(dir, ...source.split("/")), "utf8");
    } catch (e) {
      throw new GenerateError(`知見 ${source} を読めません（${(e as Error).message}）`, {
        cause: e,
      });
    }
    const content = normalizeNewlines(raw);
    const slash = source.indexOf("/");
    out.push({
      source,
      field: slash < 0 ? "" : source.slice(0, slash),
      file: path.posix.basename(source),
      title: firstTitle(content, source),
      content,
    });
  }
  return out;
}

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** Skill「知見」の表（分野・ファイル・内容）の行。1ファイル1行で、改行でつなぐ */
export function knowledgeIndexRows(entries: KnowledgeEntry[]): string {
  return entries
    .map((e) => `| ${cell(e.field)} | ${cell(e.file.replace(/\.md$/, ""))} | ${cell(e.title)} |`)
    .join("\n");
}
