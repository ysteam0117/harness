import { readFileSync } from "node:fs";
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
const timingColumns =
  "| 工程 | 担当 | 試行 | 種別 | 開始 | 終了 | 経過時間（秒） | 実行時間（秒） | 状態・待機理由 | 再実行の元・理由 | 取得元 |";
const usageColumns = "| 工程・試行 | 項目 | 数値 | 単位 | 範囲 | 取得元 | 未取得の理由 |";
const protectedSources = [
  "秘密情報の値",
  "個人情報",
  "生ログ（編集していない出力の全体）",
  "内部URL（組織内や非公開のサービスのURL）",
  "内部識別子（セッション、エージェント、実行環境やオーケストレーターの実行・タスク・依頼、アカウント、組織）",
];

function containsAll(contents: string, phrases: string[]): void {
  for (const phrase of phrases) {
    expect(contents.includes(phrase), phrase).toBe(true);
  }
}

function processSection(contents: string): string {
  return contents.match(/^#{2,3} 工程の記録[^\n]*\n([\s\S]*?)(?=^#{1,3} |(?![\s\S]))/m)?.[1] ?? "";
}

function expectRecordTables(section: string): void {
  containsAll(section, [
    timingColumns,
    usageColumns,
    "**使用量**",
    "工程の記録・使用量の表・要約に転記しない",
    "パスやコマンドライン",
    ...protectedSources,
  ]);
  expect(section.split("\n").filter((line) => line.startsWith("|"))).toHaveLength(6);
  expect(section).not.toMatch(/\bnpm run\b|\bgh \w/);
}

afterAll(cleanupProjectTmp);

describe.each(cases)("C-66 #97 $name", ({ mode, repository, location }) => {
  let files: OutFile[];
  const local = repository === "local";
  const adopted = mode === "adopt";
  const recordPlace = adopted
    ? local
      ? "既存のIssueの記録"
      : "既存のPR本文またはIssueの記録"
    : local
      ? "Issueのファイルの「工程の記録」"
      : "PR本文の「工程の記録」";
  const verificationPlace = adopted
    ? recordPlace
    : local
      ? "Issueのファイルの「検証の記録」"
      : "PR本文の「検証の記録」";

  beforeAll(async () => {
    const answers = {
      ais: ["claude", "codex"],
      repository,
      check_location: location,
      ...(local ? { visibility: "private" } : {}),
    };
    files = adopted
      ? buildAdoptFiles({ answers: await completeAnswers(answers) })
      : buildProject(await projectInput(answers)).files;
  });

  it("C-66 #97 AC-1: 統括が試行・待機・再実行と時間を対応付けて記録する", () => {
    for (const root of roots) {
      const section = processSection(contentOf(files, `${root}/implementation-process/SKILL.md`));
      expectRecordTables(section);
      containsAll(section, [
        "工程の記録は統括だけが書く",
        "担当の報告と許可された情報を照合",
        "応答できないときは統括が確認できた項目だけ",
        "役割と、分かる場合はAI・モデル",
        "下の書式で手で要約する",
        "統括が担当に依頼する1回、または統括自身が担当する工程の1回",
        "担当内の個別のコマンドやTDDの反復は数えない",
        "種別「実行」で1行",
        "同じ試行番号で種別「待機」の行を区間ごとに",
        "計画・計画レビュー・テスト・実装・品質チェック・コードレビュー・ドキュメント・利用者の動作確認",
        "Issueがあるプロトタイプ",
        "Issue分割より前のプロトタイプは従来の報告を統括に返す",
        "このIssue単位の記録の対象外",
        "実行中／承認待ち／利用上限待ち／停止／未確認",
        "成功／失敗",
        "中断は「停止」と理由",
        "利用者の動作確認待ち",
        "元の試行を残し、次の試行に再実行の元と理由",
        "記録から再実行の承認を推定しない",
        "時差付きISO 8601",
        "精度や時差を推定しない",
        "時刻・時間を確認できない場合は「未取得」と理由",
        "経過時間は試行の開始から終了まで",
        "実行時間は確認できた実行区間だけ",
        "実行区間と待機を区別できない場合、実行時間は未取得",
        "実行時間は確認できた実行区間だけを秒で記す",
        "待機を二重に加えず、並行する工程の時間を足して全体の経過時間としない",
      ]);
      if (local) {
        expect(section).toContain(
          adopted ? "導入先で決めた手元の取り込み確認" : "取り込み時の全体確認",
        );
        expect(section).not.toMatch(/\bPR\b|\bCI\b|CI待ち|GitHub Actions/);
        expect(section).toContain(
          adopted
            ? "実行したコマンドは既存の検証の記録に残す"
            : "実行したコマンドは別欄の「検証の記録」に残す",
        );
      } else if (!adopted && location === "local") {
        expect(section).toContain("CIを使わない場合はCIの工程とCI待ちは「該当しない」");
        expect(section).toContain("手元で行う確認を工程として記録する");
      } else {
        expect(section).toContain(adopted ? "導入先がCIを使う場合" : "CIを使う場合");
        containsAll(section, [
          "工程を「CI」、待機理由を「CI待ち」",
          "CIの1回の実行を1試行",
          "共有可能なCI実行リンク",
        ]);
        if (adopted) expect(section).toContain("使わない場合はCIの工程とCI待ちは「該当しない」");
      }
    }
  });

  it("C-66 #97 AC-2: 単位・範囲・取得元と、未取得の理由を区別する", () => {
    for (const root of roots) {
      const section = processSection(contentOf(files, `${root}/implementation-process/SKILL.md`));
      containsAll(section, [
        "単位はトークン数",
        "工程名・試行番号・測定範囲",
        "計画レビュー1回目の実行全体",
        "クライアント表示・担当の完了通知・実行ログの使用量の要約",
        "取得元の種類と項目",
        "集計に不要なデータは読まない",
        "同じ測定範囲に属する試行の前後が分かるときだけ差分を取る",
        "総量と入力・出力・キャッシュ等の内訳を区別",
        "総量に含まれる内訳や重なる実行を重複して足さない",
        "表示なし・権限なし・対象範囲を特定できない",
        "「未取得」と理由",
        "ゼロ・成功・該当しない項目と区別",
        "権限や公開範囲を広げない",
        "数値の未取得を根拠に合格・不合格を変えない",
        "必要な作業メモは許可された作業場所",
        "承認・再開・独立レビュー・必須の検証は既存の手順に従い",
        `${verificationPlace}に残す検証結果と品質チェックの報告では、対象範囲・コマンド・実行場所・結果・対象コミットを従来の手順どおり扱う`,
      ]);
      if (adopted) expect(section).not.toContain("「検証の記録」");
      expect(section).not.toMatch(/\bOrca\b|\bRun\b|\bTask\b|\bDispatch\b/);
    }
  });

  it("C-66 #97 AC-2: 両AIの全役と独立レビューの依頼に報告の境界が直接届く", () => {
    const reports: string[] = [];
    for (const [role, codexName] of Object.entries(REAL_AGENTS)) {
      const claude = splitAgentTemplate(contentOf(files, `.claude/agents/${role}.md`), role);
      const codex = parseToml(contentOf(files, `.codex/agents/${codexName}.toml`));
      for (const body of [claude.body, String(codex["developer_instructions"])]) {
        reports.push(body.match(/^## 報告の形\n[\s\S]*?(?=^## |(?![\s\S]))/m)?.[0] ?? "");
        expect(body).toContain("削除せず場所を報告する");
      }
    }
    for (const root of roots) {
      const review = contentOf(files, `${root}/review/SKILL.md`);
      const prompt =
        review.match(/^## 計画・コード共通の依頼[\s\S]*?^```markdown\n([\s\S]*?)^```/m)?.[1] ?? "";
      const report = prompt.split("\n").find((line) => line.startsWith("- 工程の報告"));
      expect(report).toBeDefined();
      reports.push(report ?? "");
      expect(review).toContain("利用者にはログを見られる場所を伝える");
    }
    for (const report of reports) {
      containsAll(report, [
        "工程・担当の役割（分かればAI・モデル）・試行",
        "確認できた開始・終了、待機の理由、再実行の元と理由",
        "使用量の項目・数値・単位・範囲・取得元",
        "開始・終了は取得元で確認した時差付きで書く",
        "使用量は累積・試行の値・差分のどれかと、総量・内訳の別、キャッシュを含むかを分かる範囲で添える",
        "統括に応答で伝える",
        "時刻や値を推定せず、「未取得」と理由",
        "取得元の対象は工程名・試行番号・測定範囲",
        "この工程の記録は担当が編集しない",
        ...protectedSources,
        "既存の手順が求める作業用フォルダの場所・実行したコマンド",
        "従来の秘密情報の扱いに従って統括へ伝える",
        "秘密情報・個人情報などを除いた診断に必要な抜粋と、ログの保存場所は統括に報告してよい",
        "既存の手順が求める場合は、残存プロセスのPID・プロセス名・ポートも統括に報告する",
      ]);
      expect(report).not.toMatch(/\bOrca\b|\bRun\b|\bTask\b|\bDispatch\b/);
      expect(report).not.toContain("パスやコマンドライン");
    }
  });

  it("C-35 C-83 #97 AC-3: 統括の記録先と書式が各構成に届く", () => {
    const agents = contentOf(files, "AGENTS.md");
    expect(agents).toContain(`統括は工程と使用量の要約を、${recordPlace}に残す`);
    expect(agents).toContain("工程の記録はSkill「実装の進め方」に従う");
    expect(contentOf(files, "CLAUDE.md")).toMatch(/^@AGENTS\.md$/m);
    for (const root of roots) {
      const workflow = contentOf(files, `${root}/implementation-process/SKILL.md`);
      expect(workflow).toContain(`### 工程の記録（${recordPlace}に残す）`);
    }
    const pr = ".github/pull_request_template.md";
    const issue = "docs/issues/_template.md";
    if (adopted) {
      expect(files.some((file) => file.path === pr || file.path === issue)).toBe(false);
      return;
    }
    const template = contentOf(files, local ? issue : pr);
    const section = processSection(template);
    expectRecordTables(section);
    expect(section).toMatch(
      /^<!-- パスやコマンドライン.+工程の記録・使用量の表・要約に転記しない。 -->$/m,
    );
    expect(template).toContain("| 実行場所 | 対象範囲 | コマンド | 対象コミット | 結果");
    if (local) {
      expect(template).toContain("| 取り込み時の全体確認 |");
      containsAll(contentOf(files, "docs/issues/README.md"), [
        "レビューの記録・工程の記録・知見",
        "工程の記録は統括が書く",
        "既にあるIssueのファイルには、必要なときに統括が「工程の記録」を手で足す",
      ]);
    } else {
      expect(template).toContain("CIのPR先端・取り込み先の基点・checkoutのSHAを記録する");
    }
  });

  it("C-66 #97 AC-3: 既存の承認・証拠・検証・独立レビューを保つ", () => {
    for (const root of roots) {
      const testing = contentOf(files, `${root}/testing/SKILL.md`);
      const workflow = contentOf(files, `${root}/implementation-process/SKILL.md`);
      const review = contentOf(files, `${root}/review/SKILL.md`);
      containsAll(testing, ["証拠と残存プロセスを報告する", "同じ条件で無断で再実行しない"]);
      containsAll(workflow, [
        "完了・中断の報告に場所と残した成果を書く",
        "利用者の承認を得てから行う",
        "候補や取り込み先、依存・設定・環境が変わったら",
        "必須のCIが失敗・未実行・古い結果ならマージを止める",
        "統括はcommit・push前に手元の秘密情報確認の成功を照合する",
        "対象コミット・範囲・コマンド・実行場所・結果と、実施したCIへのリンクを記録する",
        "直した差分のコードレビュー",
      ]);
      containsAll(review, [
        "codex exec -s read-only",
        "文書・テストだけの差分でも独立して再レビューする",
      ]);
      if (!local) {
        expect(workflow).toContain("PR先端のSHA、取り込み先の基点、実際のcheckoutのSHA");
      }
    }
    const claude = contentOf(files, ".claude/agents/quality-checker.md");
    const codex = parseToml(contentOf(files, ".codex/agents/quality_checker.toml"));
    for (const text of [claude, String(codex["developer_instructions"])]) {
      containsAll(text, [
        "| チェック | 対象範囲 | コマンド | 結果・補足 |",
        "証拠と残存プロセスを報告",
        "実行せずに理由と範囲を統括に報告",
      ]);
    }
    for (const role of ["planner", "plan_reviewer", "code_reviewer"]) {
      expect(parseToml(contentOf(files, `.codex/agents/${role}.toml`))["sandbox_mode"]).toBe(
        "read-only",
      );
    }
  });
});

it("C-35 C-83 #97 AC-4: 要件・配布・既存の記録に関する説明をそろえる", () => {
  const read = (path: string): string =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  containsAll(read("docs/requirements/common/workflow.md"), [
    "実行場所・結果・CIへのリンク",
    "工程の記録は統括だけが書く",
    "工程・試行・測定範囲",
    "進行の記録への追記や転記は行わない",
    "既存のPR本文またはIssueの記録",
    "取り込み先の基点・checkoutのSHA",
    "手で要約する",
    "工程の記録・使用量の表・要約への転記ではパスやコマンドラインも省く",
  ]);
  expect(read("docs/requirements/functional.md")).toContain(
    "この要約のために、再開に使う進行の記録へ追記・転記する手順は設けない",
  );
  containsAll(read("docs/design/documents.md"), [
    "工程の記録",
    "時差付きISO 8601",
    "経過時間と実行時間は秒",
    "トークン数",
    "使った単位・範囲・取得元",
    "未取得の理由",
    "管理対象は `harness update` で更新する",
    "ローカルIssueのREADMEは統括が必要に応じて手で更新する",
  ]);
  containsAll(read("docs/design/adopt.md"), [
    "既存のPR本文またはIssueの記録",
    "手元のGitでは既存のIssueの記録を使う",
    "統括が必要な節を既存の様式に手で足す",
  ]);
  const localDesign = read("docs/design/local-git.md");
  containsAll(localDesign, [
    "Issueの「工程の記録」",
    "実行したコマンドは別欄の「検証の記録」に残す",
  ]);
  expect(localDesign.indexOf("Issueの「工程の記録」")).toBeGreaterThan(
    localDesign.indexOf("`npm run merge:check -- <ブランチ名>`"),
  );
  const changelog = read("CHANGELOG.md").split("## 0.5.0\n")[1]?.split("\n## ")[0] ?? "";
  containsAll(changelog, ["既にあるPR・Issueのファイルには統括が手で節を足す", "工程の記録"]);
});
