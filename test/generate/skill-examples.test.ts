// #37 F-24：技術プロファイルの Skill に、テストで確かめた良い例・悪い例を載せる
//
// 例は、生成するプロジェクトの backend/src/rules-examples/ のテストのファイルに書き、
// Skill の {{example:<出力先のパス>#<範囲の名前>}} で差し込む（書き写さない）。
import { describe, expect, it } from "vitest";
import { buildProject, type ProjectFile } from "../../src/generate/project.js";
import { expandExamples, listExampleRegions } from "../../src/generate/template.js";
import { projectInput } from "./project-helpers.js";

const EXAMPLES_DIR = "backend/src/rules-examples/";
const CASES: { name: string; answers: Record<string, unknown> }[] = [
  { name: "d1", answers: { database: "d1", auth: "none" } },
  {
    name: "postgresql",
    answers: { database: "postgresql", postgres_provider: "neon", auth: "none" },
  },
  { name: "none", answers: { database: "none", auth: "none" } },
  { name: "undecided", answers: { database: "d1", auth: undefined } },
];

async function generate(answers: Record<string, unknown>): Promise<ProjectFile[]> {
  return buildProject(await projectInput(answers)).files;
}

const skillsOf = (files: ProjectFile[]): ProjectFile[] =>
  files.filter((f) => f.path.endsWith("/SKILL.md"));
const examplesOf = (files: ProjectFile[]): ProjectFile[] =>
  files.filter((f) => f.path.startsWith(EXAMPLES_DIR) && f.path.endsWith(".ts"));

/** 範囲の中の、export している関数・定数の名前（最初のもの） */
function exportedName(body: string): string | undefined {
  return /export (?:async )?(?:function|const) (\w+)/.exec(body)?.[1];
}

/** ファイルから、例の範囲の本文（region の行を除く）を、名前ごとに取り出す */
function regionBodies(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\/\/ #region example:([\w-]+)\n([\s\S]*?)\/\/ #endregion/g;
  for (const m of content.matchAll(re)) out[m[1] ?? ""] = m[2] ?? "";
  return out;
}

describe.each(CASES)("#37 F-24：Skill の例（$name）", ({ answers }) => {
  it("Skill に、未展開の {{example: が残らない", async () => {
    const files = await generate(answers);
    for (const skill of skillsOf(files)) {
      expect(skill.content, skill.path).not.toContain("{{example:");
    }
  });

  it("例のファイルのすべての範囲が、どこかの Skill に差し込まれている", async () => {
    const files = await generate(answers);
    const skills = skillsOf(files).map((f) => f.content);
    for (const file of examplesOf(files)) {
      for (const name of listExampleRegions(file.content)) {
        const expanded = expandExamples(`{{example:${file.path}#${name}}}`, files, "確認");
        expect(
          skills.some((s) => s.includes(expanded)),
          `${file.path}#${name}`,
        ).toBe(true);
      }
    }
  });

  it("悪い例の範囲は、例のファイルの中で呼ばれ、問題を示すテストがある", async () => {
    const files = await generate(answers);
    for (const file of examplesOf(files)) {
      const bodies = regionBodies(file.content);
      for (const [name, body] of Object.entries(bodies)) {
        if (!name.endsWith("-bad")) continue;
        const fn = exportedName(body);
        expect(fn, `${file.path}#${name} の関数の名前`).toBeDefined();
        expect(fn, `${file.path}#${name}`).toMatch(/Bad$/);
        const outside = Object.values(bodies).reduce((t, b) => t.replace(b, ""), file.content);
        expect(outside, `${file.path}#${name} を呼ぶ確かめ`).toMatch(new RegExp(`${fn ?? ""}\\b`));
        expect(file.content).toContain("悪い例の問題");
      }
    }
  });

  it("rules-examples は、ハーネスが管理するファイル（F-27）で、先頭に消さない旨がある", async () => {
    const files = await generate(answers);
    for (const file of examplesOf(files)) {
      expect(file.managed, file.path).toBe(true);
      expect(file.content.split("\n").slice(0, 3).join("\n"), file.path).toContain("消さない");
    }
  });
});

describe("#37 F-24：Skill ごとの良い例・悪い例", () => {
  const SKILLS = ["backend-hono", "data-access-drizzle"];

  it("Hono・Drizzle の Skill に、良い例・悪い例の見出しと、差し込まれたコードがある", async () => {
    const files = await generate({ database: "d1", auth: "none" });
    for (const name of SKILLS) {
      const skill = files.find((f) => f.path === `.claude/skills/${name}/SKILL.md`);
      expect(skill, name).toBeDefined();
      expect(skill?.content, name).toMatch(/^#{2,4} .*良い例/m);
      expect(skill?.content, name).toMatch(/^#{2,4} .*悪い例/m);
      expect(skill?.content, name).toContain("```ts");
    }
  });

  it("DB なしでは Drizzle の Skill と例は出ず、Hono の例は出る", async () => {
    const files = await generate({ database: "none", auth: "none" });
    expect(files.some((f) => f.path.includes("data-access-drizzle"))).toBe(false);
    expect(files.some((f) => f.path.endsWith(".db.test.ts"))).toBe(false);
    expect(files.some((f) => f.path === `${EXAMPLES_DIR}controller.test.ts`)).toBe(true);
    expect(files.some((f) => f.path === `${EXAMPLES_DIR}error-handling.test.ts`)).toBe(true);
  });

  it("D1 と PostgreSQL で、同じ SKILL.md に、選んだ DB の例が入る", async () => {
    const d1 = await generate({ database: "d1", auth: "none" });
    const pg = await generate({ database: "postgresql", postgres_provider: "neon", auth: "none" });
    const pick = (files: ProjectFile[]): string =>
      files.find((f) => f.path === ".claude/skills/data-access-drizzle/SKILL.md")?.content ?? "";
    // 説明の文にも名前が出るため、例のコード（行の終わりまで）で確かめる
    expect(pick(d1)).toContain("db.batch([\n");
    expect(pick(d1)).not.toContain("db.transaction(async (tx) => {\n");
    expect(pick(pg)).toContain("db.transaction(async (tx) => {\n");
    expect(pick(pg)).not.toContain("db.batch([\n");
    // 書き方は同じ 1 つ（ひな形は 1 つ）なので、見出しの並びは同じ
    const headings = (s: string): string[] => s.split("\n").filter((l) => /^#{1,4} /.test(l));
    expect(headings(pick(pg))).toEqual(headings(pick(d1)));
  });

  it("共通の Skill（backend・error-api・security）には例を置かず、選んだライブラリの Skill を読むよう案内する（DB なしでは、出ない Drizzle の Skill は案内しない）", async () => {
    for (const database of ["d1", "none"]) {
      const files = await generate({ database, auth: "none" });
      for (const name of ["backend", "error-api", "security"]) {
        const skill = files.find((f) => f.path === `.claude/skills/${name}/SKILL.md`);
        expect(skill?.content, `${database} ${name}`).not.toContain("```ts");
        expect(skill?.content, `${database} ${name}`).toContain("backend-hono");
        expect(skill?.content?.includes("data-access-drizzle"), `${database} ${name}`).toBe(
          database === "d1",
        );
      }
    }
  });
});

describe("#37 R5：PostgreSQL の例のテスト（test:db）", () => {
  const packageOf = async (answers: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const files = await generate(answers);
    const text = files.find((f) => f.path === "package.json")?.content ?? "{}";
    return JSON.parse(text) as Record<string, unknown>;
  };
  const scriptsOf = (pkg: Record<string, unknown>): Record<string, string> =>
    pkg["scripts"] as Record<string, string>;

  it("PostgreSQL にだけ posttest・test:db・pretest:db があり、check は4通りで同じ", async () => {
    const checks = new Set<string>();
    for (const c of CASES) {
      const scripts = scriptsOf(await packageOf(c.answers));
      checks.add(scripts["check"] ?? "");
      const has = c.name === "postgresql";
      expect("posttest" in scripts, c.name).toBe(has);
      expect("test:db" in scripts, c.name).toBe(has);
      expect("pretest:db" in scripts, c.name).toBe(has);
    }
    expect(checks.size).toBe(1);
  });

  it("test:db は Node.js の設定（vitest.db.config.ts）で動かし、DB を作り直す db:reset:test を使わない", async () => {
    const scripts = scriptsOf(
      await packageOf({ database: "postgresql", postgres_provider: "neon", auth: "none" }),
    );
    expect(scripts["posttest"]).toBe("npm run test:db");
    expect(scripts["test:db"]).toContain("--config vitest.db.config.ts");
    expect(`${scripts["pretest:db"] ?? ""}${scripts["test:db"] ?? ""}`).not.toContain("db:reset");
  });

  it("vitest の設定：PostgreSQL は、既定の設定から *.db.test.ts を外し、vitest.db.config.ts を出す", async () => {
    const pg = await generate({ database: "postgresql", postgres_provider: "neon", auth: "none" });
    const d1 = await generate({ database: "d1", auth: "none" });
    const text = (files: ProjectFile[], p: string): string | undefined =>
      files.find((f) => f.path === p)?.content;
    expect(text(pg, "vitest.config.ts")).toContain("**/*.db.test.ts");
    expect(text(pg, "vitest.db.config.ts")).toContain("**/*.db.test.ts");
    expect(text(pg, "vitest.db.config.ts")).toContain('environment: "node"');
    expect(text(d1, "vitest.db.config.ts")).toBeUndefined();
    expect(text(d1, "vitest.config.ts")).not.toContain("*.db.test.ts");
  });

  it("PostgreSQL の例は、一時的な表だけを使い、接続先を確かめてからつなぐ", async () => {
    const pg = await generate({ database: "postgresql", postgres_provider: "neon", auth: "none" });
    for (const file of examplesOf(pg).filter((f) => f.path.endsWith(".db.test.ts"))) {
      expect(file.content, file.path).toContain("CREATE TEMP TABLE");
      expect(file.content, file.path).not.toMatch(/migrate|db:reset|db:seed|seed.sql/i);
    }
    const helper = pg.find((f) => f.path === `${EXAMPLES_DIR}test-database.ts`)?.content ?? "";
    expect(helper).toContain("_test$");
    expect(helper).toContain("localhost");
    expect(helper).toContain("npm run docker:up:test");
  });
});
