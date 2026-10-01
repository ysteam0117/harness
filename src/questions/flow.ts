import type { Answers } from "./answers.js";
import { matchesCondition, validateValue, type QuestionDefinition } from "./definitions.js";
import type { Prompter } from "./prompter.js";

type Step =
  | { kind: "skip" }
  | { kind: "auto"; value: string }
  | { kind: "given"; value: unknown }
  | { kind: "default"; value: string }
  | { kind: "none" }
  | { kind: "ask" };

/** 1つの質問をどう扱うかを決める（聞かない・自動で決める・回答済み・聞く） */
function plan(
  def: QuestionDefinition,
  answers: Readonly<Record<string, unknown>>,
  initial: Readonly<Record<string, unknown>>,
): Step {
  if (def.when && !matchesCondition(def.when, answers)) return { kind: "skip" };
  if (def.forced && matchesCondition(def.forced.when, answers)) {
    return { kind: "auto", value: def.forced.value };
  }
  if (def.kind === "select" && def.options?.length === 1) {
    return { kind: "auto", value: (def.options[0] as { value: string }).value };
  }
  if (def.id in initial && initial[def.id] !== undefined) {
    return { kind: "given", value: initial[def.id] };
  }
  if (def.interactive === false) {
    // 対話で聞かない質問（質問A〜G）：回答がなければ既定の値（なければ回答に入れない）
    return def.defaultValue !== undefined
      ? { kind: "default", value: def.defaultValue }
      : { kind: "none" };
  }
  return { kind: "ask" };
}

function labelOf(def: QuestionDefinition, value: string): string {
  return def.options?.find((o) => o.value === value)?.label ?? value;
}

/** 先に書かれていた回答（--answers）と、対話の回答との矛盾 */
export interface Conflict {
  /** 矛盾している質問 */
  id: string;
  /** 原因の質問（その回答で、表示の条件や自動の値が決まった） */
  cause: string;
  reason: string;
}

interface PassResult {
  answers: Record<string, unknown>;
  /** この回で聞いて答えを得た質問 */
  asked: Record<string, unknown>;
  conflicts: Conflict[];
}

async function pass(
  definitions: readonly QuestionDefinition[],
  prompter: Prompter,
  given: Readonly<Record<string, unknown>>,
): Promise<PassResult> {
  const answers: Record<string, unknown> = {};
  const asked: Record<string, unknown> = {};
  const conflicts: Conflict[] = [];
  const defaulted: string[] = [];
  const titleOf = (id: string) => definitions.find((d) => d.id === id)?.title ?? id;
  for (const def of definitions) {
    const step = plan(def, answers, given);
    const hasGiven = def.id in given && given[def.id] !== undefined;
    if (step.kind === "skip") {
      if (hasGiven && def.when) {
        conflicts.push({
          id: def.id,
          cause: def.when.id,
          reason: `「${titleOf(def.when.id)}」の回答により、この質問は聞かない質問になりましたが、先に書かれた回答があります`,
        });
      }
      continue;
    }
    if (step.kind === "none") continue;
    if (step.kind === "default") {
      answers[def.id] = step.value;
      defaulted.push(def.title);
      continue;
    }
    if (step.kind === "auto") {
      if (hasGiven && def.forced && given[def.id] !== step.value) {
        conflicts.push({
          id: def.id,
          cause: def.forced.when.id,
          reason: `「${titleOf(def.forced.when.id)}」の回答により「${labelOf(def, step.value)}」に決まりますが、先に書かれた回答は別の値です`,
        });
      }
      answers[def.id] = step.value;
      prompter.note(`${def.title}：${labelOf(def, step.value)}（自動で決定）`);
    } else if (step.kind === "given") {
      // アプリ名の形は、ここでは確かめない（整合性チェックのルール9で示す）
      const message = validateValue(def, step.value);
      if (message) throw new Error(`${def.id}：${message}`);
      answers[def.id] = step.value;
    } else if (def.kind === "text") {
      answers[def.id] = asked[def.id] = await prompter.text({
        id: def.id,
        message: def.title,
        ...(def.placeholder !== undefined ? { placeholder: def.placeholder } : {}),
        ...(def.validate ? { validate: def.validate } : {}),
      });
    } else if (def.kind === "select") {
      answers[def.id] = asked[def.id] = await prompter.select({
        id: def.id,
        message: def.title,
        options: def.options ?? [],
        ...(def.initialValue !== undefined ? { initialValue: def.initialValue } : {}),
      });
    } else {
      answers[def.id] = asked[def.id] = await prompter.multiselect({
        id: def.id,
        message: def.title,
        options: def.options ?? [],
        required: true,
      });
    }
  }
  if (defaulted.length > 0) {
    prompter.note(`${defaulted.join("・")}：未定（要件定義で決める）`);
  }
  return { answers, asked, conflicts };
}

/**
 * 定義の順に、条件に合う質問だけを聞く。
 * - 条件に合わない質問は飛ばし、回答に入れない
 * - 選択肢が1つ、または forced の条件に合う質問は、聞かずに決めて表示する
 * - initial に値がある質問は聞かない（値は定義で確かめ、誤っていれば例外）
 * - prompter が CancelledError を投げたら、そのまま投げる
 */
export async function runQuestions(
  definitions: readonly QuestionDefinition[],
  prompter: Prompter,
  initial: Partial<Answers> = {},
): Promise<Answers> {
  const { answers } = await pass(
    definitions,
    prompter,
    initial as Readonly<Record<string, unknown>>,
  );
  return answers as unknown as Answers;
}

/**
 * runQuestions に加えて、先に書かれた回答（--answers）と対話の回答の矛盾を、黙って消さない。
 * 矛盾が出たら、矛盾ごとに理由を表示し、どの質問を直すかを聞き（fix_question）、
 * 選んだ質問の回答だけを消して進め直す。矛盾がなくなるまで繰り返す。
 */
export async function runQuestionsResolvingConflicts(
  definitions: readonly QuestionDefinition[],
  prompter: Prompter,
  initial: Partial<Answers> = {},
): Promise<Answers> {
  const current: Record<string, unknown> = { ...initial };
  for (;;) {
    const { answers, asked, conflicts } = await pass(definitions, prompter, current);
    if (conflicts.length === 0) return answers as unknown as Answers;
    Object.assign(current, asked); // 対話で答えた内容は、聞き直さない
    const titleOf = (id: string) => definitions.find((d) => d.id === id)?.title ?? id;
    prompter.note(conflicts.map((c) => `${titleOf(c.id)}：${c.reason}`).join("\n"), "回答の矛盾");
    const candidates = [...new Set(conflicts.flatMap((c) => [c.cause, c.id]))];
    const target = await prompter.select({
      id: "fix_question",
      message: "どの質問の回答を直しますか（矛盾している質問を選ぶと、先に書かれた回答を捨てます）",
      options: candidates.map((id) => ({ value: id, label: titleOf(id) })),
    });
    delete current[target];
  }
}

/** initial で足りない（対話なら聞くことになる）質問の id を、定義の順に返す */
export function findMissing(
  definitions: readonly QuestionDefinition[],
  initial: Partial<Answers>,
): string[] {
  const given = initial as Readonly<Record<string, unknown>>;
  const answers: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const def of definitions) {
    const step = plan(def, answers, given);
    if (step.kind === "skip" || step.kind === "none") continue;
    if (step.kind === "ask") missing.push(def.id);
    else answers[def.id] = step.value;
  }
  return missing;
}
