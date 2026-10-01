import { readFileSync } from "node:fs";
import { Command } from "commander";
import { collectFacts } from "../checks/facts.js";
import { reviewAnswers, type AcceptedWarning } from "../checks/review.js";
import {
  loadRules,
  RulesError,
  type CheckResult,
  type Facts,
  type RuleHit,
} from "../checks/rules.js";
import type { ToolStatus } from "../checks/tools.js";
import { AnswersError, parseAnswersYaml, type Answers } from "../questions/answers.js";
import { questionDefinitions } from "../questions/definitions.js";
import { findMissing, runQuestionsResolvingConflicts } from "../questions/flow.js";
import { CancelledError, createClackPrompter, type Prompter } from "../questions/prompter.js";

export interface CreateDeps {
  /** 入力と表示（note）の窓口。回答の一覧・チェックの結果は prompter.note で表示する */
  prompter: Prompter;
  /** 生成先の基準（./<app_name>） */
  cwd: string;
  /** 標準入力・出力が端末か */
  interactive: boolean;
  /** エラー・終了時のメッセージ */
  stderr: (text: string) => void;
  /** 手元の道具の確かめの差し替え（テスト用） */
  checkTools?: () => Promise<ToolStatus[]>;
}

export interface CreateOptions {
  /** --answers のファイル */
  answers?: string;
  /** --yes：最後の確認を省く */
  yes?: boolean;
}

export interface CreateOutcome {
  exitCode: number;
  answers?: Answers;
  acceptedWarnings?: AcceptedWarning[];
  result?: CheckResult;
}

const STUB_MESSAGE = "生成は Issue #34 で実装予定です";
const CANCEL_MESSAGE = "中断しました。ファイルは作成していません。";

function titleOf(id: string): string {
  return questionDefinitions.find((d) => d.id === id)?.title ?? id;
}

/** 回答の一覧（日本語の見出しと値） */
function formatAnswers(answers: Answers): string {
  const record = answers as unknown as Record<string, unknown>;
  const lines: string[] = [];
  for (const def of questionDefinitions) {
    const value = record[def.id];
    if (value === undefined) continue;
    const label = (v: unknown): string =>
      def.options?.find((o) => o.value === v)?.label ?? String(v);
    const shown = Array.isArray(value) ? value.map(label).join("、") : label(value);
    lines.push(`${def.title}：${shown}`);
  }
  return lines.join("\n");
}

/** ルールに当たった内容。ルール8（手元の道具）には、足りないものと導入の案内を添える */
function formatHit(hit: RuleHit, facts: Facts | undefined): string {
  const lines = [`[${hit.id}] ${hit.message}`, `    理由：${hit.reason}`];
  if (hit.id === "missing-tools") {
    for (const detail of facts?.missing_tools ?? []) lines.push(`    - ${detail}`);
  }
  return lines.join("\n");
}

function formatHits(hits: RuleHit[], facts: Facts | undefined): string {
  return hits.map((h) => formatHit(h, facts)).join("\n");
}

function formatResult(result: CheckResult, facts: Facts | undefined): string {
  const sections: string[] = [];
  if (result.errors.length > 0) sections.push(`エラー\n${formatHits(result.errors, facts)}`);
  if (result.warnings.length > 0)
    sections.push(`警告（承知して続行）\n${formatHits(result.warnings, facts)}`);
  if (result.infos.length > 0) sections.push(`情報\n${formatHits(result.infos, facts)}`);
  return sections.length > 0 ? sections.join("\n\n") : "問題は見つかりませんでした";
}

function readAnswersFile(
  file: string,
  deps: CreateDeps,
): { answers: Partial<Answers>; acceptedWarnings: string[] } | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    deps.stderr(
      `エラー: 回答ファイルを読めません：${file}（${e instanceof Error ? e.message : String(e)}）\n`,
    );
    return undefined;
  }
  try {
    return parseAnswersYaml(text);
  } catch (e) {
    if (!(e instanceof AnswersError)) throw e;
    deps.stderr(`エラー: 回答ファイルに問題があります（${file}）\n`);
    for (const message of e.errors) deps.stderr(`  - ${message}\n`);
    return undefined;
  }
}

/** 質問 → チェック → 回答の一覧とチェックの結果の表示 → 確認。生成は #34 で実装する */
export async function runCreate(options: CreateOptions, deps: CreateDeps): Promise<CreateOutcome> {
  try {
    return await run(options, deps);
  } catch (e) {
    if (e instanceof CancelledError) {
      deps.stderr(`${CANCEL_MESSAGE}\n`);
      return { exitCode: 130 };
    }
    throw e;
  }
}

async function run(options: CreateOptions, deps: CreateDeps): Promise<CreateOutcome> {
  let initial: Partial<Answers> = {};
  let acceptedWarningIds: string[] = [];
  if (options.answers !== undefined) {
    const parsed = readAnswersFile(options.answers, deps);
    if (!parsed) return { exitCode: 1 };
    initial = parsed.answers;
    acceptedWarningIds = parsed.acceptedWarnings;
  }

  let rules;
  try {
    rules = loadRules();
  } catch (e) {
    if (!(e instanceof RulesError)) throw e;
    deps.stderr(`エラー: ${e.message}\n`);
    return { exitCode: 1 };
  }
  const unknownIds = acceptedWarningIds.filter((id) => !rules.some((r) => r.id === id));
  if (unknownIds.length > 0) {
    deps.stderr(
      `エラー: accepted_warnings に、知らないルールの id があります：${unknownIds.join("、")}\n`,
    );
    return { exitCode: 1 };
  }

  if (!deps.interactive) {
    const missing = findMissing(questionDefinitions, initial);
    if (missing.length > 0) {
      deps.stderr("エラー: 端末で実行していないため質問できません。次の回答が足りません。\n");
      for (const id of missing) deps.stderr(`  - ${id}（${titleOf(id)}）\n`);
      deps.stderr("--answers で回答ファイルを指定してください。\n");
      return { exitCode: 1 };
    }
  }

  const answers = await runQuestionsResolvingConflicts(questionDefinitions, deps.prompter, initial);

  let lastFacts: Facts | undefined;
  const outcome = await reviewAnswers({
    rules,
    prompter: deps.prompter,
    answers,
    collectFacts: async (a) => {
      lastFacts = await collectFacts(a, {
        cwd: deps.cwd,
        ...(deps.checkTools ? { checkTools: deps.checkTools } : {}),
      });
      return lastFacts;
    },
    interactive: deps.interactive,
    acceptedWarningIds,
    detailOf: (hit) =>
      hit.id === "missing-tools" && lastFacts?.missing_tools?.length
        ? lastFacts.missing_tools.map((d) => `- ${d}`).join("\n")
        : undefined,
  });

  switch (outcome.status) {
    case "errors": {
      deps.stderr("エラー: 整合性チェックでエラーが見つかりました。\n");
      deps.stderr(`${formatHits(outcome.result.errors, lastFacts)}\n`);
      return { exitCode: 1, answers: outcome.answers, result: outcome.result };
    }
    case "warnings_not_accepted": {
      const pending = outcome.result.warnings.filter((h) => !acceptedWarningIds.includes(h.id));
      deps.stderr("エラー: 承知していない警告があります。\n");
      deps.stderr(`${formatHits(pending, lastFacts)}\n`);
      deps.stderr(
        `承知して続けるには、回答ファイルの accepted_warnings に、ルールの id（${pending.map((h) => h.id).join("、")}）を書いてください。\n`,
      );
      return { exitCode: 1, answers: outcome.answers, result: outcome.result };
    }
    case "declined": {
      deps.prompter.note("警告を承知しなかったため、何もせずに終了します。");
      return { exitCode: 0, answers: outcome.answers, result: outcome.result };
    }
    case "ok":
      break;
  }

  deps.prompter.note(formatAnswers(outcome.answers), "回答の一覧");
  deps.prompter.note(formatResult(outcome.result, lastFacts), "整合性チェックの結果");
  const done = {
    answers: outcome.answers,
    acceptedWarnings: outcome.acceptedWarnings,
    result: outcome.result,
  };

  if (!options.yes) {
    if (!deps.interactive) {
      deps.stderr(
        "エラー: 端末で実行していないため、確認できません。確認を省くには --yes を付けてください。\n",
      );
      return { exitCode: 1, ...done };
    }
    const go = await deps.prompter.confirm({
      id: "confirm_generate",
      message: "この内容で生成しますか",
    });
    if (!go) return { exitCode: 0, ...done };
  }

  deps.stderr(`${STUB_MESSAGE}\n`);
  return { exitCode: 1, ...done };
}

export function createCommand(deps: Partial<CreateDeps> = {}): Command {
  return new Command("create")
    .description("質問に答えて、プロジェクトを生成する")
    .option("--answers <file>", "質問への回答をまとめたファイルを指定する")
    .option("--yes", "最後の確認（この内容で生成しますか）を省く")
    .action(async (options: CreateOptions) => {
      const outcome = await runCreate(options, {
        prompter: deps.prompter ?? createClackPrompter(),
        cwd: deps.cwd ?? process.cwd(),
        interactive: deps.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
        stderr: deps.stderr ?? ((text) => void process.stderr.write(text)),
        ...(deps.checkTools ? { checkTools: deps.checkTools } : {}),
      });
      process.exitCode = outcome.exitCode;
    });
}
