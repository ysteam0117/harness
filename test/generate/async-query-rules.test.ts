import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAdoptFiles } from "../../src/adopt/build.js";
import { splitAgentTemplate } from "../../src/generate/frontmatter.js";
import { buildProject } from "../../src/generate/project.js";
import { expandExamples } from "../../src/generate/template.js";
import { REAL_AGENTS } from "./helpers.js";
import {
  cleanupProjectTmp,
  completeAnswers,
  contentOf,
  projectInput,
  type OutFile,
} from "./project-helpers.js";

afterAll(cleanupProjectTmp);

const cases = [
  {
    name: "create / Actionsのみ",
    mode: "create",
    repository: "github",
    location: "github_actions",
  },
  { name: "create / 手元のみ", mode: "create", repository: "github", location: "local" },
  { name: "create / 両方", mode: "create", repository: "github", location: "both" },
  { name: "create / ローカルGit", mode: "create", repository: "local", location: "local" },
  { name: "adopt / GitHub", mode: "adopt", repository: "github", location: "github_actions" },
  { name: "adopt / ローカルGit", mode: "adopt", repository: "local", location: "local" },
] as const;

const skillRoots = [".claude/skills", ".agents/skills"];
const testProfile = { profile: "test-framework/vitest-playwright", apps: ["."] };
const testPath = "frontend/src/rules-examples/async-query.test.tsx";
const condition = "Testing Library で DOM を検索する場合";
const neutral = "非同期で整う状態は、必要な条件が成立するまで待って確かめる";
const instructions = "テストの計画・作成・レビュー・検証を担当する場合は、Skill「テスト」を読む。";
const readOnly = new Set(["planner", "plan-reviewer", "code-reviewer"]);
const priorWorkerRule = [
  "承認が必要な操作の範囲は、`AGENTS.md`の「破壊的な操作は、必ず利用者の判断を仰ぐ」、デプロイの承認（C-41）、AIの設定の`ask`・`prompt`に従う。",
  "操作の実行前に何を・なぜ・範囲・取り消し方をすぐ統括に報告し、指示を待つ。",
  "拒否された操作を別の手段で回避しない。手元の設定や起動時の指定で利用者の承認を省かない。",
  "ツールが実行を許可していても、必要な承認を得るまで操作を保留する。",
  "モードの確認や切り替えのために手元や利用者の設定ファイルを読み書きしない。承認が省かれる設定に気づいた場合やモードの確認・切り替えが必要な場合は、実行前に統括に報告する。",
  "作業用フォルダを割り当てられた場合は、削除せず場所を報告する。利用上限を確認した場合は統括に報告する。",
].join("");

function assertQueries(text: string): void {
  const part = text.slice(text.indexOf(condition));
  for (const line of [
    "初めから検索条件に合う要素は `getBy*`",
    "非同期に検索条件に合うようになる要素は `await findBy*`",
    "すでに検索条件に合う要素の属性や状態が後から変わる場合は、`await waitFor`",
    "固定時間の待機や根拠のない `timeout` の延長でテストを通さない",
    "操作は待機の前に行い、`waitFor` の callback では検索とアサーションだけを行う",
    "テスト全体を自動で再試行しない",
  ])
    expect(part).toContain(line);
}

function assertCommonTesting(content: string): void {
  expect(content).toContain(condition);
  expect(content.indexOf(neutral)).toBeGreaterThan(-1);
  expect(content.indexOf(neutral)).toBeLessThan(content.indexOf(condition));
  expect(content).toContain("利用者の操作に基づいて検証");
  expect(content).toContain("原因が分からないまま、待ち時間の延長・再試行でテストを通さない");
  expect(content).toContain("通常の品質チェックではテストを1回実行し、自動で再試行しない");
  expect(content).toContain("期待結果を根拠なく弱めたり変えたりしない");
  expect(content).toContain("Playwright の E2E では、Playwright のロケーターと `expect`");
  expect(content).toContain("test-tools が入っている場合");
  expect(content).not.toContain("screen.findByRole");
  expect(content).not.toContain(testPath);
  expect(content).not.toContain("{{example:");
  assertQueries(content);
}

function assertReviewerPrompt(text: string): void {
  const old =
    "- 確かめる観点：<下の「確かめる観点」から今回の変更に当たるもの。Skill のルールへの違反は、Skill の名前とルールを根拠に書く>";
  const lines = text.split("\n");
  expect(lines).not.toContain(old);
  const prompt = text.match(/^## 計画・コード共通の依頼\n([\s\S]*?)^## /m)?.[1] ?? "";
  expect(prompt).toContain(old.slice(0, -1));
  expect(prompt).toContain("テストの計画やテストコードを扱う場合は Skill「テスト」を読む");
  expect(prompt).toContain("ツールが実行を許可していても、必要な承認を得るまで操作を保留する");
}

function assertAgent(body: string, role: string): void {
  expect(body, role).toContain(instructions);
  expect(body, role).toContain(priorWorkerRule);
}

function assertClaudeAgents(files: OutFile[]): void {
  expect(contentOf(files, "CLAUDE.md")).toContain("@AGENTS.md");
  for (const role of Object.keys(REAL_AGENTS)) {
    const agent = splitAgentTemplate(contentOf(files, `.claude/agents/${role}.md`), role);
    assertAgent(agent.body, role);
    if (readOnly.has(role)) expect(agent.head["tools"], role).toBe("Read, Grep, Glob, Bash");
    expect(agent.head, role).not.toHaveProperty("permissionMode");
  }
}

function assertCodexAgents(files: OutFile[]): void {
  for (const [role, name] of Object.entries(REAL_AGENTS)) {
    const agent = parseToml(contentOf(files, `.codex/agents/${name}.toml`));
    assertAgent(String(agent["developer_instructions"]), role);
    if (readOnly.has(role)) expect(agent["sandbox_mode"], role).toBe("read-only");
  }
}

function assertTestTools(text: string, mode: "create" | "adopt"): void {
  expect(text).toContain(condition);
  expect(text).toContain("完了時点を制御");
  expect(text).toContain("自動の再試行（`retries`）でテストを通さない");
  expect(text).toContain("jsdomの画面の場所と同じドメインにし、MSWで応答を返す");
  expect(text).not.toContain("{{example:");
  expect(text).toContain('await screen.findByRole("link", { name: "詳細" })');
  expect(text).toContain('expect(link.getAttribute("href")).toBe("/items/1")');
  expect(text).toMatch(
    /await waitFor\(\(\) =>\s*expect\(\s*screen\.getByRole\("link", \{ name: "詳細" \}\)\.getAttribute\("href"\),?\s*\)\.toBe\("\/items\/1"\)/,
  );
  expect(text).not.toMatch(/toHaveAttribute|toBeInTheDocument/);
  if (mode === "create") expect(text).toContain(testPath);
  else {
    expect(text).toContain("導入先では既存のテストの置き場所と手順に合わせる");
    expect(text).not.toContain(testPath);
  }
}

describe.each(cases)("C-52 F-24 #101 $name", ({ mode, repository, location }) => {
  let files: OutFile[];
  let withoutProfile: OutFile[] | undefined;
  let example: { path: string; content: string; managed: boolean } | undefined;

  beforeAll(async () => {
    const answers = {
      ais: ["claude", "codex"],
      repository,
      check_location: location,
      ...(repository === "local" ? { visibility: "private" } : {}),
    };
    if (mode === "create") {
      const outputs = buildProject(await projectInput(answers)).files;
      files = outputs;
      example = outputs.find((file) => file.path === testPath);
    } else {
      const completed = await completeAnswers(answers);
      files = buildAdoptFiles({ answers: completed, profiles: [testProfile] });
      withoutProfile = buildAdoptFiles({ answers: completed });
    }
  });

  it("C-25 C-52 #101 AC-1 AC-2: 共通の条件待ちと、道具ごとの使い分けが届く", () => {
    expect(contentOf(files, "AGENTS.md")).toMatch(/^\| テスト \| `testing`/m);
    for (const root of skillRoots) {
      assertCommonTesting(contentOf(files, `${root}/testing/SKILL.md`));
      if (withoutProfile !== undefined) {
        assertCommonTesting(contentOf(withoutProfile, `${root}/testing/SKILL.md`));
        expect(withoutProfile.some((file) => file.path === `${root}/test-tools/SKILL.md`)).toBe(
          false,
        );
      }
    }
  });

  it("F-24 #101 AC-1 AC-2: 検証済みの例を選んだプロファイルにだけ展開する", () => {
    for (const root of skillRoots) {
      const skill = contentOf(files, `${root}/test-tools/SKILL.md`);
      assertTestTools(skill, mode);
      if (mode === "create") {
        expect(example?.managed).toBe(true);
        expect(example?.content).not.toMatch(/C-52|#101|AC-1/);
        expect(example?.content.split("\n").slice(0, 3).join("\n")).toContain("消さない");
        for (const region of ["async-link-query", "async-link-attribute"]) {
          expect(skill).toContain(expandExamples(`{{example:${testPath}#${region}}}`, files, root));
        }
      } else {
        expect(files.some((file) => file.path === testPath)).toBe(false);
      }
    }
  });

  it("C-66 #101 AC-2 AC-3: 全8役と共通の依頼に届き、既存の承認と権限を保つ", () => {
    assertClaudeAgents(files);
    assertCodexAgents(files);
    for (const root of skillRoots)
      assertReviewerPrompt(contentOf(files, `${root}/review/SKILL.md`));
  });
});

describe.each([
  { ai: "claude", root: ".claude/skills" },
  { ai: "codex", root: ".agents/skills" },
])("C-52 #101 $ai 単独", ({ ai, root }) => {
  it("C-52 #101 AC-2: 選んだAIだけでも共通の原則、例、担当の指示が届く", async () => {
    const files = buildProject(await projectInput({ ais: [ai] })).files;
    assertCommonTesting(contentOf(files, `${root}/testing/SKILL.md`));
    assertTestTools(contentOf(files, `${root}/test-tools/SKILL.md`), "create");
    assertReviewerPrompt(contentOf(files, `${root}/review/SKILL.md`));
    if (ai === "claude") assertClaudeAgents(files);
    else assertCodexAgents(files);
  });
});

const read = (file: string): string =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

it("C-25 C-52 F-21 F-24 #101 AC-1 AC-3: 要件・割り当て・設計が出力と合う", () => {
  const quality =
    read("docs/requirements/common/quality-test.md").split("## C-25：")[1]?.split("## C-26：")[0] ??
    "";
  expect(quality).toContain(neutral);
  expect(quality).toContain("固定時間の待機");
  expect(quality).toContain("既定では通常の品質チェックでテストを1回実行し、自動再試行は行わない");
  expect(quality).not.toMatch(/Testing Library|getBy|findBy|waitFor/);
  const frontend =
    read("docs/requirements/common/frontend.md").split("## C-52：")[1]?.split("## C-54：")[0] ?? "";
  expect(frontend).toContain(condition);
  expect(frontend).toContain(
    "Reactコンポーネントは、Testing Libraryを使って利用者の操作に基づいて検証する",
  );
  assertQueries(frontend);

  const functional = read("docs/requirements/functional.md");
  const testingRow = functional.split("\n").find((line) => line.startsWith("| テスト | [C-24]"));
  expect(testingRow).toContain("[C-52](common/frontend.md#c-52)");
  expect(testingRow).toContain(
    "テスト・品質チェック（ほかの役割もテストを計画・作成・レビュー・検証するとき）",
  );
  expect(functional).toContain(
    "共通のSkill（`backend`・`error-api`・`security`・`testing`）には例を置かず",
  );
  expect(functional).toContain(testPath);
  const common = read("templates/skills/testing/SKILL.md")
    .split("\n")
    .find((l) => l.includes("もとになった共通仕様"));
  const profile = read("templates/profiles/test-framework/vitest-playwright/SKILL.md")
    .split("\n")
    .find((l) => l.includes("もとになった共通仕様"));
  expect(common).toContain("C-52");
  expect(profile).toContain("C-52");
  const data = read("data/template-values.yaml");
  expect(data).toContain("# 全役割に共通する委譲時の指示と、テスト Skill の案内");
  expect(data).not.toContain("# 全役割に共通する委譲時の指示（C-66）\n");
  const design = read("docs/design/generation.md");
  expect(design).toContain(testPath);
  expect(design).toContain("テスト Skill を読む案内");
  expect(design).toContain("`frontend/src/rules-examples/`（Skill の例のテスト。#37・#85・#101）");
  expect(design).not.toContain("Skill の良い例・悪い例のテスト。#37・#85");
  expect(design).not.toContain(
    "担当向けの指示は `data/template-values.yaml` の `delegated_worker_rule` から各エージェントに入れる。",
  );
});

it("C-08 F-27 #101 AC-4: 版と変更履歴に配布・更新の経路がある", () => {
  const changelog = read("CHANGELOG.md");
  const current = changelog.match(/^## (\d+\.\d+\.\d+)$/m)?.[1];
  expect(current).toBeDefined();
  expect(JSON.parse(read("package.json"))).toMatchObject({ version: current });
  expect(JSON.parse(read("package-lock.json"))).toMatchObject({
    version: current,
    packages: { "": { version: current } },
  });
  const release = changelog.match(/^## 0\.7\.0\n([\s\S]*?)^## /m)?.[1] ?? "";
  for (const text of [
    condition,
    "findBy",
    "waitFor",
    "harness update",
    "test-tools",
    testPath,
    "管理外",
  ]) {
    expect(release).toContain(text);
  }
});
