import { readFileSync } from "node:fs";
import path from "node:path";
import type { AcceptedWarning } from "../checks/review.js";
import type { Answers } from "../questions/answers.js";
import type { VersionResult } from "../versions/choose.js";
import { selectProfiles } from "../versions/profile-selection.js";
import { renderTechStack } from "../versions/tech-stack.js";
import type { Ai } from "./adapter.js";
import { stripHarnessComments, stripMarkerComments } from "./comments.js";
import { buildConfigText, CONFIG_PATH, localDay } from "./config.js";
import { whenMatches, type When } from "./conditions.js";
import { GenerateError } from "./errors.js";
import { judge } from "./judgment.js";
import { selectKnowledge } from "./knowledge.js";
import { buildOutputs } from "./plan.js";
import { buildIcons } from "./icons.js";
import { buildPackageJson } from "./package-json.js";
import { checkOutputPaths } from "./paths.js";
import { resolveProfiles } from "./profile.js";
import { rolesFor } from "./roles.js";
import { normalizeNewlines, renderTemplate } from "./template.js";
import { buildEnvExample, buildValues } from "./values.js";
import { buildWranglerJsonc } from "./wrangler.js";
import { findTemplatesDir } from "./templates-dir.js";

export type ProjectFile = {
  /** "/" 区切りの相対パス */
  path: string;
  /** 改行は LF */
  content: string;
  /** ハーネスが管理するファイル（F-27）か。false はプロジェクトのもの */
  managed: boolean;
  /** 画像など、content を base64 で持つファイル */
  encoding?: "base64";
  /** 実行できるファイル（Git のフック）。書いたあとに実行の権限を付ける */
  executable?: true;
};

export interface BuildProjectInput {
  /** 完全な回答（自動で決まる値・未定を含む） */
  answers: Answers;
  /** 承知した警告 */
  acceptedWarnings: AcceptedWarning[];
  /** #33 で選んだ版 */
  versions: VersionResult;
  /** 生成した日（generated_on・ADR の承知した日）。ローカルの日付を使う */
  now: Date;
  /** 既定は findTemplatesDir() */
  templatesDir?: string;
  /** 既定はハーネスの knowledge/ */
  knowledgeDir?: string;
}

const GITHUB_REPOSITORY: When = { answer: "repository", equals: "github" };
const LOCAL_REPOSITORY: When = { answer: "repository", equals: "local" };

/** ひな形から出力する文書・スクリプト・Issue のテンプレート（ひな形 → 出力先） */
const TEMPLATE_FILES: {
  source: string;
  destination: string;
  when?: When;
  executable?: true;
}[] = [
  { source: "docs/secrets.md", destination: "docs/secrets.md" },
  { source: "docs/project-rules.md", destination: "docs/project-rules.md" },
  { source: "docs/pentest-plan.md", destination: "docs/testing/pentest-plan.md" },
  { source: "scripts/env-check.mjs", destination: "scripts/env-check.mjs" },
  { source: "scripts/local-env.ts", destination: "scripts/local-env.ts" },
  { source: "scripts/run-local.ts", destination: "scripts/run-local.ts" },
  { source: "scripts/test-safety.mjs", destination: "scripts/test-safety.mjs" },
  { source: "scripts/db-local.ts", destination: "scripts/db-local.ts" },
  { source: "scripts/compose-local.ts", destination: "scripts/compose-local.ts" },
  // 文書のひな形（#63）。要件定義書には F-26 の判定の結果を書き込む
  { source: "docs/requirements.md", destination: "docs/requirements.md" },
  { source: "docs/adr/README.md", destination: "docs/adr/README.md" },
  { source: "docs/adr/0000-template.md", destination: "docs/adr/0000-template.md" },
  // 設計書のひな形（C-81）。プロジェクトのもの（managed ではない）。実装したPRの中で、書いて更新する
  { source: "docs/design/overview.md", destination: "docs/design/overview.md" },
  ...["README", "quality", "unit", "integration", "e2e", "mutation"].map((name) => ({
    source: `docs/testing/${name}.md`,
    destination: `docs/testing/${name}.md`,
  })),
  // GitHub のファイル（PR・Issue のテンプレート・品質チェックのワークフロー）。リポジトリの置き場所が GitHub のときだけ（C-83）
  ...["harness-feedback", "parent", "child", "replace-icons"].map((name) => ({
    source: `.github/ISSUE_TEMPLATE/${name}.md`,
    destination: `.github/ISSUE_TEMPLATE/${name}.md`,
    when: GITHUB_REPOSITORY,
  })),
  {
    source: ".github/pull_request_template.md",
    destination: ".github/pull_request_template.md",
    when: GITHUB_REPOSITORY,
  },
  // GitHub を使わない（手元の Git だけ）場合の、Issue・フック・取り込みのコマンド・改善の提案の下書き（C-83）
  ...["README.md", "_template.md", "0001-replace-icons.md"].map((name) => ({
    source: `local-git/docs/issues/${name}`,
    destination: `docs/issues/${name}`,
    when: LOCAL_REPOSITORY,
  })),
  {
    source: "local-git/docs/harness-feedback/README.md",
    destination: "docs/harness-feedback/README.md",
    when: LOCAL_REPOSITORY,
  },
  {
    source: "local-git/githooks/pre-commit",
    destination: ".githooks/pre-commit",
    when: LOCAL_REPOSITORY,
    executable: true,
  },
  {
    source: "local-git/scripts/merge-check.mjs",
    destination: "scripts/merge-check.mjs",
    when: LOCAL_REPOSITORY,
  },
  {
    source: ".github/workflows/check.yml",
    destination: ".github/workflows/check.yml",
    when: { answer: "check_location", in: ["github_actions", "both"] },
  },
  {
    source: "project/LICENSE",
    destination: "LICENSE",
    when: { answer: "visibility", equals: "public" },
  },
  // プロトタイプ（C-76）
  ...["README.md", "index.html", "style.css", "app.js"].map((name) => ({
    source: `project/prototype/${name}`,
    destination: `prototype/${name}`,
  })),
  // 動くアプリの土台（#56）。.gitignore は、ひな形のフォルダの設定に影響しないよう、名前を変えて置く
  { source: "project/gitignore", destination: ".gitignore" },
  { source: "project/prettierignore", destination: ".prettierignore" },
  // API の最初のひな形：Controller（routes）→ Service（services）の層（C-03）。DB ありの入口（index.ts）は data-access/drizzle が出す
  { source: "project/backend/app.ts", destination: "backend/src/app.ts" },
  { source: "project/backend/config.ts", destination: "backend/src/config.ts" },
  { source: "project/backend/health.route.ts", destination: "backend/src/routes/health.ts" },
  {
    source: "project/backend/health.route.test.ts",
    destination: "backend/src/routes/health.test.ts",
  },
  {
    source: "project/backend/health.service.ts",
    destination: "backend/src/services/health.service.ts",
  },
  {
    source: "project/backend/index.none.ts",
    destination: "backend/src/index.ts",
    when: { answer: "database", equals: "none" },
  },
  { source: "project/README.md", destination: "README.md" },
  // IaC（C-39）。Terraform で Cloudflare の資源を作る。回答に合う資源のファイルだけを出す
  ...["versions.tf", "providers.tf", "variables.tf", "outputs.tf", "README.md"].map((name) => ({
    source: `infra/${name}`,
    destination: `infra/${name}`,
  })),
  {
    source: "infra/d1.tf",
    destination: "infra/d1.tf",
    when: { answer: "database", equals: "d1" },
  },
  {
    source: "infra/hyperdrive.tf",
    destination: "infra/hyperdrive.tf",
    when: { answer: "database", equals: "postgresql" },
  },
  {
    source: "infra/r2.tf",
    destination: "infra/r2.tf",
    when: { answer: "file_upload", equals: "yes" },
  },
  {
    source: "project/docker-compose.yml",
    destination: "docker-compose.yml",
    when: { answer: "database", notEquals: "postgresql" },
  },
  {
    source: "project/docker-compose.postgres.yml",
    destination: "docker-compose.yml",
    when: { answer: "database", equals: "postgresql" },
  },
];

const ADR_PATH = "docs/adr/0001-accepted-warnings.md";

/** ハーネスが管理するファイル（F-27）。それ以外はプロジェクトのもの（アプリのコード・設定・docs/ の記録など） */
export function isManagedPath(p: string): boolean {
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
    // Skill の書き方の例（良い例・悪い例のテスト）。Skill が差し込むため、ハーネスの更新で置き換える（F-24）
    p.startsWith("backend/src/rules-examples/") ||
    p.startsWith("frontend/src/rules-examples/") ||
    [
      "env-check.mjs",
      "local-env.ts",
      "run-local.ts",
      "test-safety.mjs",
      "db-local.ts",
      "compose-local.ts",
    ].some((name) => p === `scripts/${name}`) ||
    p === "docs/secrets.md" ||
    // GitHub を使わない場合（C-83）。docs/issues/README.md と各 Issue のファイルはプロジェクトのもの
    p === ".githooks/pre-commit" ||
    p === "scripts/merge-check.mjs" ||
    p === "docs/issues/_template.md" ||
    p === "docs/harness-feedback/README.md"
  );
}

function readTemplate(templatesDir: string, rel: string): string {
  try {
    return normalizeNewlines(readFileSync(path.join(templatesDir, ...rel.split("/")), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new GenerateError(`必須のひな形 ${rel} がありません`, { cause: e });
    }
    throw new GenerateError(`${rel} を読めません`, { cause: e });
  }
}

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** 承知した警告の ADR（C-35：背景・選択肢・決定・理由・影響） */
export function buildAdr(
  warnings: AcceptedWarning[],
  day: string,
  options: { number?: string; update?: boolean } = {},
): string {
  const number = options.number ?? "0001";
  const rows = warnings.map(
    (w) => `| ${cell(w.id)} | ${cell(w.message)} | ${cell(w.reason)} | ${day} |`,
  );
  return `${[
    options.update === true
      ? `# ${number}：ハーネスの更新で、新しい警告を承知した`
      : `# ${number}：警告を承知して、プロジェクトを生成した`,
    "",
    "- 状態：採用",
    `- 日付：${day}`,
    "- 関係：C-35、F-08",
    "",
    "## 背景",
    "",
    options.update === true
      ? "ハーネスの更新（harness update）のときの整合性チェックで、次の新しい警告が見つかった。警告は、成り立つが推奨しない組み合わせである。利用者は、内容と理由を確認したうえで、承知して続けることを選んだ。"
      : "プロジェクトを生成する前の整合性チェックで、次の警告が見つかった。警告は、成り立つが推奨しない組み合わせである。利用者は、内容と理由を確認したうえで、承知して続けることを選んだ。",
    "",
    "| ルールの id | 内容 | 理由 | 承知した日 |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## 選択肢",
    "",
    "1. 回答を変える",
    "   - 警告が出ない回答に直して、生成し直す",
    "2. リスクを承知して続ける",
    "   - 警告の内容を受け入れて、そのまま生成する",
    "",
    "## 決定",
    "",
    "選択肢2（承知して続ける）を採る。",
    "",
    "## 理由",
    "",
    "利用者が、警告の内容と理由を確認し、承知して続けることを選んだ。",
    "",
    "## 影響",
    "",
    "- 上の表の警告の理由に書かれたリスクを、このプロジェクトが引き受ける",
    "- 警告を解消する場合は、回答を変えて、必要な設定を直す。そのときは、このADRを消さずに、新しいADRを追加する",
  ].join("\n")}\n`;
}

/**
 * 生成するすべてのファイル（パスと中身）をメモリ上で組み立てる。ディスクには書かない。
 * AI向けの出力・プロファイルのコード・文書・スクリプト・package.json・知見の写し・技術スタック・
 * 承知した警告のADR・.harness/config.yaml を含む。パスの順に並べ、同じ入力なら同じ結果になる。
 * 誤り（値の漏れ・ひな形の不足・出力先の重なり）は GenerateError。
 */
export function buildProject(input: BuildProjectInput): { files: ProjectFile[] } {
  const { answers, acceptedWarnings, versions, now } = input;
  const templatesDir = input.templatesDir ?? findTemplatesDir();
  const ais: Ai[] = answers.ais;

  const profileKeys = selectProfiles(answers);
  const profiles = resolveProfiles(templatesDir, profileKeys);
  const judgment = judge(answers);
  const knowledge = selectKnowledge(answers, {
    ...(input.knowledgeDir !== undefined ? { knowledgeDir: input.knowledgeDir } : {}),
  });
  const nodeEntry = versions.entries.find((e) => e.name === "node");
  if (nodeEntry === undefined) {
    throw new GenerateError(".node-version に使う Node.js の版が、選んだ版にありません");
  }
  const values = buildValues({ answers, judgment, knowledge, nodeVersion: nodeEntry.version });
  values["license_year"] = String(now.getFullYear());

  // AI向けの出力・プロファイルの files
  const built = buildOutputs({ templatesDir, ais, profiles: profileKeys, values, answers });
  const outputs: {
    path: string;
    content: string;
    encoding?: "base64";
    executable?: true;
  }[] = [...built.files];

  // 文書・スクリプト・Issue のテンプレート
  for (const file of TEMPLATE_FILES) {
    if (!whenMatches(file.when, answers)) continue;
    const text = stripMarkerComments(
      stripHarnessComments(readTemplate(templatesDir, file.source), file.source),
    );
    outputs.push({
      path: file.destination,
      content: renderTemplate(text, values, { templatesDir, fileName: file.source }),
      ...(file.executable ? { executable: true as const } : {}),
    });
  }

  // wrangler.jsonc：選んだプロファイルの設定を、回答に合わせてまとめて作る。.env.example：環境変数の項目の一覧
  outputs.push({
    path: "wrangler.jsonc",
    content: buildWranglerJsonc({ profiles, answers, values }),
  });
  outputs.push({ path: ".env.example", content: buildEnvExample(answers) });

  outputs.push({ path: "docs/tech-stack.md", content: renderTechStack(versions, profiles) });
  if (acceptedWarnings.length > 0) {
    outputs.push({ path: ADR_PATH, content: buildAdr(acceptedWarnings, localDay(now)) });
  }

  const packageJson = buildPackageJson({
    appName: answers.app_name,
    answers,
    profiles,
    versions,
  });
  outputs.push({ path: "package.json", content: `${JSON.stringify(packageJson, null, 2)}\n` });
  outputs.push({ path: ".node-version", content: `${nodeEntry.version}\n` });
  // 仮のアイコン（C-55）
  outputs.push(...buildIcons(answers.app_name));

  // 知見の写し：Skill「知見」の references/（選んだAIごと）
  const skillRoots = [
    ...(ais.includes("claude") ? [".claude/skills"] : []),
    ...(ais.includes("codex") ? [".agents/skills"] : []),
  ];
  for (const root of skillRoots) {
    for (const entry of knowledge) {
      outputs.push({
        path: `${root}/knowledge/references/${entry.source}`,
        content: entry.content,
      });
    }
  }

  // 出力先の重なりを、記録のファイルを作る前に確かめる
  checkOutputPaths([...outputs.map((f) => f.path), CONFIG_PATH]);

  const withManaged: ProjectFile[] = outputs.map((f) => ({
    ...f,
    managed: isManagedPath(f.path),
  }));
  const config = buildConfigText({
    answers,
    acceptedWarnings,
    judgment,
    versions,
    roles: rolesFor(ais),
    managed: withManaged.filter((f) => f.managed),
    now,
  });
  withManaged.push({ path: CONFIG_PATH, content: config, managed: false });

  const files = withManaged.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files };
}
