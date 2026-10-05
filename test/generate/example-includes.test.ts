// #37：Skill の {{example:<出力先のパス>#<名前>}} の差し込みを、出力の一覧（files_when の選択の後）から行う
import { afterAll, describe, expect, it } from "vitest";
import { GenerateError } from "../../src/generate/errors.js";
import { buildOutputs } from "../../src/generate/plan.js";
import { cleanupTemplates, fakeValues, fixtureFiles, makeTemplates } from "./helpers.js";

afterAll(cleanupTemplates);

const REGION = (kind: string): string =>
  `// 先頭の説明\n// #region example:sample\nexport const kind = "${kind}"; // {{x}}\n// #endregion\n`;

const YAML = `id: alpha
category: lib
name: Alpha
skill_name: lib-alpha
files_when:
  - when: { answer: database, equals: d1 }
    files:
      files/d1.ts: out/sample.test.ts
  - when: { answer: database, equals: postgresql }
    files:
      files/pg.ts: out/sample.test.ts
`;

function templates(skill: string): string {
  const base = Object.fromEntries(
    Object.entries(fixtureFiles()).filter(([p]) => !p.startsWith("profiles/")),
  );
  return makeTemplates({
    ...base,
    "profiles/lib/alpha/profile.yaml": YAML,
    "profiles/lib/alpha/SKILL.md": skill,
    "profiles/lib/alpha/files/d1.ts": REGION("d1"),
    "profiles/lib/alpha/files/pg.ts": REGION("pg"),
  });
}

const build = (skill: string, database: string) =>
  buildOutputs({
    templatesDir: templates(skill),
    ais: ["claude", "codex"],
    profiles: ["lib/alpha"],
    values: { ...fakeValues(), x: "{{y}}" },
    answers: { database } as never,
  });

const SKILL = "# alpha\n\n{{example:out/sample.test.ts#sample}}\n";

describe("#37: Skill への例の差し込み（buildOutputs）", () => {
  it("同じ SKILL.md に、選んだ DB の例が入る（d1 と postgresql）", () => {
    const d1 = build(SKILL, "d1").files.find((f) => f.path === ".claude/skills/lib-alpha/SKILL.md");
    const pg = build(SKILL, "postgresql").files.find(
      (f) => f.path === ".agents/skills/lib-alpha/SKILL.md",
    );
    expect(d1?.content).toContain('export const kind = "d1";');
    expect(d1?.content).not.toContain('"pg"');
    expect(pg?.content).toContain('export const kind = "pg";');
    expect(pg?.content).not.toContain('"d1"');
    expect(d1?.content).not.toContain("{{example:");
  });

  it("差し込んだコードの中の {{名前}} は再び展開されない（ファイルで置き換えた値が、そのまま残る）", () => {
    const skill = build(SKILL, "d1").files.find(
      (f) => f.path === ".claude/skills/lib-alpha/SKILL.md",
    );
    expect(skill?.content).toContain("// {{y}}");
  });

  it("この生成で出ないパスの例は、エラーになる（出さない通りの例は差し込めない）", () => {
    expect(() => build(SKILL, "none")).toThrow(GenerateError);
    expect(() => build("{{example:out/other.test.ts#sample}}\n", "d1")).toThrow(GenerateError);
  });
});
