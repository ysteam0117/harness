// #15 導入するファイルの組み立て（技術プロファイルを使わない）。想定する型：src/adopt/build.ts（buildAdoptFiles・AdoptFile）
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAdoptFiles } from "../../src/adopt/build.js";
import { BEGIN, END } from "../../src/adopt/markers.js";
import { resolveProfiles } from "../../src/generate/profile.js";
import { buildProject } from "../../src/generate/project.js";
import { findTemplatesDir } from "../../src/generate/templates-dir.js";
import { selectProfiles } from "../../src/versions/profile-selection.js";
import {
  cleanupProjectTmp,
  completeAnswers,
  copyRealTemplates,
  projectInput,
} from "../generate/project-helpers.js";

afterEach(cleanupProjectTmp);

const BOTH = { ais: ["claude", "codex"] };

/** 技術プロファイルの Skill のフォルダ名（create では出て、adopt では出ないもの） */
async function profileSkillNames(over: Record<string, unknown>): Promise<string[]> {
  const answers = await completeAnswers(over);
  return resolveProfiles(findTemplatesDir(), selectProfiles(answers)).map((p) => p.skillName);
}

describe("#15 AC-3: 導入するファイルは AI 向けのものだけ", () => {
  it("#15 AC-3: AGENTS.md・CLAUDE.md は doc（本文だけ）、それ以外は file。技術プロファイルの Skill は出ない", async () => {
    const answers = await completeAnswers(BOTH);
    const files = buildAdoptFiles({ answers });
    const byPath = new Map(files.map((f) => [f.path, f]));
    expect(byPath.get("AGENTS.md")?.kind).toBe("doc");
    expect(byPath.get("CLAUDE.md")?.kind).toBe("doc");
    expect(byPath.get(".claude/skills/testing/SKILL.md")?.kind).toBe("file");
    expect(byPath.get(".agents/skills/testing/SKILL.md")?.kind).toBe("file");
    expect(byPath.has(".claude/agents/planner.md")).toBe(true);
    expect(byPath.has(".claude/settings.json")).toBe(true);
    expect(byPath.has(".codex/rules/default.rules")).toBe(true);
    const names = await profileSkillNames(BOTH);
    expect(names.length).toBeGreaterThan(3);
    for (const name of names) {
      expect(byPath.has(`.claude/skills/${name}/SKILL.md`), name).toBe(false);
      expect(byPath.has(`.agents/skills/${name}/SKILL.md`), name).toBe(false);
    }
  });

  it("#15 AC-3: アプリのコード・設定・文書・スクリプト・CI は出さない", async () => {
    const files = buildAdoptFiles({ answers: await completeAnswers(BOTH) });
    const allowed = (p: string): boolean =>
      p === "AGENTS.md" ||
      p === "CLAUDE.md" ||
      p.startsWith(".claude/skills/") ||
      p.startsWith(".agents/skills/") ||
      p.startsWith(".claude/agents/") ||
      p.startsWith(".codex/agents/") ||
      p === ".claude/settings.json" ||
      p === ".codex/rules/default.rules";
    expect(files.map((f) => f.path).filter((p) => !allowed(p))).toEqual([]);
    for (const p of [
      "package.json",
      ".gitignore",
      "docs/project-rules.md",
      "scripts/env-check.mjs",
    ]) {
      expect(
        files.some((f) => f.path === p),
        p,
      ).toBe(false);
    }
  });

  it("#15 AC-3: 選んだAIの分だけ出す（claude だけなら .agents・.codex は出ない）", async () => {
    const files = buildAdoptFiles({ answers: await completeAnswers({ ais: ["claude"] }) });
    expect(files.some((f) => f.path.startsWith(".agents/") || f.path.startsWith(".codex/"))).toBe(
      false,
    );
    expect(files.some((f) => f.path === ".claude/skills/knowledge/SKILL.md")).toBe(true);
  });

  it("#15 AC-3: 知見の写し（Skill「知見」の references/）も出す", async () => {
    const files = buildAdoptFiles({ answers: await completeAnswers({ ais: ["claude"] }) });
    expect(files.some((f) => f.path.startsWith(".claude/skills/knowledge/references/"))).toBe(true);
  });

  it("#15 AC-3: パスの順に並び、同じ入力なら同じ結果になる", async () => {
    const answers = await completeAnswers(BOTH);
    const a = buildAdoptFiles({ answers });
    const b = buildAdoptFiles({ answers });
    expect(a).toEqual(b);
    const paths = a.map((f) => f.path);
    expect(paths).toEqual([...paths].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
  });

  it("#15 AC-3: 本文に印の文字列を含めない（二重に数えない）", async () => {
    const files = buildAdoptFiles({ answers: await completeAnswers(BOTH) });
    for (const f of files) {
      expect(f.content.includes(BEGIN), f.path).toBe(false);
      expect(f.content.includes(END), f.path).toBe(false);
    }
  });
});

describe("#15 AC-3: AGENTS.md の「必ず読むSkill」の表に、出さない Skill を書かない", () => {
  for (const database of ["d1", "postgresql", "none"]) {
    it(`#15 AC-3: 表に書いた Skill がすべて出力にある（DB：${database}）`, async () => {
      const answers = await completeAnswers({
        ...BOTH,
        database,
        ...(database === "postgresql" ? { postgres_provider: "neon" } : {}),
      });
      const files = buildAdoptFiles({ answers });
      const agents = files.find((f) => f.path === "AGENTS.md")?.content ?? "";
      const start = agents.indexOf("## コードを書く前に、ルールを読んで従う（必須）");
      const end = agents.indexOf("## 実装の進め方");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const rows = agents
        .slice(start, end)
        .split("\n")
        .filter(
          (l) => l.startsWith("| ") && !l.startsWith("| ---") && !l.startsWith("| 変更する部分"),
        );
      expect(rows.length).toBeGreaterThan(3);
      const named = new Set<string>();
      for (const row of rows) {
        const cell = row.split("|")[2] ?? "";
        for (const m of cell.matchAll(/`([a-z0-9_-]+)`/g)) named.add(m[1] as string);
      }
      expect(named.size).toBeGreaterThan(3);
      for (const name of named) {
        expect(
          files.some((f) => f.path === `.claude/skills/${name}/SKILL.md`),
          `表の Skill「${name}」`,
        ).toBe(true);
        expect(
          files.some((f) => f.path === `.agents/skills/${name}/SKILL.md`),
          name,
        ).toBe(true);
      }
    });
  }
});

describe("#15 AC-3: 生成したアプリ専用のものを、導入先の文書に書かない（R6）", () => {
  const COMMANDS = [
    "env:check",
    "check:app",
    "npm run security",
    "docker:up",
    "docker:down",
    "dev:test",
    "db:migrate",
    "db:seed",
    "db:cleanup",
    "test:db",
    "merge:check",
  ];
  // 導入で作らない文書のパス・生成したアプリのフォルダ構成
  const DOCUMENTS = [
    "docs/project-rules.md",
    "docs/secrets.md",
    "docs/testing/",
    "docs/api/",
    "docs/requirements.md",
    "docs/design/",
    "docs/adr/",
    "docs/tech-stack.md",
    "docs/issues/",
    "docs/harness-feedback/",
    ".githooks",
    "prototype/",
    "backend/src/",
    "frontend/src/",
  ];

  for (const repository of ["github", "local"]) {
    for (const database of ["d1", "postgresql", "none"]) {
      it(`#15 AC-3: adopt の出力全体（全 Skill・両 AI のエージェント・権限の設定）に、アプリ専用のコマンド名・導入で作らない文書のパス・アプリのフォルダ構成が無い（${repository}・${database}）`, async () => {
        const answers = await completeAnswers({
          ...BOTH,
          repository,
          database,
          ...(database === "postgresql" ? { postgres_provider: "neon" } : {}),
        });
        const files = buildAdoptFiles({ answers });
        const paths = files.map((f) => f.path);
        for (const must of [
          ".claude/agents/doc-writer.md",
          ".codex/agents/doc_writer.toml",
          ".codex/rules/default.rules",
          ".claude/settings.json",
          ".agents/skills/security/SKILL.md",
        ]) {
          expect(paths, must).toContain(must);
        }
        for (const f of files) {
          for (const word of [...COMMANDS, ...DOCUMENTS]) {
            expect(f.content.includes(word), `${f.path} に「${word}」`).toBe(false);
          }
        }
      });
    }
  }

  it("#15 AC-3: harness update を実行させる案内が無い（未対応と、改善の提案の記録を案内する）", async () => {
    const files = buildAdoptFiles({ answers: await completeAnswers(BOTH) });
    for (const f of files) {
      expect(f.content.includes("`harness update`で"), f.path).toBe(false);
    }
    const proc = files.find((f) => f.path === ".claude/skills/implementation-process/SKILL.md");
    expect(proc?.content).toContain("まだ対応していない");
    expect(proc?.content).toContain("#16");
    expect(proc?.content).toContain("改善の提案");
  });

  it("#15 AC-3: 品質チェック・テストのコマンドは「未設定。既存のコマンドと、DB に接続しないことを確かめ、不明なら利用者に聞く」と案内する", async () => {
    const files = buildAdoptFiles({ answers: await completeAnswers({ ais: ["claude"] }) });
    const testing = files.find((f) => f.path === ".claude/skills/testing/SKILL.md")?.content ?? "";
    expect(testing).toContain("未設定");
    expect(testing).toContain("package.json");
    expect(testing).toContain("本番や共有");
    expect(testing).toContain("利用者に聞く");
    const checker =
      files.find((f) => f.path === ".claude/agents/quality-checker.md")?.content ?? "";
    expect(checker).toContain("未設定");
    expect(checker).toContain("利用者に聞く");
  });
});

describe("#15 AC-3: create の出力は変わらない（R6）", () => {
  it("#15 AC-3: create の AGENTS.md・Skill・エージェントの定義は、これまでの文言のまま", async () => {
    const files = buildProject(await projectInput(BOTH)).files;
    const text = (p: string): string => files.find((f) => f.path === p)?.content ?? "";
    const agents = text("AGENTS.md");
    expect(agents).toContain(
      "| バックエンド（API・業務の処理・外部APIの呼び出し） | `backend`・`error-api`・`backend-hono` |",
    );
    expect(agents).toContain(
      "| フロントエンド（画面・部品・状態・フォーム） | `frontend`・`frontend-build`・`frontend-state` |",
    );
    expect(agents).toContain("| フロントエンドのAPI通信 | `frontend`・`http-client-axios` |");
    expect(agents).toContain("| ログ | `logger` |");
    expect(agents).toContain("| テスト | `testing`・`test-tools` |");
    expect(agents).toContain("| Lint・型・書式などの品質チェックの設定 | `quality-tools` |");
    expect(agents).toContain(
      "- 足りない項目を聞かれたら、`npm run env:check`を実行し、**項目の名前だけ**で答える",
    );
    expect(agents).toContain(
      "- このプロジェクト固有のルールは`docs/project-rules.md`にある。作業を始める前に読む",
    );
    expect(agents).toContain("| 要件定義書 | `docs/requirements.md` |");
    expect(text(".claude/skills/implementation-process/SKILL.md")).toContain(
      "- 決まったら、`.harness/config.yaml`と要件定義書を更新し、`harness update`で、有効にするルール・Skillに反映する",
    );
    expect(text(".claude/skills/security/SKILL.md")).toContain(
      "API仕様書（`docs/api/openapi.json`）も書く・直す",
    );
    expect(text(".claude/skills/security/SKILL.md")).toContain(
      "`backend/src/openapi.test.ts`が失敗にする",
    );
    expect(text(".claude/agents/doc-writer.md")).toContain(
      "| `docs/testing/` | テスト環境の構築手順の変更",
    );
    expect(text(".claude/agents/prototyper.md")).toContain("**`prototype/`だけ**を作成・変更する");
    expect(text(".codex/rules/default.rules")).toContain(
      "足りない項目は npm run env:check で確かめる（C-05）",
    );
    expect(text(".claude/skills/testing/SKILL.md")).toContain("`npm run check:app`");
    expect(text(".claude/skills/testing/SKILL.md")).toContain("`npm run docker:up:test`");
    expect(text(".claude/skills/env-deploy/SKILL.md")).toContain(
      "`npm run env:check`と起動のときに",
    );
    expect(text(".claude/agents/quality-checker.md")).toContain(
      "3. 手元とCIで共通の1つのコマンド（例：`npm run check`）で、**プロジェクト全体**に対して",
    );
  });

  it("#15 AC-3: create の出力に、置き換えの値の名前（{{...}}）が残らない", async () => {
    const files = buildProject(await projectInput(BOTH)).files;
    for (const f of files) {
      if (f.path.endsWith(".md") || f.path.endsWith(".toml")) {
        expect(f.content, f.path).not.toMatch(/\{\{[a-z][a-z0-9_]*\}\}/);
      }
    }
  });

  it("#15 AC-3: 差し替えたひな形でも、導入の組み立てができる（ひな形で使わない上書きの値があっても止まらない）", async () => {
    const dir = copyRealTemplates();
    writeFileSync(path.join(dir, "AGENTS.md"), "# {{app_name}}\n");
    const files = buildAdoptFiles({
      answers: await completeAnswers({ ais: ["claude"] }),
      templatesDir: dir,
    });
    expect(files.find((f) => f.path === "AGENTS.md")?.content).toBe("# testapp-001");
  });
});
