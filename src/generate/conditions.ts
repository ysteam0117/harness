import { matchesCondition, questionDefinitions } from "../questions/definitions.js";
import { GenerateError } from "./errors.js";
import { isPlainObject } from "./data.js";

/** 回答の条件（#32 の書き方）。answer に質問の id と、equals・in・notEquals のどれか1つ */
export interface AnswerWhen {
  answer: string;
  equals?: string;
  in?: string[];
  notEquals?: string;
}

/** 条件の組み合わせ（#72）。all のすべての条件に合うときだけ合う。all の中に all は書けない（入れ子は1段もない） */
export interface AllWhen {
  all: AnswerWhen[];
}

export type When = AnswerWhen | AllWhen;

const OPERATORS = ["equals", "in", "notEquals"] as const;

/** all のない answer 条件を検証して読む */
function parseAnswerWhen(raw: unknown, where: string): AnswerWhen {
  if (!isPlainObject(raw)) {
    throw new GenerateError(`${where}：when は「answer: 質問の id」の形で書いてください`);
  }
  const answer = raw["answer"];
  if (typeof answer !== "string" || !questionDefinitions.some((d) => d.id === answer)) {
    throw new GenerateError(
      `${where}：when の answer ${JSON.stringify(answer)} は、知らない質問の id です`,
    );
  }
  const used = OPERATORS.filter((op) => raw[op] !== undefined);
  const extra = Object.keys(raw).filter(
    (k) => k !== "answer" && !(OPERATORS as readonly string[]).includes(k),
  );
  if (used.length !== 1 || extra.length > 0) {
    throw new GenerateError(
      `${where}：when には、answer と、equals・in・notEquals のどれか1つだけを書いてください`,
    );
  }
  const op = used[0] as (typeof OPERATORS)[number];
  const value = raw[op];
  const when: AnswerWhen = { answer };
  if (op === "in") {
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
      throw new GenerateError(`${where}：when の in は文字列の一覧で書いてください`);
    }
    when.in = value as string[];
  } else {
    if (typeof value !== "string") {
      throw new GenerateError(`${where}：when の ${op} は文字列で書いてください`);
    }
    when[op] = value;
  }
  return when;
}

/** data/ の when を検証して読む。誤りは、場所（where）を示した GenerateError */
export function parseWhen(raw: unknown, where: string): When {
  if (isPlainObject(raw) && raw["all"] !== undefined) {
    if (Object.keys(raw).length !== 1) {
      throw new GenerateError(
        `${where}：when の all は、answer・equals・in・notEquals と同時に書けません（all だけを書いてください）`,
      );
    }
    const list = raw["all"];
    if (!Array.isArray(list) || list.length === 0) {
      throw new GenerateError(`${where}：when の all は、条件を1つ以上並べた一覧で書いてください`);
    }
    return {
      all: list.map((item, index) => {
        const at = `${where}：all の ${index + 1} 番目`;
        if (isPlainObject(item) && item["all"] !== undefined) {
          throw new GenerateError(`${at}：all の中に all は書けません（入れ子は使えません）`);
        }
        return parseAnswerWhen(item, at);
      }),
    };
  }
  return parseAnswerWhen(raw, where);
}

function answerMatches(when: AnswerWhen, answers: object): boolean {
  return matchesCondition(
    {
      id: when.answer,
      ...(when.equals !== undefined ? { equals: when.equals } : {}),
      ...(when.in !== undefined ? { in: when.in } : {}),
      ...(when.notEquals !== undefined ? { notEquals: when.notEquals } : {}),
    },
    answers as Readonly<Record<string, unknown>>,
  );
}

/** 条件に合うか。条件がなければ常に合う。all は、すべてに合うときだけ合う */
export function whenMatches(when: When | undefined, answers: object): boolean {
  if (when === undefined) return true;
  if ("all" in when) return when.all.every((w) => answerMatches(w, answers));
  return answerMatches(when, answers);
}
