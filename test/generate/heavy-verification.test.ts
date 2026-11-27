import { afterEach, describe, expect, it } from "vitest";
import { buildAdoptFiles } from "../../src/adopt/build.js";
import { buildProject } from "../../src/generate/project.js";
import { cleanupProjectTmp, completeAnswers, contentOf, projectInput } from "./project-helpers.js";

afterEach(cleanupProjectTmp);

const both = { ais: ["claude", "codex"] };
const destinations = [
  [".claude/skills", ".claude/agents/quality-checker.md"],
  [".agents/skills", ".codex/agents/quality_checker.toml"],
] as const;

const outputs = {
  create: async () => buildProject(await projectInput(both)).files,
  adopt: async () =>
    buildAdoptFiles({
      answers: await completeAnswers(both),
      profiles: [{ profile: "quality/typescript-standard", apps: ["."] }],
    }),
};

describe.each(["create", "adopt"] as const)("C-25 #87 %s の出力", (mode) => {
  it("C-25 #87 AC-1: 両AIに重い検証を始める条件と記録先を案内する", async () => {
    const files = await outputs[mode]();
    for (const [root] of destinations) {
      const testing = contentOf(files, `${root}/testing/SKILL.md`);
      expect(testing).toContain("## 重い検証");
      for (const condition of [
        "他の重い処理",
        "PID・プロセス名・開始時刻",
        "自分の作業・ほかの作業・不明",
        "対象コミット",
        "初期テストと各区分の時間上限",
        "結果とログの保存先",
        mode === "create" ? "`docs/project-rules.md`" : "このプロジェクトの既存の文書",
      ]) {
        expect(testing, root).toContain(condition);
      }
      expect(testing).not.toMatch(/\{\{[a-z][a-z0-9_]*\}\}/);
    }
  });

  it("C-25 #87 AC-2: 両AIの実行担当に異常時の停止と再開条件を案内する", async () => {
    const files = await outputs[mode]();
    for (const [root, checkerPath] of destinations) {
      const testing = contentOf(files, `${root}/testing/SKILL.md`);
      const checker = contentOf(files, checkerPath);
      expect(testing).toContain("通常の不合格");
      expect(testing).toContain("同じ条件で無断で再実行しない");
      expect(testing).toContain("原因・変更する条件・必要な承認");
      expect(testing).toContain("コマンドラインと環境変数は取得しない");
      expect(checker).toContain("後続の実行を止め");
      expect(checker).toContain("同じ条件で無断で再実行しない");
      expect(checker).not.toMatch(/\{\{[a-z][a-z0-9_]*\}\}/);
      expect(contentOf(files, `${root}/quality-tools/SKILL.md`)).toContain("「重い検証」");
    }
  });

  it("C-25 #87 AC-3: 破壊操作の承認と既存の検証基準を維持する", async () => {
    const files = await outputs[mode]();
    for (const [root, checkerPath] of destinations) {
      const testing = contentOf(files, `${root}/testing/SKILL.md`);
      const preflight = testing.match(/^## 重い検証\n([\s\S]*?)(?=^## )/m)?.[1] ?? "";
      expect(preflight).toContain("必須の品質チェックやセキュリティのテストを省略しない");
      expect(preflight).toContain("全体の合格と扱わない");
      expect(preflight).not.toMatch(/\d+\s*(?:分|時間|並列|プロセス)/);
      expect(testing).toContain("自分が起動したか分からないプロセスは、確認せずに止めない");
      expect(contentOf(files, checkerPath)).toMatch(
        /破壊的な操作[^\n]*実行せずに理由と範囲を統括に報告/,
      );
      expect(contentOf(files, `${root}/quality-tools/SKILL.md`)).toContain("対象の処理で80%以上");
    }
  });
});

it("C-25 #87 AC-2: create の手順書は共通Skillと初期テストの上限の確認先を案内する", async () => {
  const files = await outputs.create();
  const guide = contentOf(files, "docs/testing/mutation.md");
  expect(guide).toContain("「重い検証」");
  expect(guide).toContain("`dryRunTimeoutMinutes`");
  expect(guide).toContain("利用中の版の既定値");
  expect(guide).toContain("影響範囲と必要な全体確認");
});
