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

const EXAMPLE_RE = /\{\{example:([^{}\n]*)\}\}/g;
const REGION_START_RE = /^[ \t]*\/\/ #region example:([A-Za-z0-9][A-Za-z0-9_-]*)[ \t]*$/;
const REGION_END_RE = /^[ \t]*\/\/ #endregion[ \t]*$/;

type Region = { name: string; lines: string[] };

/** コードのファイルから、「// #region example:<名前>」〜「// #endregion」の範囲を、書いてある順に取り出す。 */
function readRegions(content: string, where: string): Region[] {
  const regions: Region[] = [];
  let current: Region | undefined;
  for (const line of normalizeNewlines(content).split("\n")) {
    const start = REGION_START_RE.exec(line);
    if (start) {
      if (current) {
        throw new GenerateError(
          `${where}：範囲 ${current.name} が閉じる前に、次の範囲 ${start[1] ?? ""} が始まっています（範囲の中に範囲は書けません）`,
        );
      }
      current = { name: start[1] ?? "", lines: [] };
    } else if (current && REGION_END_RE.test(line)) {
      regions.push(current);
      current = undefined;
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    throw new GenerateError(
      `${where}：範囲 ${current.name} が「// #endregion」で閉じられていません`,
    );
  }
  return regions;
}

/** コードのファイルにある、例の範囲の名前の一覧（書いてある順） */
export function listExampleRegions(content: string): string[] {
  return readRegions(content, "例のファイル").map((region) => region.name);
}

/** 共通の字下げを取り除き、前後の空行を落とす。 */
function dedent(lines: string[]): string[] {
  const body = [...lines];
  while (body.length > 0 && (body[0] ?? "").trim() === "") body.shift();
  while (body.length > 0 && (body[body.length - 1] ?? "").trim() === "") body.pop();
  const indents = body
    .filter((l) => l.trim() !== "")
    .map((l) => /^[ \t]*/.exec(l)?.[0].length ?? 0);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  return body.map((l) => l.slice(Math.min(common, /^[ \t]*/.exec(l)?.[0].length ?? 0)));
}

/**
 * {{example:<生成するファイルの出力先のパス>#<範囲の名前>}} を、そのファイルの指定の範囲（```ts のコードブロック）に差し込む。
 * 出力の一覧（プロファイルの files の選択が終わった後のもの）から探すため、その生成で出ないファイルの例は差し込めない（エラー）。
 * 指示だけを1回だけ置き換え、差し込んだコードの中の {{ }} は展開しない。
 */
export function expandExamples(
  text: string,
  outputs: { path: string; content: string }[],
  fileName: string,
): string {
  return text.replace(EXAMPLE_RE, (_all, spec: string) => {
    const at = `${fileName}：{{example:${spec}}}`;
    const hash = spec.lastIndexOf("#");
    const filePath = hash < 0 ? "" : spec.slice(0, hash);
    const name = hash < 0 ? "" : spec.slice(hash + 1);
    if (
      filePath === "" ||
      name === "" ||
      filePath.startsWith("/") ||
      filePath.includes("\\") ||
      filePath.split("/").some((seg) => seg === "" || seg === "." || seg === "..")
    ) {
      throw new GenerateError(
        `${at} の書き方が誤っています。{{example:<出力先のパス>#<範囲の名前>}} の形で書いてください（パスに .. は使えません）`,
      );
    }
    const file = outputs.find((o) => o.path === filePath);
    if (!file) {
      throw new GenerateError(
        `${at} の引用先 ${filePath} が、この生成の出力にありません（出さないファイルの例は差し込めません）`,
      );
    }
    const found = readRegions(file.content, `${at}（${filePath}）`).filter((r) => r.name === name);
    if (found.length !== 1) {
      throw new GenerateError(
        `${at}：${filePath} に、範囲 ${name} が${found.length === 0 ? "ありません" : `${String(found.length)}つあります（1つだけにしてください）`}`,
      );
    }
    return `\`\`\`ts\n${dedent(found[0]?.lines ?? []).join("\n")}\n\`\`\``;
  });
}
