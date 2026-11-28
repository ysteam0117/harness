import { parse as parseToml } from "smol-toml";
import { beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildAdoptFiles } from "../../src/adopt/build.js";
import { buildProject } from "../../src/generate/project.js";
import { COMMANDS, DOCUMENTS } from "../adopt/forbidden-words.js";
import { completeAnswers, contentOf, projectInput, type OutFile } from "./project-helpers.js";

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

const roots = [".claude/skills", ".agents/skills"];

function roleInstructions(files: OutFile[], role: string): string[] {
  const claude = contentOf(files, `.claude/agents/${role}.md`);
  const codex = parseToml(contentOf(files, `.codex/agents/${role.replace(/-/g, "_")}.toml`));
  return [claude, String(codex["developer_instructions"])];
}

describe.each(cases)("C-61 #93 $name", ({ mode, repository, location }) => {
  let files: OutFile[];
  const useGitHub = repository === "github";
  const isAdopt = mode === "adopt";

  beforeAll(async () => {
    const answers = {
      ais: ["claude", "codex"],
      repository,
      check_location: location,
      database: "postgresql",
      postgres_provider: "neon",
      ...(useGitHub ? {} : { visibility: "private" }),
    };
    files = isAdopt
      ? buildAdoptFiles({ answers: await completeAnswers(answers) })
      : buildProject(await projectInput(answers)).files;
  });

  it("C-61 #93 AC-1: 手元と全体の担当・実行場所を選べる", () => {
    for (const root of roots) {
      const skill = contentOf(files, `${root}/testing/SKILL.md`);
      expect(skill).toContain("変更した処理と影響を受ける処理");
      expect(skill).toContain("範囲を確実に限定できない場合は広げる");
      if (isAdopt) {
        expect(skill).toContain("補助CI（harness-check.yml）だけでは全体確認にならない");
        expect(skill).toContain("既存のCIが実行する項目と対象コミットを確認する");
        expect(skill).toContain("確認できた項目だけCIの結果を使い、残る必須項目は手元で確認する");
        expect(skill).toContain("「ローカルのみ」「両方」の設定");
        expect(skill).toContain("実行場所や接続先が不明なら未確認として利用者に聞く");
        expect(skill).toContain("検証用DBの分離と接続先を確かめ");
        expect(skill).not.toContain("プロジェクト全体に対して品質チェックとテストを実行する");
      } else {
        expect(skill).toContain("npm test -- <対象>");
        expect(skill).toContain("pretest");
        expect(skill).toContain(
          {
            github_actions: "GitHub Actionsのみを選んだ場合は、必須の全体確認をCIで行う",
            both: "両方を選んだ場合は、手元とCIの両方で全体確認を行う",
            local: "ローカルのみを選んだ場合は、手元で全体確認を行う",
          }[location],
        );
        if (location === "github_actions") {
          expect(skill).toContain("CIが使えない場合は必要な全体確認を手元で行う");
          expect(skill).toContain("手元の結果で必須のCIを成功扱いしない");
        }
        if (location === "both") {
          expect(skill).toContain(
            "同じ候補の対象検証を手元の全体確認で済ませた場合は、手元でその検証を繰り返さない",
          );
        }
      }
      expect(skill).not.toContain("品質チェックとテストは、手元とCIで共通の1つのコマンド");
      expect(skill).toContain("全体確認は、手元でもCIでも同じコマンド");
      expect(skill).toContain("Lint・型・整形・通常のテスト・毎回のセキュリティ確認");
      expect(skill).toContain("CIでも開発環境と同じコンテナ・同じバージョンを使う");
    }
    for (const planner of roleInstructions(files, "planner")) {
      expect(planner).toContain("対象範囲と選定理由");
      expect(planner).toContain("範囲を広げる条件");
      expect(planner).toContain("実行場所と安全なコマンド、CIに含まれない必須確認を計画に書く");
    }
    for (const reviewer of [
      ...roleInstructions(files, "plan-reviewer"),
      ...roots.map((root) => contentOf(files, `${root}/review/SKILL.md`)),
    ]) {
      expect(reviewer).toContain(
        "手元・CIの分担、対象の漏れと安全な実行の入口、CIに含まれない必須確認",
      );
    }
  });

  it("C-61 #93 AC-2: 手元の結果と取り込み前の統括の確認を所定の場所に記録する", () => {
    const destination = isAdopt
      ? useGitHub
        ? "既存のPR本文またはIssueの記録"
        : "既存のIssueの記録"
      : useGitHub
        ? "PR本文の「検証の記録」"
        : "Issueのファイルの「検証の記録」";
    const agents = contentOf(files, "AGENTS.md");
    expect(agents).toContain(destination);
    expect(agents).toContain("統括が照合した最終候補の検証結果と対象コミット");
    expect(agents).toContain("品質チェック担当の手元の結果・計画の変更");
    expect(agents).toContain("検証の分担とCI失敗時の対応はSkill「実装の進め方」に従う");
    expect(agents).toContain("最終候補で、選んだ実行場所の全体確認と、CIに含まれない必須の確認");
    expect(agents).not.toContain(
      "該当するテストと品質チェックが、プロジェクト全体に対して通っている",
    );
    expect(contentOf(files, "CLAUDE.md")).toMatch(/^@AGENTS\.md$/m);
    for (const root of roots) {
      const workflow = contentOf(files, `${root}/implementation-process/SKILL.md`);
      for (const rule of ["最終候補の必須確認", "対象コミット", "取り込み先の基点", destination]) {
        expect(workflow.includes(rule), `${root}: ${rule}`).toBe(true);
      }
      expect(workflow).toContain(
        "品質チェック担当の手元の結果（対象範囲・コマンド・結果・対象コミット・未コミット差分の有無）",
      );
      expect(workflow).toContain(
        "対象コミット・範囲・コマンド・実行場所・結果と、実施したCIへのリンクを記録する",
      );
      expect(workflow).toContain(
        "候補や取り込み先、依存・設定・環境が変わったら、古い結果で成功と判断せず再確認する",
      );
    }
    for (const checker of roleInstructions(files, "quality-checker")) {
      for (const item of [
        "通常の品質確認",
        "対象コミット",
        "未コミット差分の有無",
        "コマンド",
        "対象範囲",
      ]) {
        expect(checker.includes(item), item).toBe(true);
      }
      expect(checker).not.toContain("一部のフォルダだけに限定しない");
      expect(checker).toContain("結果を統括に渡す");
      expect(checker).toMatch(/破壊的な操作[^\n]*実行せずに理由と範囲を統括に報告/);
    }
    if (isAdopt) {
      expect(files.some((file) => file.path.endsWith("pull_request_template.md"))).toBe(false);
      expect(files.some((file) => file.path === "docs/issues/_template.md")).toBe(false);
      if (useGitHub) {
        expect(agents).toContain("既存の様式を使い、PR本文に「知見」を必ず記録する");
      }
    } else {
      const template = contentOf(
        files,
        useGitHub ? ".github/pull_request_template.md" : "docs/issues/_template.md",
      );
      expect(template).toContain("## 検証の記録");
      expect(template).toContain("| 実行場所 | 対象範囲 | コマンド | 対象コミット | 結果");
      expect(template).toContain(useGitHub ? "| CI（利用する場合） |" : "| 取り込み時の全体確認 |");
      expect(template).toContain("手元の未コミット差分の有無");
      expect(template).not.toContain("[ ] `npm run check` が通った");
    }
  });

  it("C-61 #93 AC-3: commit・push前の秘密情報の確認と必須検証を保つ", () => {
    const guidance = [
      contentOf(files, "AGENTS.md"),
      ...roots.map((root) => contentOf(files, `${root}/testing/SKILL.md`)),
      ...roleInstructions(files, "quality-checker"),
    ];
    for (const text of guidance) {
      expect(text).toMatch(/commit・push前[^。]+手元[^。]+秘密情報[^。]+全範囲/);
      expect(text).toContain("CIの結果で代替しない");
      expect(text).toContain("成功を確認できるまでcommit・pushしない");
      if (isAdopt) {
        expect(text).toContain("利用者に確認して手順を決め、記録する");
        expect(text).not.toContain("npm run security:secrets");
      } else {
        expect(text).toContain("npm run security:secrets");
      }
    }
    for (const root of roots) {
      const skill = contentOf(files, `${root}/testing/SKILL.md`);
      expect(skill).toContain("CIに含まれないE2E・ビルド");
      expect(skill).toContain("CIの成功だけで実施済みと判断しない");
      expect(skill).toContain("認可・個人情報に関するマージ前の必須確認も行う");
      expect(skill).toContain(
        "成功を確認できるまでcommit・pushしない。手元の全体確認が同じ候補・条件の秘密情報確認まで含むと確かめられれば、その結果を使う。",
      );
      expect(skill).toContain("候補の内容やステージ状況が変われば再確認する");
      expect(skill).toContain("報告やログに秘密情報の値を出さない");
      expect(skill).toContain(
        "同じ対象コミット・差分・依存・設定・環境で成功した同じ工程の確認を繰り返さない",
      );
      expect(skill).toContain(
        "コードやテスト、条件が変わった場合と、失敗を修正した場合は再確認する",
      );
      expect(skill).toContain("失敗・中断・未実行・古い結果は成功として扱わない");
      expect(skill).toContain("途中の結果は全体の合格と扱わない");
      expect(skill).toContain("同じ条件で無断で再実行しない");
      expect(skill).toContain("検証環境だけで、利用者の承認を得てから行う");
      expect(skill).toMatch(/\| 攻撃を試す \|[^\n]+リリース前（検証環境）/);
      expect(skill).toMatch(/\| APIの異常な入力 \|[^\n]+リリース前（検証環境）/);
      expect(skill).toContain("攻撃を試すテストとペネトレーションテストは、本番に対して行わない");
      expect(skill).toContain("道具の実行は、利用者の承認を得てから行う");
      expect(skill).toMatch(/\| コードを見るテスト[^\n]+毎回/);
      expect(skill).toMatch(/\| 秘密情報の混入[^\n]+毎回/);
    }
    if (!isAdopt) {
      const pkg = JSON.parse(contentOf(files, "package.json")) as {
        scripts: Record<string, string>;
      };
      expect(pkg.scripts["check"]).toBe("npm run check:app && npm run security");
      expect(pkg.scripts["pretest"]).toContain("env:check");
      expect(pkg.scripts["test"]).toContain("node scripts/run-local.ts test vitest run");
      expect(pkg.scripts["security:secrets"]).toBe("node scripts/security-check.mjs secrets");
      expect(contentOf(files, "docs/testing/e2e.md")).toContain("`npm run check` には入れない");
      if (!useGitHub) {
        expect(contentOf(files, "AGENTS.md")).toContain("npm run merge:check");
        expect(contentOf(files, ".githooks/pre-commit")).toContain("gitleaks");
        expect(contentOf(files, "scripts/merge-check.mjs")).toContain("npm run check");
      }
    } else {
      for (const file of files) {
        for (const forbidden of [...COMMANDS, ...DOCUMENTS]) {
          expect(file.content.includes(forbidden), `${file.path}: ${forbidden}`).toBe(false);
        }
      }
    }
  });

  it("C-61 #93 AC-4: 古いCIで取り込まず、失敗後は品質確認と差分レビューへ戻る", () => {
    for (const root of roots) {
      const workflow = contentOf(files, `${root}/implementation-process/SKILL.md`);
      expect(workflow).toContain("必須のCIが失敗・未実行・古い結果");
      expect(workflow).toContain("マージを止める");
      expect(workflow).toContain("統括はcommit・push前に手元の秘密情報確認の成功を照合する");
      expect(workflow).toContain(
        "原因の見立てを`implementer`に渡して直させ、品質チェックをやり直す",
      );
      expect(workflow).toContain("手順6に戻す");
      expect(workflow).toContain("implementerが直し");
      expect(workflow).toContain("直した差分のコードレビュー");
      expect(workflow).toContain("動作が変わる場合は利用者による動作確認もやり直す");
      if (useGitHub) {
        expect(workflow).toContain("実際のcheckoutのSHA");
        expect(workflow).toContain("未記録");
        expect(workflow).toContain("PR先端のSHAを代わりに書かない");
        expect(workflow).toContain("結果が最終候補に対応するか分からなければ未確認とする");
      } else {
        expect(workflow).toContain("対象コミットと取り込み先の基点を区別して記録する");
        expect(workflow).toContain("統合後の全体確認と取り込みの成否を照合する");
        expect(workflow).not.toMatch(/\bPR\b/);
      }
      expect(workflow).toContain("検証した差分が最終コミットと一致すると確認できる場合");
    }
    const path = ".github/workflows/check.yml";
    if (isAdopt || location === "local") {
      expect(files.some((file) => file.path === path)).toBe(false);
      return;
    }
    const text = contentOf(files, path);
    expect(text).not.toContain("手元と同じ npm run check を実行する");
    const workflow = parseYaml(text) as {
      on: { push: { branches: string[] }; pull_request: unknown };
      permissions: Record<string, string>;
      jobs: { check: { steps: { uses?: string; run?: string; env?: Record<string, string> }[] } };
    };
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on).toHaveProperty("pull_request");
    const steps = workflow.jobs.check.steps;
    const checkout = steps.findIndex((step) => step.uses?.startsWith("actions/checkout@"));
    const runs = steps.map((step) => step.run ?? "");
    expect(runs.indexOf("git rev-parse HEAD")).toBe(checkout + 1);
    expect(runs.filter((run) => run === "git rev-parse HEAD")).toHaveLength(1);
    expect(runs.filter((run) => run === "npm run check")).toHaveLength(1);
    expect(runs.indexOf("npm run check")).toBeGreaterThan(runs.indexOf("git rev-parse HEAD"));
    const environment = steps.findIndex(
      (step) => step.env?.["ENV_TEST"] === "${{ secrets.ENV_TEST }}",
    );
    const database = runs.indexOf("npm run docker:up:test -- --wait db");
    expect(environment).toBeGreaterThan(checkout);
    expect(database).toBeGreaterThan(environment);
    expect(runs.indexOf("npm run check")).toBeGreaterThan(database);
  });
});
