// #80 コードを書く前に Skill のルールを読み、従うことを AGENTS.md とエージェントの定義で必須にする
//
// 想定する仕様
//   AGENTS.md に「コードを書く前に、ルールを読んで従う（必須）」の節があり、変更する部分 → 必ず読む Skill の表がある。
//   表に書いた Skill は、生成した Skill のフォルダ（.claude/skills/・.agents/skills/）に必ずある（表と実物の食い違いを防ぐ）。
//   DB なしのときは、DB の行に Skill を書かず、DB を使わない旨を書く。
//   ルールに従えない・決まっていないときは止まる決まりが、AGENTS.md・planner・implementer・Skill「実装の進め方」にある。
//   planner の報告に「従うルール」の欄があり、code-reviewer が Skill のルールへの違反を確かめる。
import { describe, expect, it } from "vitest";
import { buildProject, type ProjectFile } from "../../src/generate/project.js";
import { contentOf, projectInput } from "./project-helpers.js";

async function generate(over: Record<string, unknown> = {}): Promise<ProjectFile[]> {
  return buildProject(await projectInput(over)).files;
}

const SECTION = "## コードを書く前に、ルールを読んで従う（必須）";

/** AGENTS.md の表から、Skill のフォルダ名（`名前`）を集める */
function skillsInTable(agents: string): string[] {
  const start = agents.indexOf(SECTION);
  const end = agents.indexOf("\n## ", start + SECTION.length);
  const section = agents.slice(start, end);
  const names = new Set<string>();
  for (const line of section
    .split("\n")
    .filter((l) => l.startsWith("| ") && !l.startsWith("| ---"))) {
    const cell = line.split("|")[2] ?? "";
    for (const m of cell.matchAll(/`([a-z0-9-]+)`/g)) names.add(m[1] ?? "");
  }
  return [...names];
}

describe("#80 AGENTS.md の必読の表", () => {
  it.each([
    ["d1", { database: "d1" }],
    ["postgresql", { database: "postgresql", postgres_provider: "neon" }],
    ["none", { database: "none", auth: "none" }],
  ])("%s：表の Skill が、生成した Skill のフォルダにすべてある", async (_name, over) => {
    const files = await generate({ ais: ["claude", "codex"], ...over });
    const agents = contentOf(files, "AGENTS.md");
    expect(agents).toContain(SECTION);
    const skills = skillsInTable(agents);
    expect(skills.length).toBeGreaterThan(5);
    const paths = files.map((f) => f.path);
    for (const skill of skills) {
      expect(paths, skill).toContain(`.claude/skills/${skill}/SKILL.md`);
      expect(paths, skill).toContain(`.agents/skills/${skill}/SKILL.md`);
    }
  });

  it("DB ありは data-access-drizzle を読み、DB なしは DB を使わない旨を書く", async () => {
    const d1 = contentOf(await generate({ database: "d1" }), "AGENTS.md");
    expect(d1).toContain("| DB・クエリ・マイグレーション | `backend`・`data-access-drizzle` |");
    const none = contentOf(await generate({ database: "none", auth: "none" }), "AGENTS.md");
    expect(none).not.toContain("data-access-drizzle");
    expect(none).toContain("このプロジェクトは DB を使わない");
  });

  it("ルールに従えない・決まっていないときは止まる決まりがある", async () => {
    const files = await generate();
    const stop = "Skillのルールに従えない、またはルールが決まっていない書き方が必要になった";
    expect(contentOf(files, "AGENTS.md")).toContain(stop);
    expect(contentOf(files, ".claude/skills/implementation-process/SKILL.md")).toContain(stop);
    expect(contentOf(files, ".claude/agents/implementer.md")).toContain(
      "書き進めずに、理由を添えて統括に報告する",
    );
  });
});

describe("#80 エージェントの定義", () => {
  it("planner の報告に「従うルール」の欄があり、code-reviewer が Skill のルールへの違反を確かめる（Claude Code・Codex）", async () => {
    const files = await generate({ ais: ["claude", "codex"] });
    const planner = contentOf(files, ".claude/agents/planner.md");
    expect(planner).toContain("## 従うルール");
    expect(planner).toContain("この変更で必ず読むSkillを決めて、すべて読む");
    expect(contentOf(files, ".claude/agents/code-reviewer.md")).toContain("Skillのルールへの違反");
    expect(contentOf(files, ".claude/skills/implementation-process/SKILL.md")).toContain(
      "従うルール",
    );
    const codexAgents = files.filter((f) => f.path.startsWith(".codex/agents/"));
    expect(codexAgents.some((f) => f.content.includes("Skillのルールへの違反"))).toBe(true);
    expect(codexAgents.some((f) => f.content.includes("## 従うルール"))).toBe(true);
  });
});

describe("#4（旧 #41）Skill「レビュー」の Codex の呼び出し方", () => {
  it("コードレビューも codex exec -s read-only に指示の文をファイルから渡す。codex review は案内しない", async () => {
    const files = await generate({ ais: ["claude", "codex"] });
    for (const p of [".claude/skills/review/SKILL.md", ".agents/skills/review/SKILL.md"]) {
      const text = contentOf(files, p);
      expect(text, p).toContain('codex exec -s read-only - < "<作業用フォルダ>/review-prompt.md"');
      expect(text, p).not.toMatch(/codex review --(uncommitted|base)/);
      expect(text, p).toContain("Skill のルールへの違反");
      expect(text, p).toContain("結果は日本語で書くこと");
    }
  });
});
