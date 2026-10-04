// #61 AC-1・AC-3：リポジトリの置き場所（C-83）による、生成するファイルの出し分け（メモリ上の buildProject の結果）
//   local（使わない）：.github/・LICENSE・check.yml がなく、docs/issues/・.githooks/pre-commit・scripts/merge-check.mjs・
//     docs/harness-feedback/README.md・scripts の merge:check がある。AGENTS.md・CLAUDE.md・Skill・agents・README・docs/secrets.md に GitHub の語が残らない
//   github：逆
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildProject, type ProjectFile } from "../../src/generate/project.js";
import { LEFTOVER_NAME } from "./helpers.js";
import { contentOf, expectedManaged, pathsOf, projectInput } from "./project-helpers.js";

const LOCAL = { repository: "local", visibility: "private", check_location: "local" };

async function generate(over: Record<string, unknown>): Promise<ProjectFile[]> {
  return buildProject(await projectInput(over)).files;
}

const LOCAL_ONLY = [
  "docs/issues/README.md",
  "docs/issues/_template.md",
  "docs/issues/0001-replace-icons.md",
  ".githooks/pre-commit",
  "scripts/merge-check.mjs",
  "docs/harness-feedback/README.md",
];

/** GitHub の機能・語（local の出力に残してはいけないもの。語の境界を見る） */
const GITHUB_WORDS: [string, RegExp][] = [
  ["gh コマンド", /\bgh /],
  ["Closes", /Closes/],
  ["pull request", /pull request/i],
  ["PR", /\bPR\b/],
  ["GitHub Actions", /GitHub Actions/],
  ["Secrets", /\bSecrets\b/],
  [".github/", /\.github\//],
];

/** AI 向けのルール・Skill・エージェント・README（知見の写し references/ は、ハーネスの知見のそのままの写しなので除く） */
const isRuleFile = (p: string): boolean =>
  p === "AGENTS.md" ||
  p === "CLAUDE.md" ||
  p === "README.md" ||
  p === "docs/secrets.md" ||
  /^\.(claude|agents)\/skills\/[^/]+\/SKILL\.md$/.test(p) ||
  /^\.(claude|codex)\/agents\//.test(p);

describe("#61 AC-1: local のときに出るファイル", () => {
  it("#61 AC-1: .github/・LICENSE・check.yml は出ず、Issue のファイル・フック・取り込みのコマンド・下書きの案内が出る", async () => {
    const files = await generate(LOCAL);
    const paths = pathsOf(files);
    expect(paths.some((p) => p.startsWith(".github/"))).toBe(false);
    expect(paths).not.toContain("LICENSE");
    for (const p of LOCAL_ONLY) expect(paths).toContain(p);
  });

  it("#61 AC-1: フックは executable。ほかのファイルは executable ではない", async () => {
    const files = await generate(LOCAL);
    expect(files.filter((f) => f.executable).map((f) => f.path)).toEqual([".githooks/pre-commit"]);
    expect(contentOf(files, ".githooks/pre-commit").startsWith("#!/bin/sh\n")).toBe(true);
  });

  it("#61 AC-1: 管理するファイルは、フック・取り込みのコマンド・Issue のひな形・下書きの案内。Issue 一覧と各 Issue はプロジェクトのもの", async () => {
    const files = await generate(LOCAL);
    for (const f of files) expect(f.managed, f.path).toBe(expectedManaged(f.path));
    const managed = (p: string) => files.find((f) => f.path === p)?.managed;
    expect(managed(".githooks/pre-commit")).toBe(true);
    expect(managed("scripts/merge-check.mjs")).toBe(true);
    expect(managed("docs/issues/_template.md")).toBe(true);
    expect(managed("docs/harness-feedback/README.md")).toBe(true);
    expect(managed("docs/issues/README.md")).toBe(false);
    expect(managed("docs/issues/0001-replace-icons.md")).toBe(false);
  });

  it("#61 AC-1: package.json の scripts に merge:check があり、依存は増えない", async () => {
    const local = parse(contentOf(await generate(LOCAL), "package.json")) as Record<
      string,
      unknown
    >;
    const github = parse(contentOf(await generate({}), "package.json")) as Record<string, unknown>;
    expect((local["scripts"] as Record<string, string>)["merge:check"]).toBe(
      "node scripts/merge-check.mjs",
    );
    expect(local["dependencies"]).toEqual(github["dependencies"]);
    expect(local["devDependencies"]).toEqual(github["devDependencies"]);
  });

  it("#61 AC-1: .harness/config.yaml の answers に repository が記録される", async () => {
    const local = parse(contentOf(await generate(LOCAL), ".harness/config.yaml")) as {
      answers: Record<string, string>;
    };
    expect(local.answers["repository"]).toBe("local");
    expect(local.answers["visibility"]).toBe("private");
    expect(local.answers["check_location"]).toBe("local");
    const github = parse(contentOf(await generate({}), ".harness/config.yaml")) as {
      answers: Record<string, string>;
    };
    expect(github.answers["repository"]).toBe("github");
  });

  it("#61 AC-1: Issue のファイルに、番号・親・状態（未着手）・受け入れ条件がある。取り込みのコマンドが状態の行を書き換えられる", async () => {
    const files = await generate(LOCAL);
    const issue = contentOf(files, "docs/issues/0001-replace-icons.md");
    expect(issue).toMatch(/^- 番号：1$/m);
    expect(issue).toMatch(/^- 親：/m);
    expect(issue).toMatch(/^- 状態：未着手$/m);
    expect(issue).toContain("AC-1");
    const template = contentOf(files, "docs/issues/_template.md");
    for (const heading of ["受け入れ条件", "レビューの記録", "知見"]) {
      expect(template).toContain(`## ${heading}`);
    }
    expect(template).toMatch(/^- 状態：未着手$/m);
  });
});

describe("#61 AC-1: github のときに出るファイル", () => {
  it("#61 AC-1: .github/ があり、local のファイルと merge:check はない", async () => {
    const files = await generate({});
    const paths = pathsOf(files);
    expect(paths).toContain(".github/pull_request_template.md");
    expect(paths).toContain(".github/ISSUE_TEMPLATE/parent.md");
    for (const p of LOCAL_ONLY) expect(paths).not.toContain(p);
    const packageJson = parse(contentOf(files, "package.json")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts).not.toHaveProperty("merge:check");
    expect(files.some((f) => f.executable)).toBe(false);
  });
});

describe("#61 AC-3: 出力の中身", () => {
  it("#61 AC-3: local の AGENTS.md・CLAUDE.md・Skill・agents・README・docs/secrets.md に、GitHub の語が残らない", async () => {
    const files = (await generate(LOCAL)).filter((f) => isRuleFile(f.path));
    expect(files.map((f) => f.path)).toEqual(
      expect.arrayContaining(["AGENTS.md", "README.md", "docs/secrets.md"]),
    );
    for (const f of files) {
      for (const [name, re] of GITHUB_WORDS) {
        expect(f.content, `${f.path} の ${name}`).not.toMatch(re);
      }
    }
  });

  it("#61 AC-3: local の AGENTS.md に、docs/issues/・merge:check・フックの手順がある", async () => {
    const agents = contentOf(await generate(LOCAL), "AGENTS.md");
    expect(agents).toContain("docs/issues/");
    expect(agents).toContain("npm run merge:check");
    expect(agents).toContain(".githooks/pre-commit");
  });

  it("#61 AC-3: github の出力に、merge:check・.githooks・docs/issues/ が残らない", async () => {
    const files = (await generate({})).filter(
      (f) => isRuleFile(f.path) || f.path.startsWith("docs/"),
    );
    for (const f of files) {
      expect(f.content, f.path).not.toContain("merge:check");
      expect(f.content, f.path).not.toContain(".githooks");
      expect(f.content, f.path).not.toContain("docs/issues/");
    }
  });

  it("#61 AC-3: github の AGENTS.md には、PR・Closes・Squash の手順が残る", async () => {
    const agents = contentOf(await generate({}), "AGENTS.md");
    expect(agents).toContain("**PRを作る**");
    expect(agents).toContain("Closes #<子Issue番号>");
  });

  it("#61 AC-3: local・github のどちらでも、{{ が残らない", async () => {
    for (const over of [LOCAL, {}, { check_location: "github_actions" }]) {
      for (const f of await generate(over)) {
        // GitHub Actions の式（${{ secrets.… }}）は、ワークフローの書き方そのもの
        if (f.encoding === "base64" || f.path.startsWith(".github/workflows/")) continue;
        expect(f.content, f.path).not.toMatch(LEFTOVER_NAME);
        expect(f.content, f.path).not.toContain("{{");
      }
    }
  });

  it("#61 AC-3: README の GitHub の手順は、回答の公開範囲と品質チェックの実行場所に合わせる", async () => {
    const both = contentOf(
      await generate({ visibility: "public", check_location: "both" }),
      "README.md",
    );
    expect(both).toContain("gh repo create testapp-001 --public --source=. --push");
    expect(both).toContain("`ENV_TEST`");
    const priv = contentOf(await generate({ check_location: "github_actions" }), "README.md");
    expect(priv).toContain("gh repo create testapp-001 --private --source=. --push");
  });

  it("#61 AC-3: local の README に、最初のコミットまでの手順が並ぶ", async () => {
    const readme = contentOf(await generate(LOCAL), "README.md");
    const order = [
      "git init -b main",
      "git config core.hooksPath .githooks",
      "npm install",
      "git add -A",
      'git commit -m "chore: 生成した初期状態"',
      "git switch -c feature/1-replace-icons",
      "npm run merge:check",
    ];
    let at = -1;
    for (const part of order) {
      const next = readme.indexOf(part, at + 1);
      expect(next, part).toBeGreaterThan(at);
      at = next;
    }
  });

  it("#61 AC-3: local の .prettierignore は、フックと取り込みのコマンドを書式の確認から外す", async () => {
    const ignore = contentOf(await generate(LOCAL), ".prettierignore");
    expect(ignore).toContain("scripts/merge-check.mjs");
    expect(ignore).toContain(".githooks");
  });
});
