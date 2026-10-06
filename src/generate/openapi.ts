import { readFileSync } from "node:fs";
import path from "node:path";
import type { Answers } from "../questions/answers.js";
import { whenMatches, type When } from "./conditions.js";
import { GenerateError } from "./errors.js";
import { renderTemplate } from "./template.js";

/** API の仕様書（docs/api/openapi.json）の部品。実際に組み込まれるルートの分だけを、重ねて書く（R4） */
const FRAGMENTS: { source: string; when?: When }[] = [
  { source: "docs/api/openapi.base.json" },
  // /api/sample-users（data-access/drizzle が出す。DB ありのとき）
  { source: "docs/api/openapi.sample-users.json", when: { answer: "database", notEquals: "none" } },
  // /api/auth/me・/api/auth/logout（auth/session が出す。認証ありのとき）
  { source: "docs/api/openapi.auth.json", when: { answer: "auth", in: ["app", "oidc", "both"] } },
];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 部品を深く重ねる。同じ場所に違う値があれば、部品の誤り */
function mergeFragment(target: Json, source: Json, where: string, location = ""): void {
  for (const [key, value] of Object.entries(source)) {
    const here = location === "" ? key : `${location}.${key}`;
    const existing = target[key];
    if (existing === undefined) {
      target[key] = value;
    } else if (isObject(existing) && isObject(value)) {
      mergeFragment(existing, value, where, here);
    } else {
      throw new GenerateError(`${where}：${here} が、ほかの部品と重なっています`);
    }
  }
}

/** docs/api/openapi.json の中身。回答に合う部品を重ね、JSON（末尾に改行）にする */
export function buildOpenApi(input: {
  templatesDir: string;
  answers: Answers;
  values: Record<string, string>;
}): string {
  const spec: Json = {};
  for (const fragment of FRAGMENTS) {
    if (!whenMatches(fragment.when, input.answers)) continue;
    let text: string;
    try {
      text = readFileSync(path.join(input.templatesDir, ...fragment.source.split("/")), "utf8");
    } catch (e) {
      throw new GenerateError(`必須のひな形 ${fragment.source} がありません`, { cause: e });
    }
    const rendered = renderTemplate(text, input.values, {
      templatesDir: input.templatesDir,
      fileName: fragment.source,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(rendered);
    } catch (e) {
      throw new GenerateError(`${fragment.source} を JSON として読めません`, { cause: e });
    }
    if (!isObject(parsed))
      throw new GenerateError(`${fragment.source}：オブジェクトで書いてください`);
    mergeFragment(spec, parsed, fragment.source);
  }
  return `${JSON.stringify(spec, null, 2)}\n`;
}
