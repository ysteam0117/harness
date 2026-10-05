// #34 テスト共通の道具（完全な回答・調べ済みのバージョン・生成の入力）。本物のネットワークにはつながない。
//
// 想定する型（実装の役割はこの形に合わせる。各テストの冒頭に、そのテストが使う型を書く）
//   src/generate/project.ts  buildProject(input): { files: ProjectFile[] }   ディスクに書かない
//   src/generate/write.ts    writeProject(input): Promise<{ dir: string; interrupted: boolean }>
//   src/generate/config.ts   fingerprint(content: string): string
//   src/generate/judgment.ts judge(answers: Answers): Judgment
//   src/generate/values.ts   buildValues(input): Record<string, string>
//   src/generate/knowledge.ts selectKnowledge(answers, opts?): KnowledgeEntry[]
//   src/generate/package-json.ts buildPackageJson(input): Record<string, unknown>

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AcceptedWarning } from "../../src/checks/review.js";
import type { Answers } from "../../src/questions/answers.js";
import { questionDefinitions } from "../../src/questions/definitions.js";
import { runQuestions } from "../../src/questions/flow.js";
import { chooseVersions, type VersionResult } from "../../src/versions/choose.js";
import { targetsFor } from "../../src/versions/targets.js";
import { FakePrompter, baseAnswers } from "../questions/helpers.js";
import { FIXED_NOW, offlineFetch } from "../versions/helpers.js";
import { realTemplatesDir } from "./helpers.js";

/** 質問に全部答えた状態の回答（自動で決まる値・既定の「未定」も入る）。baseAnswers に上書きを重ねる */
export async function completeAnswers(over: Record<string, unknown> = {}): Promise<Answers> {
  return runQuestions(questionDefinitions, new FakePrompter(), baseAnswers(over));
}

/**
 * 回答に合う実際のプロファイルの対象を、「つながらない fetch」で調べた結果（方針 verified）。
 * 検証済みの版がそのまま採用され、最新の安定版は「未確認」になる。調べた日は固定。
 */
export async function surveyVersions(
  answers: Answers,
  fetchFn: typeof fetch = offlineFetch().fn,
): Promise<VersionResult> {
  const out = await chooseVersions({
    targets: targetsFor(answers),
    policy: "verified",
    interactive: false,
    prompter: new FakePrompter(),
    fetch: fetchFn,
    now: FIXED_NOW,
  });
  if (out.status !== "ok") throw new Error(`バージョンの調査が止まりました：${out.message}`);
  return out.result;
}

export const SAMPLE_WARNINGS: AcceptedWarning[] = [
  {
    id: "team-needs-ci",
    message: "開発人数が「複数人」で、品質チェックの実行場所が「ローカルのみ」です",
    reason: "マージの前に、他の人の変更も含めた品質チェックが自動で行われません",
  },
];

export type ProjectInput = {
  answers: Answers;
  acceptedWarnings: AcceptedWarning[];
  versions: VersionResult;
  now: Date;
};

/** buildProject に渡す入力（既定：承知した警告なし・now は固定） */
export async function projectInput(
  over: Record<string, unknown> = {},
  extra: Partial<Omit<ProjectInput, "answers">> = {},
): Promise<ProjectInput> {
  const answers = await completeAnswers(over);
  return {
    answers,
    acceptedWarnings: [],
    versions: await surveyVersions(answers),
    now: FIXED_NOW,
    ...extra,
  };
}

export type OutFile = { path: string; content: string };

export function contentOf(files: OutFile[], p: string): string {
  const f = files.find((x) => x.path === p);
  if (!f)
    throw new Error(`出力に ${p} がありません（あるのは ${files.map((x) => x.path).join("、")}）`);
  return f.content;
}

export function pathsOf(files: OutFile[]): string[] {
  return files.map((f) => f.path);
}

const tmpRoots: string[] = [];

/** 一時フォルダを作る（afterEach で cleanupProjectTmp を呼ぶ） */
export function makeWorkDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harness-q34-"));
  tmpRoots.push(dir);
  return dir;
}

export function cleanupProjectTmp(): void {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
}

/** 実際の templates/ を一時フォルダに写す（一部を足す・消して、別のひな形を作るため） */
export function copyRealTemplates(): string {
  const dir = path.join(makeWorkDir(), "templates");
  cpSync(realTemplatesDir, dir, { recursive: true });
  return dir;
}

/** フォルダの中のすべてのファイルを、"/" 区切りの相対パス → 中身 で返す（空のフォルダは含まない） */
export function readTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const full = path.join(root, rel);
    if (statSync(full).isFile()) out[rel.split(path.sep).join("/")] = readFileSync(full, "utf8");
  }
  return out;
}

/** 管理するファイル（F-27・R5）の判定。テストが独立に持つ一覧（実装の一覧とは別に、足りない・余分の両方を検出する） */
export function expectedManaged(p: string): boolean {
  return (
    p === "AGENTS.md" ||
    p === "CLAUDE.md" ||
    p.startsWith(".claude/skills/") ||
    p.startsWith(".agents/skills/") ||
    p.startsWith(".claude/agents/") ||
    p.startsWith(".codex/agents/") ||
    p === ".claude/settings.json" ||
    p === ".codex/rules/default.rules" ||
    p.startsWith(".github/ISSUE_TEMPLATE/") ||
    p === ".github/pull_request_template.md" ||
    p.startsWith("backend/src/rules-examples/") ||
    p.startsWith("frontend/src/rules-examples/") ||
    [
      "scripts/env-check.mjs",
      "scripts/local-env.ts",
      "scripts/run-local.ts",
      "scripts/test-safety.mjs",
      "scripts/db-local.ts",
      "scripts/compose-local.ts",
    ].includes(p) ||
    p === "docs/secrets.md" ||
    // GitHub を使わない場合（#61）
    p === ".githooks/pre-commit" ||
    p === "scripts/merge-check.mjs" ||
    p === "docs/issues/_template.md" ||
    p === "docs/harness-feedback/README.md"
  );
}
