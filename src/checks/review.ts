import type { Answers } from "../questions/answers.js";
import {
  questionDefinitions,
  type Condition,
  type QuestionDefinition,
} from "../questions/definitions.js";
import { runQuestions } from "../questions/flow.js";
import type { Prompter } from "../questions/prompter.js";
import { evaluateRules, type CheckResult, type Facts, type Rule, type RuleHit } from "./rules.js";

/** 警告を承知で続行した内容（#34 が ADR に書く） */
export interface AcceptedWarning {
  id: string;
  message: string;
  reason: string;
}

export interface ReviewOptions {
  definitions?: readonly QuestionDefinition[];
  rules: Rule[];
  prompter: Prompter;
  /** runQuestions の結果 */
  answers: Answers;
  /** 聞き直すたびに呼び直す（生成先はアプリ名から決め直す） */
  collectFacts: (answers: Answers) => Promise<Facts>;
  /** false のときは prompter を一度も使わない */
  interactive: boolean;
  /** --answers の accepted_warnings */
  acceptedWarningIds?: string[];
  /** 警告の承知を確かめる前に表示する詳細（なければ表示しない） */
  detailOf?: (hit: RuleHit) => string | undefined;
}

export type ReviewOutcome =
  | { status: "ok"; answers: Answers; result: CheckResult; acceptedWarnings: AcceptedWarning[] }
  /** 対話しないときに、エラーがある（対話では、エラーを直せない場合も） */
  | { status: "errors"; answers: Answers; result: CheckResult }
  /** 対話しないときに、承知していない警告がある */
  | { status: "warnings_not_accepted"; answers: Answers; result: CheckResult }
  /** 対話で、警告の承知を断った */
  | { status: "declined"; answers: Answers; result: CheckResult };

function refersTo(cond: Condition | undefined, id: string): boolean {
  return cond?.id === id;
}

/** 質問 id の回答で、表示の条件や自動の値が決まる質問（依存する質問）を、定義から自動で求める（間接的なものも含む） */
export function dependentsOf(definitions: readonly QuestionDefinition[], id: string): string[] {
  const found = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const def of definitions) {
      if (found.has(def.id) || def.id === id) continue;
      if (refersTo(def.when, current) || refersTo(def.forced?.when, current)) {
        found.add(def.id);
        queue.push(def.id);
      }
    }
  }
  return [...found];
}

function toAccepted(hit: RuleHit): AcceptedWarning {
  return { id: hit.id, message: hit.message, reason: hit.reason };
}

const describeHit = (h: RuleHit): string => `・${h.message}（理由：${h.reason}）`;

/** チェック → 警告の承知 → エラーの聞き直し */
export async function reviewAnswers(opts: ReviewOptions): Promise<ReviewOutcome> {
  const definitions = opts.definitions ?? questionDefinitions;
  const titleOf = (id: string) => definitions.find((d) => d.id === id)?.title ?? id;
  const accepted = new Set(opts.acceptedWarningIds ?? []);
  let answers = opts.answers;

  for (;;) {
    const facts = await opts.collectFacts(answers);
    const result = evaluateRules(opts.rules, answers, facts);

    if (result.errors.length > 0) {
      const candidates = [...new Set(result.errors.flatMap((h) => h.fix))];
      if (!opts.interactive || candidates.length === 0) {
        return { status: "errors", answers, result };
      }
      opts.prompter.note(result.errors.map(describeHit).join("\n"), "エラー");
      const target = await opts.prompter.select({
        id: "fix_question",
        message: "どの質問の回答を直しますか",
        options: candidates.map((id) => ({ value: id, label: titleOf(id) })),
      });
      const next: Record<string, unknown> = { ...answers };
      for (const id of [target, ...dependentsOf(definitions, target)]) delete next[id];
      answers = await runQuestions(definitions, opts.prompter, next as Partial<Answers>);
      continue;
    }

    if (!opts.interactive) {
      if (result.warnings.some((h) => !accepted.has(h.id))) {
        return { status: "warnings_not_accepted", answers, result };
      }
      return { status: "ok", answers, result, acceptedWarnings: result.warnings.map(toAccepted) };
    }

    const acceptedWarnings: AcceptedWarning[] = [];
    for (const hit of result.warnings) {
      if (!accepted.has(hit.id)) {
        const detail = opts.detailOf?.(hit);
        if (detail) opts.prompter.note(detail, hit.message);
        const yes = await opts.prompter.confirm({
          id: `accept_warning:${hit.id}`,
          message: `警告：${hit.message}\n理由：${hit.reason}\nこの警告を承知して続けますか`,
          initialValue: false,
        });
        if (!yes) return { status: "declined", answers, result };
      }
      acceptedWarnings.push(toAccepted(hit));
    }
    return { status: "ok", answers, result, acceptedWarnings };
  }
}
