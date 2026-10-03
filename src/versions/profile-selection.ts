import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { GenerateError } from "../generate/errors.js";
import { loadProfile } from "../generate/profile.js";
import { findTemplatesDir } from "../generate/templates-dir.js";
import type { Answers } from "../questions/answers.js";
import { matchesCondition, questionDefinitions } from "../questions/definitions.js";

export interface SelectionRule {
  /** "<分類>/<id>" */
  profile: string;
  /** 書かなければ常に選ぶ */
  when?: { answer: string; equals?: string; in?: string[]; notEquals?: string };
}

const DATA_FILE = "data/profile-selection.yaml";
const OPERATORS = ["equals", "in", "notEquals"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** data/profile-selection.yaml の中身を検証して読む。誤りは GenerateError（日本語） */
export function parseProfileSelection(
  text: string,
  templatesDir: string = findTemplatesDir(),
): SelectionRule[] {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    throw new GenerateError(`${DATA_FILE} を YAML として読めません：${(e as Error).message}`, {
      cause: e,
    });
  }
  if (!Array.isArray(doc)) {
    throw new GenerateError(`${DATA_FILE}：「- profile: <分類>/<id>」の並びで書いてください`);
  }
  const knownQuestions = new Set(questionDefinitions.map((d) => d.id));
  return doc.map((item, index): SelectionRule => {
    const at = `${DATA_FILE} の ${index + 1} 番目`;
    if (!isPlainObject(item)) throw new GenerateError(`${at}：「項目: 値」の形で書いてください`);
    for (const field of Object.keys(item)) {
      if (field !== "profile" && field !== "when") {
        throw new GenerateError(`${at}：知らない項目 ${field} があります（書き間違いの可能性）`);
      }
    }
    const profile = item["profile"];
    if (typeof profile !== "string" || profile === "") {
      throw new GenerateError(`${at}：項目 profile は、"<分類>/<id>" の文字列で必ず書いてください`);
    }
    // プロファイルがなければ、loadProfile が名前を示した GenerateError を投げる
    loadProfile(templatesDir, profile);

    const rule: SelectionRule = { profile };
    if (item["when"] !== undefined) {
      const when = item["when"];
      if (!isPlainObject(when)) {
        throw new GenerateError(
          `${at}（${profile}）：項目 when は「answer: 質問の id」の形で書いてください`,
        );
      }
      const answer = when["answer"];
      if (typeof answer !== "string" || !knownQuestions.has(answer)) {
        throw new GenerateError(
          `${at}（${profile}）：when の answer ${JSON.stringify(answer)} は、知らない質問の id です`,
        );
      }
      const used = OPERATORS.filter((op) => when[op] !== undefined);
      const extra = Object.keys(when).filter(
        (k) => k !== "answer" && !(OPERATORS as readonly string[]).includes(k),
      );
      if (used.length !== 1 || extra.length > 0) {
        throw new GenerateError(
          `${at}（${profile}）：when には、answer と、equals・in・notEquals のどれか1つだけを書いてください`,
        );
      }
      const op = used[0] as (typeof OPERATORS)[number];
      const value = when[op];
      const cond: NonNullable<SelectionRule["when"]> = { answer };
      if (op === "in") {
        if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
          throw new GenerateError(`${at}（${profile}）：when の in は文字列の一覧で書いてください`);
        }
        cond.in = value as string[];
      } else {
        if (typeof value !== "string") {
          throw new GenerateError(`${at}（${profile}）：when の ${op} は文字列で書いてください`);
        }
        cond[op] = value;
      }
      rule.when = cond;
    }
    return rule;
  });
}

let defaultRules: SelectionRule[] | undefined;

function loadDefaultRules(): SelectionRule[] {
  if (defaultRules) return defaultRules;
  const file = fileURLToPath(new URL("../../data/profile-selection.yaml", import.meta.url));
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new GenerateError(`${DATA_FILE} を読めません：${file}（${(e as Error).message}）`, {
      cause: e,
    });
  }
  defaultRules = parseProfileSelection(text);
  return defaultRules;
}

/** 回答から、使うプロファイルの key を（書いた順に・重複なしで）決める */
export function selectProfiles(
  answers: Partial<Answers>,
  rules: SelectionRule[] = loadDefaultRules(),
): string[] {
  const record = answers as Readonly<Record<string, unknown>>;
  const keys: string[] = [];
  for (const rule of rules) {
    const matched =
      rule.when === undefined ||
      matchesCondition(
        {
          id: rule.when.answer,
          ...(rule.when.equals !== undefined ? { equals: rule.when.equals } : {}),
          ...(rule.when.in !== undefined ? { in: rule.when.in } : {}),
          ...(rule.when.notEquals !== undefined ? { notEquals: rule.when.notEquals } : {}),
        },
        record,
      );
    if (matched && !keys.includes(rule.profile)) keys.push(rule.profile);
  }
  return keys;
}
