import { readFileSync } from "node:fs";
import path from "node:path";
import { GenerateError } from "./errors.js";

export type RenderOptions = {
  /** {{include:<分類>/_shared}} の引用先を探すひな形の場所 */
  templatesDir: string;
  /** エラーのメッセージに入れるファイルの名前 */
  fileName: string;
};

const INCLUDE_RE = /\{\{include:([^{}\n]*)\}\}/g;
const NAME_RE = /\{\{([a-z][a-z0-9_]*)\}\}/g;
const INCLUDE_PATH_RE = /^([A-Za-z0-9][A-Za-z0-9_-]*)\/_shared$/;

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** 引用先の先頭にある HTML コメントの行（<!-- ... -->）を取り除く。 */
function stripLeadingComments(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && /^\s*<!--.*-->\s*$/.test(lines[i] ?? "")) i += 1;
  return lines.slice(i).join("\n");
}

function readShared(spec: string, options: RenderOptions): string {
  const match = INCLUDE_PATH_RE.exec(spec);
  if (!match) {
    throw new GenerateError(
      `${options.fileName}：{{include:${spec}}} の書き方が誤っています。{{include:<分類>/_shared}} の形で書いてください`,
    );
  }
  const file = path.join(options.templatesDir, "profiles", match[1] ?? "", "_shared", "SKILL.md");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new GenerateError(
      `${options.fileName}：{{include:${spec}}} の引用先（profiles/${spec}/SKILL.md）を読めません`,
      { cause: e },
    );
  }
  const body = stripLeadingComments(normalizeNewlines(text));
  if (new RegExp(INCLUDE_RE.source).test(body)) {
    throw new GenerateError(
      `${options.fileName}：引用先 profiles/${spec}/SKILL.md の中に {{include:...}} があります（引用の中の引用は使えません）`,
    );
  }
  return body;
}

/**
 * ひな形の {{名前}} を値に、{{include:<分類>/_shared}} を共通の部分に差し込む。
 * 引用を展開してから未定義の名前を判定し、1回だけ置き換える（値の中の {{x}} は再展開しない）。
 */
export function renderTemplate(
  template: string,
  values: Record<string, string>,
  options: RenderOptions,
): string {
  const expanded = normalizeNewlines(template).replace(INCLUDE_RE, (_all, spec: string) =>
    readShared(spec, options),
  );

  const used = new Set<string>();
  for (const m of expanded.matchAll(NAME_RE)) used.add(m[1] ?? "");

  const missing: string[] = [];
  for (const name of used) {
    if (!Object.hasOwn(values, name) || values[name] === undefined) {
      missing.push(name);
      continue;
    }
    if (typeof values[name] !== "string") {
      throw new GenerateError(
        `${options.fileName}：名前 ${name} の値が文字列ではありません（文字列だけを渡せます）`,
      );
    }
  }
  if (missing.length > 0) {
    throw new GenerateError(
      `${options.fileName}：値が決まっていない名前があります：${missing.join("、")}`,
    );
  }

  return normalizeNewlines(
    expanded.replace(NAME_RE, (_all, name: string) => values[name] as string),
  );
}
