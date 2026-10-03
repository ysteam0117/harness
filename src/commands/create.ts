import { readFileSync } from "node:fs";
import { Command } from "commander";
import { collectFacts } from "../checks/facts.js";
import { reviewAnswers, type AcceptedWarning, type ReviewOutcome } from "../checks/review.js";
import {
  loadRules,
  RulesError,
  type CheckResult,
  type Facts,
  type RuleHit,
} from "../checks/rules.js";
import type { ToolStatus } from "../checks/tools.js";
import { GenerateError } from "../generate/errors.js";
import { resolveProfiles } from "../generate/profile.js";
import { findTemplatesDir } from "../generate/templates-dir.js";
import {
  AnswersError,
  parseAnswersYaml,
  type Answers,
  type ParsedAnswers,
} from "../questions/answers.js";
import { questionDefinitions } from "../questions/definitions.js";
import { findMissing, runQuestionsResolvingConflicts } from "../questions/flow.js";
import { CancelledError, createClackPrompter, type Prompter } from "../questions/prompter.js";
import { chooseVersions, type VersionResult } from "../versions/choose.js";
import { selectProfiles } from "../versions/profile-selection.js";
import { targetsFor, type Target } from "../versions/targets.js";
import { alignTable, shortReason } from "../versions/table.js";
import { renderTechStack } from "../versions/tech-stack.js";

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
  /** バージョンの調査（npm・Node.js の登録情報の取得）の差し替え（テスト用）。既定は globalThis.fetch */
  fetch?: typeof fetch;
  /** 調べた日の差し替え（テスト用）。既定は現在の日時 */
  now?: () => Date;
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
  /** 技術ごとに採用したバージョンと選定理由（F-19） */
  versions?: VersionResult;
  /** docs/tech-stack.md の中身。ファイルへの保存は Issue #34 */
  techStack?: string;
}

const RULE7 = "version-newer-than-verified";
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

/** 採用するバージョンの表（確認の一覧に加える） */
function formatVersions(result: VersionResult): string {
  const rows = result.entries.map((e) => [
    e.name === "node" ? "node（Node.js）" : e.name,
    e.version,
    shortReason(e),
  ]);
  return alignTable(["パッケージ", "採用", "理由"], rows).join("\n");
}

/** ルール7の警告に添える、該当するパッケージと、大きな版が違うもの */
function formatNewerDetail(result: VersionResult): string | undefined {
  const newer = result.entries.filter((e) => e.newerThanVerified);
  if (newer.length === 0) return undefined;
  return newer
    .map(
      (e) =>
        `- ${e.name}：検証済み ${e.verified ?? "なし"} → 採用 ${e.version}${e.majorDiffers ? "（大きな版が違い、ハーネスで動作を確認していません）" : ""}`,
    )
    .join("\n");
}

/** バージョンの調査で進めなくなった（取得できない・検証済みのない版を戻せない） */
class VersionsStopped extends Error {}

function readAnswersFile(file: string, deps: CreateDeps): ParsedAnswers | undefined {
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
  let parsedExtra: ParsedAnswers | undefined;
  if (options.answers !== undefined) {
    const parsed = readAnswersFile(options.answers, deps);
    if (!parsed) return { exitCode: 1 };
    initial = parsed.answers;
    acceptedWarningIds = parsed.acceptedWarnings;
    parsedExtra = parsed;
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

  // バージョンの調査と選択（質問の後・整合性チェックの前）
  // 質問で決まった version_policy と、--answers の versions の矛盾は、調べ始める前に示す
  const latestNames = Object.entries(parsedExtra?.versions ?? {})
    .filter(([, choice]) => choice === "latest")
    .map(([name]) => name);
  if (answers.version_policy === "verified" && latestNames.length > 0) {
    deps.stderr(
      `エラー: version_policy が verified（検証済み）なのに、回答ファイルの versions で latest（最新の安定版）を選んでいます：${latestNames.join("、")}（どちらかを直してください）
`,
    );
    return { exitCode: 1 };
  }
  let targets: Target[];
  try {
    targets = targetsFor(answers);
  } catch (e) {
    if (!(e instanceof GenerateError)) throw e;
    deps.stderr(`エラー: ${e.message}\n`);
    return { exitCode: 1 };
  }
  const unknownNames = Object.keys(parsedExtra?.versions ?? {}).filter(
    (name) => !targets.some((t) => t.name === name),
  );
  if (unknownNames.length > 0) {
    deps.stderr(
      `エラー: versions に、調べる対象にないパッケージがあります：${unknownNames.join("、")}（対象は回答で決まります。対象：${targets.map((t) => t.name).join("、")}）\n`,
    );
    return { exitCode: 1 };
  }

  const fetchFn = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  const survey = async (
    forTargets: Target[],
    a: Answers,
    keep?: VersionResult,
  ): Promise<VersionResult> => {
    const out = await chooseVersions({
      targets: forTargets,
      policy: a.version_policy,
      interactive: deps.interactive,
      prompter: deps.prompter,
      fetch: fetchFn,
      now: now(),
      ...(parsedExtra?.versions ? { versions: parsedExtra.versions } : {}),
      ...(parsedExtra?.versionsOffline ? { versionsOffline: parsedExtra.versionsOffline } : {}),
      ...(keep ? { keep: keep.entries } : {}),
    });
    if (out.status === "stopped") throw new VersionsStopped(out.message);
    return out.result;
  };

  let versions: VersionResult;
  let currentNames = targets.map((t) => t.name).join("\n");
  let lastFacts: Facts | undefined;
  let outcome: ReviewOutcome;
  try {
    versions = await survey(targets, answers);
    outcome = await reviewAnswers({
      rules,
      prompter: deps.prompter,
      answers,
      collectFacts: async (a) => {
        // 聞き直しで回答が変わり、対象が変わったときは、増えた対象だけを調べて選び、減った対象は除く
        const nextTargets = targetsFor(a);
        const nextNames = nextTargets.map((t) => t.name).join("\n");
        if (nextNames !== currentNames) {
          versions = await survey(nextTargets, a, versions);
          currentNames = nextNames;
        }
        lastFacts = await collectFacts(a, {
          cwd: deps.cwd,
          versionsNewerThanVerified: versions.newerThanVerified,
          ...(deps.checkTools ? { checkTools: deps.checkTools } : {}),
        });
        return lastFacts;
      },
      interactive: deps.interactive,
      acceptedWarningIds,
      detailOf: (hit) => {
        if (hit.id === RULE7) return formatNewerDetail(versions);
        return hit.id === "missing-tools" && lastFacts?.missing_tools?.length
          ? lastFacts.missing_tools.map((d) => `- ${d}`).join("\n")
          : undefined;
      },
    });
  } catch (e) {
    if (e instanceof VersionsStopped) {
      deps.stderr(`エラー: バージョンの調査で進められません。\n${e.message}\n`);
      return { exitCode: 1 };
    }
    if (e instanceof GenerateError) {
      deps.stderr(`エラー: ${e.message}\n`);
      return { exitCode: 1 };
    }
    throw e;
  }

  // docs/tech-stack.md の中身（保存は #34）。最終の回答に合うプロファイルで作る
  let techStack: string;
  try {
    techStack = renderTechStack(
      versions,
      resolveProfiles(findTemplatesDir(), selectProfiles(outcome.answers)),
    );
  } catch (e) {
    if (!(e instanceof GenerateError)) throw e;
    deps.stderr(`エラー: ${e.message}\n`);
    return { exitCode: 1 };
  }
  const withVersions = { versions, techStack };

  switch (outcome.status) {
    case "errors": {
      deps.stderr("エラー: 整合性チェックでエラーが見つかりました。\n");
      deps.stderr(`${formatHits(outcome.result.errors, lastFacts)}\n`);
      return { exitCode: 1, answers: outcome.answers, result: outcome.result, ...withVersions };
    }
    case "warnings_not_accepted": {
      const pending = outcome.result.warnings.filter((h) => !acceptedWarningIds.includes(h.id));
      deps.stderr("エラー: 承知していない警告があります。\n");
      deps.stderr(`${formatHits(pending, lastFacts)}\n`);
      if (pending.some((h) => h.id === RULE7)) {
        const detail = formatNewerDetail(versions);
        if (detail) deps.stderr(`検証済みより新しいバージョン：\n${detail}\n`);
      }
      deps.stderr(
        `承知して続けるには、回答ファイルの accepted_warnings に、ルールの id（${pending.map((h) => h.id).join("、")}）を書いてください。\n`,
      );
      return { exitCode: 1, answers: outcome.answers, result: outcome.result, ...withVersions };
    }
    case "declined": {
      deps.prompter.note("警告を承知しなかったため、何もせずに終了します。");
      return { exitCode: 0, answers: outcome.answers, result: outcome.result, ...withVersions };
    }
    case "ok":
      break;
  }

  deps.prompter.note(formatAnswers(outcome.answers), "回答の一覧");
  deps.prompter.note(formatVersions(versions), "採用するバージョン");
  deps.prompter.note(formatResult(outcome.result, lastFacts), "整合性チェックの結果");
  const done = {
    answers: outcome.answers,
    acceptedWarnings: outcome.acceptedWarnings,
    result: outcome.result,
    ...withVersions,
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
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      });
      process.exitCode = outcome.exitCode;
    });
}
