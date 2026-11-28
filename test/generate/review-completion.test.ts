import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { beforeAll, describe, expect, it } from "vitest";
import { buildAdoptFiles } from "../../src/adopt/build.js";
import { splitAgentTemplate } from "../../src/generate/frontmatter.js";
import { buildProject } from "../../src/generate/project.js";
import { completeAnswers, contentOf, projectInput, type OutFile } from "./project-helpers.js";

const configurations = [
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
const safetyExceptions = "データ破損・認証の回避・情報漏えい";
const impactFields = "受け入れ条件・仕様・動作・安全の守り・既存テスト";
const omissionFields = "差分のファイルと行・元の指摘番号";
const recordFields = "対象・担当・理由・追跡先";

function containsAll(contents: string, phrases: string[]): void {
  for (const phrase of phrases) {
    expect(contents.includes(phrase), phrase).toBe(true);
  }
}

describe.each(configurations)("C-33 #95 $name", ({ mode, repository, location }) => {
  let files: OutFile[];
  const local = repository === "local";
  const decisionRecords = local ? "ADR・Issueの記録" : "ADR・Issue・PRの記録";
  const reviewRecord =
    mode === "adopt" ? "既存のIssueの記録" : local ? "Issueのファイル" : "Issueのコメント";
  const tracking =
    mode === "adopt"
      ? "既存の記録方法で管理する関連Issue"
      : local
        ? "関連するIssueのファイル"
        : "関連するIssue";

  beforeAll(async () => {
    const answers = {
      ais: ["claude", "codex"],
      repository,
      check_location: location,
      ...(local ? { visibility: "private" } : {}),
    };
    files =
      mode === "adopt"
        ? buildAdoptFiles({ answers: await completeAnswers(answers) })
        : buildProject(await projectInput(answers)).files;
  });

  it("C-33 #95 AC-1: 依頼と両担当が重大度・終了条件・合意の根拠を共有する", () => {
    const instructions = roots.map((root) => contentOf(files, `${root}/review/SKILL.md`));
    for (const role of ["plan-reviewer", "code-reviewer"]) {
      const claude = contentOf(files, `.claude/agents/${role}.md`);
      const codex = parseToml(contentOf(files, `.codex/agents/${role.replace(/-/g, "_")}.toml`));
      for (const text of [claude, String(codex["developer_instructions"])]) {
        containsAll(text, [
          "参照先、確かめる観点、レビューの回数と終了条件",
          "前回の指摘と、その対応、関連部分",
          role === "plan-reviewer" ? "1回目は計画全体" : "1回目は対象の差分全体",
          "指摘がなければ「指摘なし」",
        ]);
      }
      instructions.push(claude, String(codex["developer_instructions"]));
    }
    for (const text of instructions) {
      containsAll(text, [
        "重大（次の工程や取り込みを止める）",
        "要件の未達・退行・安全上の問題・必要なテストの不足",
        "軽微（受け入れ条件・安全・既存の確認を損ねない改善）",
        `${safetyExceptions}につながる指摘は必ず重大`,
        "根拠のない好みは修正要求にしない",
        `${decisionRecords}で参照できる合意済みの判断`,
        "根拠と前提が同じなら再指摘しない",
        "新しい証拠と影響を報告する",
        "必要な範囲が未確認なら終了可と報告しない",
        "重大・軽微の件数",
        "確認できなかった範囲",
        "終了可否",
        "対象箇所",
        "根拠",
        "修正案",
      ]);
    }
    for (const root of roots) {
      const review = contentOf(files, `${root}/review/SKILL.md`);
      containsAll(review, [
        "計画・コード共通の依頼",
        "計画本文または差分",
        "対象コミットまたは未コミット差分の範囲",
        "受け入れ条件",
        "確かめる観点",
        "合意済みの判断と参照先",
        "前回の指摘と関連部分",
        "ファイルを変更しない",
        "CodexにもClaude Codeにも「計画・コード共通の依頼」を渡す",
        "役割の定義を使わずに依頼する場合も同じ項目を渡す",
        "「終了と再レビュー」の条件を渡す",
        "軽微の扱いを統括が記録",
        "空・不完全な結果を「指摘なし」と扱わない",
      ]);
    }
  });

  it("C-66 #95 AC-2: 統括が終了と独立再レビューを判断できる", () => {
    const agents = contentOf(files, "AGENTS.md");
    containsAll(agents, [
      "計画レビューは原則2回以内、コードレビューは最大3回",
      "終了・再レビュー・例外の条件はSkill「レビュー」に従う",
      "必要な独立レビューが終了し、重大な指摘が解消している",
      "軽微の扱いと必要な後追いを記録している",
    ]);
    for (const root of roots) {
      const review = contentOf(files, `${root}/review/SKILL.md`);
      const process = contentOf(files, `${root}/implementation-process/SKILL.md`);
      const omissionRule = review
        .split("\n")
        .find((line) => line.startsWith("- 軽微だけの修正で再レビューを省けるかは"));
      expect(omissionRule).toContain(
        `判定者（統括）、${omissionFields}・${impactFields}に影響しない理由`,
      );
      containsAll(review, [
        "1回目は全体、2回目以降は指摘した箇所とその関連部分に絞る",
        "2回目に重大が残る場合に3回目を行う",
        "3回目でも重大が残る場合は先に進まず利用者に相談する",
        `${safetyExceptions}につながる指摘は、回数の上限を超えても解消するまで続ける`,
        "その再指摘だけの往復は回数に数えない",
        "判断の理由と参照先を伝える",
        "合意を変更する必要がある場合は、統括が既存の手順で利用者に確認する",
        "統括は、重大が0件で、必要な範囲を確認でき、軽微の修正・後追い・採用しない理由を記録したことを確かめ、レビューを終了する",
        "レビュー後に受け入れ条件・仕様・動作・安全の守りが変わった場合",
        "既存テストの期待値を変更したり、既存テストを削除・スキップしたりした場合",
        "文書・テストだけの差分でも独立して再レビューする",
        "統括が独立レビュー後に増えた差分を照合する",
        omissionFields,
        `${impactFields}に影響しない理由`,
        "この照合は独立レビューの代わりにしない",
        "判断に迷う場合は変更箇所を独立して再レビューする",
        "必要な独立確認を満たすまで先へ進まない",
      ]);
      containsAll(process, [
        "計画を書いたAIとは独立してレビューする",
        "実装したAIとは独立してレビューする",
        "統括は、重大が解消して必要な範囲を確認でき、軽微の扱いを記録したことを確かめて",
        "重大な指摘の修正と再レビュー",
        "統括が終了を確認してからテストの作成へ進む",
        "統括が終了を確認してから次の手順へ進む",
        "受け入れや安全の判定ができない場合は終了しない",
        "再レビューを省く根拠",
      ]);
    }
  });

  it("C-66 #95 AC-3: 後追いと再レビュー省略を構成に合う場所へ記録する", () => {
    const agents = contentOf(files, "AGENTS.md");
    containsAll(agents, [
      `レビュー結果、再レビューを省く根拠、後追いの記録は、${reviewRecord}に残す`,
    ]);
    expect(contentOf(files, "CLAUDE.md")).toMatch(/^@AGENTS\.md$/m);
    for (const root of roots) {
      const review = contentOf(files, `${root}/review/SKILL.md`);
      const process = contentOf(files, `${root}/implementation-process/SKILL.md`);
      containsAll(review, [
        `## 記録（${reviewRecord}に残す）`,
        "判定者（統括）",
        omissionFields,
        `${impactFields}に影響しない理由`,
        recordFields,
        `後追いは${tracking}につなぐ`,
        "読み取り専用のレビュー担当には記録の編集やIssueの作成を任せない",
        "採用しなかった指摘と理由",
      ]);
      containsAll(process, [
        `統括は${reviewRecord}にレビュー結果を残す`,
        "レビューしたAI・段階",
        "重大・軽微の件数",
        "採用した件数と採用しなかった指摘・理由",
        "確認できなかった範囲、終了可否",
        "判定者（統括）",
        recordFields,
        omissionFields,
        impactFields,
      ]);
      if (local) {
        expect(review).not.toMatch(/\bPR\b|GitHub Actions|\.github\//);
        expect(process).not.toMatch(/\bPR\b|GitHub Actions|\.github\//);
      }
    }
  });

  it("C-33 #95 AC-3: 独立性・テスト先行・既存の取り込み条件を保つ", () => {
    for (const role of ["plan-reviewer", "code-reviewer"]) {
      const config = parseToml(contentOf(files, `.codex/agents/${role.replace(/-/g, "_")}.toml`));
      const claude = splitAgentTemplate(contentOf(files, `.claude/agents/${role}.md`), role);
      expect(claude.head["tools"]).toBe("Read, Grep, Glob, Bash");
      expect(config["sandbox_mode"]).toBe("read-only");
      for (const text of [claude.body, String(config["developer_instructions"])]) {
        expect(text).toContain("ファイルを編集しない");
        expect(text).toContain("新しい会話で動かす");
        expect(text).toMatch(/破壊的な操作[^\n]*実行せずに理由と範囲を統括に報告/);
      }
    }
    for (const root of roots) {
      const review = contentOf(files, `${root}/review/SKILL.md`);
      const workflow = contentOf(files, `${root}/implementation-process/SKILL.md`);
      containsAll(review, [
        "別の会社のAIでレビューする",
        "新しい会話",
        "実装と同じ会話の中での見直しは、レビューとして扱わない",
        "codex exec -s read-only",
        "計画の本文を指示の文に直接入れる",
        "結果は日本語で書くこと",
        "品質チェックをやり直",
        "計画の指摘は計画担当に、実装の指摘は実装担当（`implementer`）に修正を依頼する",
        "既存テストの変更が必要なら、理由を統括に示し、テスト担当が要件に照らして変更する",
        "該当するSkill（`.agents/skills/<名前>/SKILL.md`、無ければ`.claude/skills/<名前>/SKILL.md`）をすべて読む",
        "単独でマージできる大きさを明らかに超えた",
      ]);
      containsAll(workflow, [
        "テストを先に書かせる",
        "テストが実装がないために失敗することを確かめ済み",
        "統括はcommit・push前に手元の秘密情報確認の成功を照合する",
        "必須のCIが失敗・未実行・古い結果ならマージを止める",
        "CIが失敗したら品質チェックの失敗として手順6に戻す",
        "直した差分のコードレビュー",
        "コミットの前に止まり、利用者に動作確認を依頼する",
      ]);
    }
  });

  it("C-33 #95 AC-4: 旧文を生成結果に残さない", () => {
    expect(contentOf(files, "AGENTS.md")).not.toContain("レビューは最大3回。3回目でも");
    for (const root of roots) {
      const review = contentOf(files, `${root}/review/SKILL.md`);
      const workflow = contentOf(files, `${root}/implementation-process/SKILL.md`);
      for (const text of [review, workflow]) {
        expect(text).not.toContain("計画レビュー・コードレビューとも最大3回");
        expect(text).not.toContain(
          "合意済みの設計判断（ADR等）が再び指摘された場合は、回数に数えず",
        );
        expect(text).not.toContain("品質チェックをやり直してから再レビューする");
      }
      expect(workflow).not.toContain("計画を、実装とは別のAIでレビューする");
    }
    for (const role of ["plan-reviewer", "code-reviewer"]) {
      expect(contentOf(files, `.claude/agents/${role}.md`)).not.toContain(
        "合意済みの設計判断（ADR等で決めたもの）は指摘しない",
      );
    }
  });
});

it("C-33 #95 AC-4: 要件で合意・重大・終了条件・記録先を定める", () => {
  const requirements = readFileSync(
    new URL("../../docs/requirements/common/workflow.md", import.meta.url),
    "utf8",
  );
  containsAll(requirements, [
    "ADR・Issue・PRの記録などで参照できる",
    "新しい証拠",
    "計画レビューは必要な場合も原則2回以内",
    "コードレビューは最大3回",
    "統括が独立レビュー後に増えた差分を照合する",
    omissionFields,
    impactFields,
    recordFields,
    "既存のIssueの記録",
  ]);
  expect(requirements).not.toContain(
    "合意済みの設計判断（ADR等で決定したもの）がレビューで再び指摘された場合",
  );
  const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
  const entry = changelog.split("## 0.4.0\n")[1]?.split("\n## ")[0] ?? "";
  containsAll(entry, ["原則2回以内", "コードレビューは最大3回", safetyExceptions, recordFields]);
});
