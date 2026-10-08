// #18 PR-B：adopt が追加する .github/workflows/harness-check.yml（秘密情報の確認・npm audit）。
// 想定する型：buildAdoptFiles({ answers, profiles?, nodeApp? })。ファイルは kind: "file"、管理するファイルの範囲にある。
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildAdoptFiles } from "../../src/adopt/build.js";
import { skippedAuditDirs } from "../../src/adopt/ci.js";
import { REPORT_TEMPLATE, gitleaksImage } from "../../src/adopt/secret-scan.js";
import { isManagedPath } from "../../src/generate/project.js";
import { cleanupProjectTmp, completeAnswers } from "../generate/project-helpers.js";

afterEach(cleanupProjectTmp);

const PATH = ".github/workflows/harness-check.yml";

async function build(over: Record<string, unknown> = {}, nodeDirs: string[] = []) {
  const files = buildAdoptFiles({ answers: await completeAnswers(over), nodeDirs });
  return files.find((f) => f.path === PATH);
}

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Workflow {
  name: string;
  on: { push: { branches: string[] }; pull_request: unknown };
  permissions: Record<string, string>;
  jobs: Record<string, { steps: Step[]; "runs-on": string }>;
}
const workflow = (text: string): Workflow => parseYaml(text) as Workflow;

describe("#18-B：harness-check.yml を出す条件", () => {
  for (const check_location of ["github_actions", "both"]) {
    it(`repository: github・check_location: ${check_location}：出す（kind: file）`, async () => {
      const file = await build({ repository: "github", check_location });
      expect(file?.kind).toBe("file");
      expect(file?.content.endsWith("\n")).toBe(true);
      expect(file?.content.endsWith("\n\n")).toBe(false);
    });
  }

  it("repository: local：出さない", async () => {
    expect(await build({ repository: "local", check_location: "both" })).toBeUndefined();
  });

  it("check_location: local：出さない", async () => {
    expect(await build({ repository: "github", check_location: "local" })).toBeUndefined();
  });

  it("管理するファイルの範囲にある（ほかのワークフローは管理しない）", () => {
    expect(isManagedPath(PATH)).toBe(true);
    expect(isManagedPath(".github/workflows/ci.yml")).toBe(false);
    expect(isManagedPath(".github/workflows/check.yml")).toBe(false);
  });
});

describe("#18-B：harness-check.yml の中身（秘密情報の確認）", () => {
  it("YAML として読め、push（main）と pull_request で動き、権限は contents: read だけ", async () => {
    const wf = workflow((await build())?.content ?? "");
    expect(wf.on.push.branches).toEqual(["main"]);
    expect(wf.on).toHaveProperty("pull_request");
    expect(wf.permissions).toEqual({ contents: "read" });
  });

  it("secret-scan の job：履歴をすべて取得し、認証情報を残さず、gitleaks を固定のイメージで動かす", async () => {
    const text = (await build())?.content ?? "";
    const wf = workflow(text);
    const job = wf.jobs["secret-scan"];
    expect(job?.["runs-on"]).toBe("ubuntu-latest");
    const checkout = job?.steps.find((s) => s.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    // 既存の生成したアプリのワークフローと同じ書き方（タグで固定）
    expect(checkout?.uses).toMatch(/^actions\/checkout@v\d+\.\d+\.\d+$/);
    const run = job?.steps.map((s) => s.run ?? "").join("\n") ?? "";
    // イメージは profile.yaml の値と同じ（二重に持たない）
    expect(run).toContain(gitleaksImage());
    expect(run).toContain("--network none");
    expect(run).toContain("--redact");
    expect(run).toContain("--exit-code 1");
    expect(run).toMatch(/git \/src/);
    // 読み取り専用で対象を置く
    expect(run).toMatch(/:\/src:ro/);
  });

  it("標準エラーを破棄し、レポートは値を含まない4項目のテンプレートで標準出力に出す（R1）", async () => {
    const text = (await build())?.content ?? "";
    const wf = workflow(text);
    const steps = wf.jobs["secret-scan"]?.steps ?? [];
    const scan = steps.find((s) => (s.run ?? "").includes("docker run"));
    expect(scan?.run).toContain("2>/dev/null");
    expect(scan?.run).not.toMatch(/2>&1/);
    expect(scan?.run).toContain("--report-format template");
    expect(scan?.run).toContain("--report-path -");
    // テンプレートは、#17 と同じもの（二重に持たない）。値の入りうる項目を出さない
    expect(scan?.env?.["REPORT_TEMPLATE"]).toBe(REPORT_TEMPLATE);
    for (const word of ["Secret", "Match", "Message", "Line}", "Author", "Email"]) {
      expect(REPORT_TEMPLATE.includes(word), word).toBe(false);
    }
    // 実行の出力を変数に取り、決まった文だけを出す
    expect(scan?.run).toContain("秘密情報は見つかりませんでした");
    expect(scan?.run).toContain("秘密情報の確認を完了できませんでした");
    // 標準エラーをそのまま出す形・ログの詳細の指定が無い
    expect(scan?.run).not.toMatch(/--verbose|-v\b(?!\s)|--log-level\s+(debug|trace|info)/);
  });

  it("対象のリポジトリの .gitleaks.toml は gitleaks が使う（--config で別の設定を渡さない）", async () => {
    const text = (await build())?.content ?? "";
    expect(text).not.toContain("--config");
    expect(text).not.toContain("--no-git");
  });

  it("Lint・型・テストの job を入れず、#21 で足すとコメントに書く", async () => {
    const text = (await build())?.content ?? "";
    const wf = workflow(text);
    expect(Object.keys(wf.jobs)).toEqual(["secret-scan"]);
    expect(text).not.toMatch(/eslint|tsc|npm test|npm run (lint|check|test)/);
    expect(text).toContain("#21");
  });

  it("置き換えの名前（{{...}}）が残らない（Go のテンプレートの {{ ... }} は値の中にある）", async () => {
    for (const nodeDirs of [[], ["."]]) {
      const text = (await build({}, nodeDirs))?.content ?? "";
      expect(text).not.toMatch(/\{\{[a-z][a-z0-9_]*\}\}/);
    }
  });

  it("秘密らしい値・トークンの形を、ファイルに書かない", async () => {
    const text = (await build({}, ["."]))?.content ?? "";
    expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}/);
    expect(text).not.toMatch(/secrets\./);
  });
});

describe("#18-B：harness-check.yml の npm audit（Node のアプリのときだけ）", () => {
  it("Node のアプリがない：npm-audit の job が無い", async () => {
    const text = (await build({}, []))?.content ?? "";
    expect(Object.keys(workflow(text).jobs)).toEqual(["secret-scan"]);
    expect(text).not.toContain("npm audit");
  });

  it("Node のアプリがある：npm-audit の job が加わる。本番の依存・high 以上で失敗する", async () => {
    const text = (await build({}, ["."]))?.content ?? "";
    const wf = workflow(text);
    expect(Object.keys(wf.jobs)).toEqual(["secret-scan", "npm-audit"]);
    const run = wf.jobs["npm-audit"]?.steps.map((s) => s.run ?? "").join("\n") ?? "";
    expect(run).toContain("npm audit --omit=dev --audit-level=high");
    // lock が無ければ旨を出して失敗にしない
    expect(run).toContain("package-lock.json");
    expect(run).toMatch(/exit 0|ありません/);
    // secret-scan は変わらない
    const base = workflow((await build({}, []))?.content ?? "");
    expect(wf.jobs["secret-scan"]).toEqual(base.jobs["secret-scan"]);
  });

  it("Node のアプリがあるときも、ファイルは1つの YAML で、末尾の改行は1つ", async () => {
    const text = (await build({}, ["."]))?.content ?? "";
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text.includes("\r")).toBe(false);
  });
});

describe("#18-B R1：レポートの表示は検証してから出す", () => {
  it("種類（RuleID）は出さない。File は JSON の文字列として制御文字を逃がす", async () => {
    const text = (await build())?.content ?? "";
    const run =
      workflow(text).jobs["secret-scan"]?.steps.find((s) => s.name === "秘密情報の確認")?.run ?? "";
    expect(run).toContain("jq");
    expect(run).not.toContain("RuleID");
    expect(run).not.toContain("種類 ");
    expect(run).toContain("tojson");
  });
});

describe("#18-B npm audit は、記録したアプリのフォルダだけを確かめる", () => {
  it("フォルダの一覧が matrix で渡り、シェルに文字列として埋め込まない。find でリポジトリ全体を探さない", async () => {
    const text = (await build({}, ["backend", "frontend"]))?.content ?? "";
    const job = (parseYaml(text) as { jobs: Record<string, Record<string, unknown>> }).jobs[
      "npm-audit"
    ] as {
      strategy: { "fail-fast": boolean; matrix: { dir: string[] } };
      steps: { run?: string; env?: Record<string, string> }[];
    };
    expect(job.strategy.matrix.dir).toEqual(["backend", "frontend"]);
    expect(job.strategy["fail-fast"]).toBe(false);
    const step = job.steps.find((s) => (s.run ?? "").includes("npm audit"));
    expect(step?.env?.["AUDIT_DIR"]).toBe("${{ matrix.dir }}");
    expect(step?.run).not.toContain("matrix");
    expect(step?.run).not.toContain("find ");
    expect(step?.run).toContain("npm audit --omit=dev --audit-level=high");
    expect(step?.run).toContain('"$AUDIT_DIR/package-lock.json"');
  });

  const matrixOf = (text: string): string[] =>
    (
      (parseYaml(text) as { jobs: Record<string, { strategy: { matrix: { dir: string[] } } }> })
        .jobs["npm-audit"] as { strategy: { matrix: { dir: string[] } } }
    ).strategy.matrix.dir;

  it("除外するのは、絶対パス・..・${{ ・制御文字（改行など）を含むフォルダだけ", async () => {
    const dirs = [
      "ok-app",
      "../outside",
      "a/../b",
      "/abs",
      "C:/abs",
      "a${{ secrets.X }}",
      "n\nl",
      "t\tab",
      "sub/dir",
    ];
    const text = (await build({}, dirs))?.content ?? "";
    expect(matrixOf(text)).toEqual(["ok-app", "sub/dir"]);
    expect(text).not.toContain("secrets.X");
    expect(text).not.toContain("outside");
    expect(skippedAuditDirs(dirs).map((x) => x.dir)).toEqual([
      "../outside",
      "a/../b",
      "/abs",
      "C:/abs",
      "a${{ secrets.X }}",
      "n\\nl",
      "t\\tab",
    ]);
  });

  it("日本語・括弧・スペース・引用符・バックスラッシュのフォルダは、matrix に入り、YAML として解析でき、AUDIT_DIR で渡る", async () => {
    const dirs = ["apps/顧客管理", "apps/customer(legacy)", "apps/my app", 'q"x', "a\\b", "-dash"];
    const text = (await build({}, dirs))?.content ?? "";
    expect([...matrixOf(text)].sort()).toEqual([...dirs].sort());
    const job = (parseYaml(text) as { jobs: Record<string, { steps: Step[] }> }).jobs[
      "npm-audit"
    ] as { steps: Step[] };
    const step = job.steps.find((x) => (x.run ?? "").includes("npm audit"));
    // シェルには、環境変数として渡す（matrix の値をシェルの文字列に埋め込まない）
    expect(step?.env?.["AUDIT_DIR"]).toBe("${{ matrix.dir }}");
    expect(step?.run).not.toContain("matrix");
    // 先頭が - のフォルダでも、cd のオプションにならない
    expect(step?.run).toContain('cd -- "$AUDIT_DIR"');
    expect(skippedAuditDirs(dirs)).toEqual([]);
  });

  it("安全なフォルダが1つもなければ、npm-audit の job を出さない", async () => {
    const text = (await build({}, ["../x", "/y"]))?.content ?? "";
    expect(Object.keys(workflow(text).jobs)).toEqual(["secret-scan"]);
  });
});
