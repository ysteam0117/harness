import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { Answers } from "../questions/answers.js";
import { questionDefinitions, type QuestionDefinition } from "../questions/definitions.js";

export type Level = "error" | "warning" | "info";

/** 回答以外の事実（facts.ts が集める） */
export interface Facts {
  /** #33 が渡す。#32 では常に偽 */
  versions_newer_than_verified?: boolean;
  /** 足りない・古い・確かめられない道具の説明（空なら偽） */
  missing_tools?: string[];
  target_dir_not_empty?: boolean;
  invalid_app_name?: boolean;
}

export const FACT_NAMES = [
  "versions_newer_than_verified",
  "missing_tools",
  "target_dir_not_empty",
  "invalid_app_name",
] as const;

const LEVELS: readonly Level[] = ["error", "warning", "info"];

export type RuleCondition =
  | { answer: string; equals?: string; in?: string[]; notEquals?: string }
  | { fact: string; equals?: string | boolean; in?: (string | boolean)[]; truthy?: boolean };

export interface RuleWhen {
  all?: RuleCondition[];
  any?: RuleCondition[];
}

export interface Rule {
  id: string;
  level: Level;
  message: string;
  reason: string;
  /** 直すべき質問の id */
  fix: string[];
  when: RuleWhen;
}

export interface RuleHit {
  id: string;
  level: Level;
  message: string;
  reason: string;
  fix: string[];
}

export interface CheckResult {
  errors: RuleHit[];
  warnings: RuleHit[];
  infos: RuleHit[];
}

/** ルールのデータに問題があった。問題を1件ずつの日本語の文にして、まとめて持つ */
export class RulesError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`整合性チェックのルールに問題があります：\n${errors.map((e) => `- ${e}`).join("\n")}`);
    this.name = "RulesError";
    this.errors = errors;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: unknown): v is string | boolean =>
  typeof v === "string" || typeof v === "boolean";

function checkCondition(
  c: unknown,
  where: string,
  questionIds: Set<string>,
  errors: string[],
): RuleCondition | undefined {
  if (!isRecord(c)) {
    errors.push(`${where}：条件は連想配列で書いてください`);
    return undefined;
  }
  const hasAnswer = "answer" in c;
  const hasFact = "fact" in c;
  if (hasAnswer === hasFact) {
    errors.push(`${where}：条件には answer か fact のどちらか一方だけを書いてください`);
    return undefined;
  }
  const ops = hasAnswer ? ["equals", "in", "notEquals"] : ["equals", "in", "truthy"];
  const used = ops.filter((op) => op in c);
  if (used.length !== 1) {
    errors.push(`${where}：${ops.join("・")} のうち1つだけを書いてください`);
    return undefined;
  }
  let ok = true;
  if (hasAnswer) {
    if (typeof c.answer !== "string" || !questionIds.has(c.answer)) {
      errors.push(`${where}：知らない質問の id です：${String(c.answer)}`);
      ok = false;
    }
  } else if (typeof c.fact !== "string" || !(FACT_NAMES as readonly string[]).includes(c.fact)) {
    errors.push(`${where}：知らない事実（fact）です：${String(c.fact)}`);
    ok = false;
  }
  const op = used[0] as string;
  const value = c[op];
  if (op === "in") {
    if (!Array.isArray(value) || !value.every(isScalar)) {
      errors.push(`${where}：in は値の一覧（配列）で書いてください`);
      ok = false;
    }
  } else if (op === "truthy") {
    if (typeof value !== "boolean") {
      errors.push(`${where}：truthy は true か false で書いてください`);
      ok = false;
    }
  } else if (hasAnswer ? typeof value !== "string" : !isScalar(value)) {
    errors.push(`${where}：${op} の値の型が正しくありません`);
    ok = false;
  }
  return ok ? (c as unknown as RuleCondition) : undefined;
}

/** ルールの YAML を読み、形を検証する。問題はまとめて RulesError にする */
export function parseRules(
  yamlText: string,
  definitions: readonly QuestionDefinition[] = questionDefinitions,
): Rule[] {
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch (e) {
    throw new RulesError([`YAML として読めません：${e instanceof Error ? e.message : String(e)}`]);
  }
  if (!Array.isArray(doc)) {
    throw new RulesError(["ルールの一覧（配列）で書いてください"]);
  }
  const questionIds = new Set(definitions.map((d) => d.id));
  const errors: string[] = [];
  const rules: Rule[] = [];
  const seen = new Set<string>();

  doc.forEach((item: unknown, index) => {
    const label = isRecord(item) && typeof item.id === "string" ? item.id : `${index + 1}件目`;
    const where = `ルール ${label}`;
    if (!isRecord(item)) {
      errors.push(`${where}：連想配列で書いてください`);
      return;
    }
    const before = errors.length;
    if (typeof item.id !== "string" || item.id === "") {
      errors.push(`${where}：id（文字列）が必要です`);
    } else if (seen.has(item.id)) {
      errors.push(`${where}：id が重複しています`);
    } else {
      seen.add(item.id);
    }
    if (!LEVELS.includes(item.level as Level)) {
      errors.push(`${where}：知らない level です：${String(item.level)}（${LEVELS.join("・")}）`);
    }
    for (const key of ["message", "reason"] as const) {
      if (typeof item[key] !== "string" || item[key] === "") {
        errors.push(`${where}：${key}（文字列）が必要です`);
      }
    }
    let fix: string[] = [];
    if (item.fix !== undefined) {
      if (Array.isArray(item.fix) && item.fix.every((q) => typeof q === "string")) {
        fix = item.fix as string[];
        for (const q of fix) {
          if (!questionIds.has(q))
            errors.push(`${where}：fix に知らない質問の id があります：${q}`);
        }
      } else {
        errors.push(`${where}：fix は質問の id の一覧（配列）で書いてください`);
      }
    }
    const when = item.when;
    const whenOut: RuleWhen = {};
    if (!isRecord(when)) {
      errors.push(`${where}：when（all か any）が必要です`);
    } else {
      const keys = ["all", "any"].filter((k) => k in when);
      if (keys.length !== 1 || Object.keys(when).length !== 1) {
        errors.push(`${where}：when には all か any のどちらか一方だけを書いてください`);
      } else {
        const key = keys[0] as "all" | "any";
        const list = when[key];
        if (!Array.isArray(list) || list.length === 0) {
          errors.push(`${where}：when.${key} は条件の一覧（1つ以上）で書いてください`);
        } else {
          const conds = list.map((c: unknown) =>
            checkCondition(c, `${where} の条件`, questionIds, errors),
          );
          if (conds.every((c) => c !== undefined)) whenOut[key] = conds as RuleCondition[];
        }
      }
    }
    if (errors.length === before) {
      rules.push({
        id: item.id as string,
        level: item.level as Level,
        message: item.message as string,
        reason: item.reason as string,
        fix,
        when: whenOut,
      });
    }
  });

  if (errors.length > 0) throw new RulesError(errors);
  return rules;
}

/** data/consistency-rules.yaml を読む。場所は作業中のフォルダに依存しない（src からも dist からも2つ上） */
export function loadRules(): Rule[] {
  const file = fileURLToPath(new URL("../../data/consistency-rules.yaml", import.meta.url));
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new RulesError([
      `ルールのファイルを読めません：${file}（${e instanceof Error ? e.message : String(e)}）`,
    ]);
  }
  return parseRules(text);
}

function matchesCond(
  c: RuleCondition,
  answers: Readonly<Record<string, unknown>>,
  facts: Readonly<Record<string, unknown>>,
): boolean {
  if ("answer" in c) {
    const v = answers[c.answer];
    if (typeof v !== "string") return false;
    if (c.equals !== undefined) return v === c.equals;
    if (c.in !== undefined) return c.in.includes(v);
    if (c.notEquals !== undefined) return v !== c.notEquals;
    return false;
  }
  const v = facts[c.fact];
  if (c.truthy !== undefined) {
    const truthy = Array.isArray(v) ? v.length > 0 : Boolean(v);
    return truthy === c.truthy;
  }
  if (c.equals !== undefined) return v === c.equals;
  if (c.in !== undefined) {
    return Array.isArray(v)
      ? v.some((x) => (c.in as unknown[]).includes(x))
      : (c.in as unknown[]).includes(v);
  }
  return false;
}

/** ルールの並びの順に判定し、エラー・警告・情報に分けて返す */
export function evaluateRules(
  rules: readonly Rule[],
  answers: Partial<Answers>,
  facts: Facts,
): CheckResult {
  const result: CheckResult = { errors: [], warnings: [], infos: [] };
  const a = answers as Readonly<Record<string, unknown>>;
  const f = facts as Readonly<Record<string, unknown>>;
  for (const rule of rules) {
    const hit =
      rule.when.all !== undefined
        ? rule.when.all.every((c) => matchesCond(c, a, f))
        : (rule.when.any ?? []).some((c) => matchesCond(c, a, f));
    if (!hit) continue;
    const entry: RuleHit = {
      id: rule.id,
      level: rule.level,
      message: rule.message,
      reason: rule.reason,
      fix: [...rule.fix],
    };
    if (rule.level === "error") result.errors.push(entry);
    else if (rule.level === "warning") result.warnings.push(entry);
    else result.infos.push(entry);
  }
  return result;
}
