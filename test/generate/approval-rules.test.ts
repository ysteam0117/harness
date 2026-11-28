import { parse as parseToml } from "smol-toml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAdoptFiles } from "../../src/adopt/build.js";
import { splitAgentTemplate } from "../../src/generate/frontmatter.js";
import { buildProject } from "../../src/generate/project.js";
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

const approval = "手元の設定や起動時の指定で利用者の承認を省かない";
const hold = "ツールが実行を許可していても、必要な承認を得るまで操作を保留する";
const noConfig = "モードの確認や切り替えのために手元や利用者の設定ファイルを読み書きしない";
const readOnly = new Set(["planner", "plan-reviewer", "code-reviewer"]);

function expectNoUnsafeDirections(content: string, label: string): void {
  expect(content, label).not.toMatch(
    /AI[^\n。]*Manual に切り替える|settings\.local\.json`? を(?:読む|開く|確認する)|defaultMode`? を(?:書き換える|変更する)/,
  );
}

function expectApproval(content: string, label: string): void {
  for (const phrase of [approval, hold, noConfig]) expect(content, label).toContain(phrase);
  expect(content, label).not.toContain(`${noConfig}。 `);
  expectNoUnsafeDirections(content, label);
}

function expectClaudeRules(files: OutFile[]): void {
  const claude = contentOf(files, "CLAUDE.md");
  expect(claude).toMatch(/^@AGENTS\.md$/m);
  expect(claude).toContain("利用者は、起動時に画面でモードを確認する");
  expect(claude).toContain("`bypassPermissions` の場合は利用者が Manual に切り替える");
  expect(claude).toContain("AI は承認が必要な操作の前で止まる");
  expect(claude).toContain("セッションの初めに一度だけ、統括が利用者に画面での確認を頼む");
  expect(claude).toContain("統括が利用者に Manual への切り替えを頼む");
  expect(claude).toContain("担当は統括に報告する");
  expect(claude).toContain("Claude Code の担当は統括のモードを引き継ぐ");
  expect(claude).toContain("`harness status` の結果を今のモードの確認の代わりにしない");
  expect(claude).toContain(noConfig);
  expect(claude).toMatch(/個人の設定[^\n]+コミットしない/);
  expectNoUnsafeDirections(claude, "CLAUDE.md");

  for (const role of Object.keys(REAL_AGENTS)) {
    const { body, head } = splitAgentTemplate(contentOf(files, `.claude/agents/${role}.md`), role);
    expectApproval(body, role);
    expect(body, role).toContain("実行前に統括に報告");
    expect(body, role).toContain("拒否された操作を別の手段で回避しない");
    expect(head, role).not.toHaveProperty("permissionMode");
    if (readOnly.has(role)) expect(head["tools"], role).toBe("Read, Grep, Glob, Bash");
  }

  const settings = JSON.parse(contentOf(files, ".claude/settings.json")) as {
    permissions: { ask: string[]; deny: string[] };
  };
  expect(settings.permissions.ask).toEqual(
    expect.arrayContaining([
      "Bash(rm -r *)",
      "Bash(rm -rf *)",
      "Bash(rm -fr *)",
      "Bash(git rebase *)",
    ]),
  );
  expect(settings.permissions.deny).toEqual(
    expect.arrayContaining([
      "Bash(git push --force * main)",
      "Read(./.env)",
      "Read(**/.env.production)",
    ]),
  );
  expect(settings.permissions).not.toHaveProperty("defaultMode");
  expect(settings).not.toHaveProperty("disableAutoMode");
}

function expectCodexRules(files: OutFile[]): void {
  for (const [role, codexName] of Object.entries(REAL_AGENTS)) {
    const data = parseToml(contentOf(files, `.codex/agents/${codexName}.toml`));
    const body = String(data["developer_instructions"]);
    expectApproval(body, role);
    expect(body, role).toContain("実行前に統括に報告");
    expect(body, role).toContain("拒否された操作を別の手段で回避しない");
    if (readOnly.has(role)) expect(data["sandbox_mode"], role).toBe("read-only");
  }
  const rules = contentOf(files, ".codex/rules/default.rules");
  expect(rules).toMatch(/pattern = \["rm", \["-r", "-rf", "-fr", "-R"\]\], decision = "prompt"/);
  expect(rules).toMatch(/pattern = \["git", "rebase"\], decision = "prompt"/);
  expect(rules).toMatch(/"origin", "main"\],\s*decision = "forbidden"/);
  expect(rules).toMatch(/"\.env\.local"\]\],\s*decision = "forbidden"/);
}

function expectSkills(files: OutFile[], root: string): void {
  const review = contentOf(files, `${root}/review/SKILL.md`);
  const common = review.match(/^## 計画・コード共通の依頼\n([\s\S]*?)^## /m)?.[1] ?? "";
  expectApproval(common, root);
  expect(common).toContain("実行前に統括に報告");
  expect(review).toContain("codex exec -s read-only");
  expect(review).toContain("書き込みや外部操作の権限を足して利用者の承認を省かない");
  const process = contentOf(files, `${root}/implementation-process/SKILL.md`);
  const delegation =
    process.match(/^### 委譲時の作業場所と状態\n([\s\S]*?)(?=^#{2,3} |(?![\s\S]))/m)?.[1] ?? "";
  expectApproval(delegation, root);
  expect(delegation).toContain("AIの設定の`ask`・`prompt`の対象");
  expect(delegation).toContain(
    "担当はツールへ操作を送る前に、何を・なぜ・範囲・取り消し方を統括へ報告する。",
  );
}

describe.each(cases)("C-66 C-75 #99 $name", ({ mode, repository, location }) => {
  let files: OutFile[];

  beforeAll(async () => {
    const answers = {
      ais: ["claude", "codex"],
      repository,
      check_location: location,
      ...(repository === "local" ? { visibility: "private" } : {}),
    };
    files =
      mode === "adopt"
        ? buildAdoptFiles({ answers: await completeAnswers(answers) })
        : buildProject(await projectInput(answers)).files;
  });

  it("C-75 #99 AC-2 AC-3: 統括と全8役に承認手順が届き、既存の制限も残る", () => {
    const agents = contentOf(files, "AGENTS.md");
    expect(agents).toMatch(/^## 破壊的な操作は、必ず利用者の判断を仰ぐ$/m);
    expect(agents).toContain("何を・なぜ・どの範囲で行うか");
    expectApproval(agents, "AGENTS.md");
    expectClaudeRules(files);
    expectCodexRules(files);
  });

  it("C-66 #99 AC-2 AC-4: 定義を経ないレビューの依頼と委譲の手順にも規定が届く", () => {
    for (const root of [".claude/skills", ".agents/skills"]) expectSkills(files, root);
  });
});

describe.each(["claude", "codex"])("C-66 #99 %s 単独", (ai) => {
  it("C-66 #99 AC-2: 選んだAIだけでも承認の規定が届く", async () => {
    const files = buildProject(await projectInput({ ais: [ai] })).files;
    expectApproval(contentOf(files, "AGENTS.md"), "AGENTS.md");
    if (ai === "claude") {
      expectClaudeRules(files);
      expectSkills(files, ".claude/skills");
    } else {
      expectCodexRules(files);
      expectSkills(files, ".agents/skills");
    }
  });
});
