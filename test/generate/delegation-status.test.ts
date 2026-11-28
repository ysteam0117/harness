import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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

afterEach(cleanupProjectTmp);

const both = { ais: ["claude", "codex"] };
const roots = [".claude/skills", ".agents/skills"];
const readOnlyRoles = ["planner", "plan-reviewer", "code-reviewer"];

describe.each(["create", "adopt"] as const)("C-66 #90 %s の出力", (mode) => {
  let files: OutFile[];

  beforeAll(async () => {
    files =
      mode === "create"
        ? buildProject(await projectInput(both)).files
        : buildAdoptFiles({ answers: await completeAnswers(both) });
  });

  it("C-66 #90 AC-1: 作業場所を割り当て、担当はフォルダを残して場所を報告する", () => {
    for (const root of roots) {
      const skill = contentOf(files, `${root}/implementation-process/SKILL.md`);
      for (const record of [
        "実行場所と編集範囲",
        "Gitで管理しない場所",
        "書き込みを許された担当",
        "作業ごとに一意な空のフォルダ",
        "片付けを完了報告の条件にしない",
        "片付けは統括が節目に利用者の承認を得てから行うか、利用者が行う",
      ]) {
        expect(skill.includes(record), `${root}: ${record}`).toBe(true);
      }
    }
    for (const [role, codexName] of Object.entries(REAL_AGENTS)) {
      const claude = splitAgentTemplate(contentOf(files, `.claude/agents/${role}.md`), role);
      const codex = parseToml(contentOf(files, `.codex/agents/${codexName}.toml`));
      for (const body of [claude.body, codex["developer_instructions"]]) {
        expect(
          String(body).includes("作業用フォルダを割り当てられた場合は、削除せず場所を報告する"),
          role,
        ).toBe(true);
        expect(String(body).includes("利用上限を確認した場合は統括に報告する"), role).toBe(true);
      }
    }
  });

  it("C-66 #90 AC-2: 状態と次の対応が分かり、承認待ちを実行中と区別できる", () => {
    for (const root of roots) {
      const skill = contentOf(files, `${root}/implementation-process/SKILL.md`);
      for (const status of ["実行中", "承認待ち", "利用上限待ち", "停止", "未確認"]) {
        expect(skill.includes(`| ${status} |`), `${root}: ${status}`).toBe(true);
      }
      expect(skill.includes("無応答だけで停止や完了と判断しない"), root).toBe(true);
      expect(skill.includes("承認画面を確認できる場合"), root).toBe(true);
      expect(skill, root).toMatch(/^\| 承認待ち \|[^\n]+直ちに統括へ報告する/m);
      expect(skill.includes("回復の見込み"), root).toBe(true);
      expect(skill.includes("利用者が続け方を選ぶ"), root).toBe(true);
    }
  });

  it("C-66 #90 AC-3: 全役割に承認を待つ手順が届き、破壊操作の禁止も残る", () => {
    expect(contentOf(files, "AGENTS.md")).toMatch(/^## 破壊的な操作は、必ず利用者の判断を仰ぐ$/m);
    for (const root of roots) {
      const skill = contentOf(files, `${root}/implementation-process/SKILL.md`);
      expect(skill, root).toContain(
        "実行中・承認待ち・利用上限待ち・未確認の作業を重複して起動しない",
      );
      expect(skill, root).toMatch(/^\| 停止 \|[^\n]+再実行したりして回避しない/m);
    }
    for (const [role, codexName] of Object.entries(REAL_AGENTS)) {
      const claude = splitAgentTemplate(contentOf(files, `.claude/agents/${role}.md`), role);
      const codex = parseToml(contentOf(files, `.codex/agents/${codexName}.toml`));
      for (const body of [claude.body, codex["developer_instructions"]]) {
        expect(String(body)).toMatch(/破壊的な操作[^\n]+実行せずに理由と範囲を統括に報告/);
        for (const rule of [
          "`AGENTS.md`の「破壊的な操作は、必ず利用者の判断を仰ぐ」",
          "操作の実行前に何を・なぜ・範囲・取り消し方をすぐ統括に報告し、指示を待つ",
          "拒否された操作を別の手段で回避しない",
        ]) {
          expect(String(body).includes(rule), `${role}: ${rule}`).toBe(true);
        }
      }
    }
  });

  it("C-66 #90 AC-3: 再帰削除の確認設定と読み取り専用の役割を維持する", () => {
    const settings = JSON.parse(contentOf(files, ".claude/settings.json")) as {
      permissions: { ask: string[] };
    };
    expect(settings.permissions.ask).toEqual(
      expect.arrayContaining(["Bash(rm -r *)", "Bash(rm -rf *)", "Bash(rm -fr *)"]),
    );
    expect(contentOf(files, ".codex/rules/default.rules")).toMatch(
      /pattern = \["rm", \["-r", "-rf", "-fr", "-R"\]\], decision = "prompt"/,
    );

    for (const role of readOnlyRoles) {
      const claude = splitAgentTemplate(contentOf(files, `.claude/agents/${role}.md`), role);
      const codex = parseToml(contentOf(files, `.codex/agents/${REAL_AGENTS[role]}.toml`));
      expect(claude.head["tools"], role).toBe("Read, Grep, Glob, Bash");
      expect(codex["sandbox_mode"], role).toBe("read-only");
      for (const body of [claude.body, codex["developer_instructions"]]) {
        const instructions = String(body);
        expect(instructions, role).toContain("ファイルを編集しない");
        expect(instructions, role).toMatch(/読み取りのコマンドにだけ使う/);
        const folderInstructions = instructions
          .split(/[。\n]/)
          .map((instruction) => instruction.trim())
          .filter((instruction) => instruction.includes("作業用フォルダ"));
        expect(folderInstructions, role).toEqual([
          "既存の手順が求める作業用フォルダの場所・実行したコマンドは、従来の秘密情報の扱いに従って統括へ伝える",
          "作業用フォルダを割り当てられた場合は、削除せず場所を報告する",
        ]);
      }
    }
  });

  it("C-66 #90 AC-4: 共通手順への参照と利用上限・それ以外の分岐が届く", () => {
    expect(contentOf(files, "CLAUDE.md").includes("「委譲時の作業場所と状態」")).toBe(true);
    expect(
      contentOf(files, ".claude/agents/quality-checker.md").includes("ファイルを編集しない"),
    ).toBe(true);
    for (const root of roots) {
      for (const name of ["testing", "review"]) {
        expect(
          contentOf(files, `${root}/${name}/SKILL.md`).includes("「委譲時の作業場所と状態」"),
          `${root}/${name}`,
        ).toBe(true);
      }
      const skill = contentOf(files, `${root}/implementation-process/SKILL.md`);
      expect(skill).toContain("利用上限に達した場合は「委譲時の作業場所と状態」に従う");
      expect(skill).toContain(
        "利用上限以外の理由でClaude Codeが使えなくなった場合はCodexに切り替える",
      );
      expect(skill).not.toMatch(/\{\{[a-z][a-z0-9_]*\}\}/);
    }
  });
});

it("C-66 #90 AC-4: 共通仕様でも利用上限とそれ以外の切り替えを区別する", () => {
  const content = readFileSync(
    new URL("../../docs/requirements/common/workflow.md", import.meta.url),
    "utf8",
  );
  const section =
    content.split("##### Claude Codeが使えないとき")[1]?.split('<a id="c-67">')[0] ?? "";
  expect(section).toContain("利用上限以外の理由でClaude Codeが使えないときは、Codexで作業を続ける");
  expect(section).toContain("Orca連携の有無によらず、利用者が続け方を選ぶ");
  expect(section).toMatch(/回復を待てる利用上限[^。]+統括へ報告する/);
  const beforeCodexSwitch = section.split("Claude CodeからCodexに切り替える場合は、次に従う。")[0];
  expect(beforeCodexSwitch).toMatch(
    /^Orca連携[^\n]+\[F-30\]\(\.\.\/functional\.md#f-30\)の\(e\)の待機と再開/m,
  );
});
