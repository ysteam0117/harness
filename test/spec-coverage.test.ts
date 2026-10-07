import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  collectSpecIds,
  expandRange,
  findTableMismatches,
  findUnassigned,
  parseSourceLine,
} from "../scripts/check-spec-coverage.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("#30 AC-4: expandRange", () => {
  it("#30 AC-4: C-12〜C-20 を9件に展開する", () => {
    const ids = expandRange("C-12〜C-20");
    expect(ids).toHaveLength(9);
    expect(ids[0]).toBe("C-12");
    expect(ids[8]).toBe("C-20");
    expect(ids).toContain("C-15");
  });

  it("#30 AC-4: 全角の「～」も受け付ける", () => {
    expect(expandRange("C-12～C-20")).toEqual(expandRange("C-12〜C-20"));
  });

  it("#30 AC-4: 桁が変わる範囲でも2桁で揃える（C-08〜C-10）", () => {
    expect(expandRange("C-08〜C-10")).toEqual(["C-08", "C-09", "C-10"]);
  });

  it("#30 AC-4: 逆順はエラー", () => {
    expect(() => expandRange("C-20〜C-12")).toThrow();
  });
});

describe("#30 AC-4: parseSourceLine", () => {
  it("#30 AC-4: HTMLコメントの形から C-05・C-42・C-75 を取り出し、F-xx や括弧は数えない", () => {
    const ids = parseSourceLine("<!-- もとになった共通仕様：C-05・C-42・C-75（F-25） -->");
    expect([...ids].sort()).toEqual(["C-05", "C-42", "C-75"]);
  });

  it("#30 AC-4: 「# 」で始まる形も読める", () => {
    const ids = parseSourceLine("# もとになった共通仕様：C-05・C-42・C-75（F-25）");
    expect([...ids].sort()).toEqual(["C-05", "C-42", "C-75"]);
  });

  it("#30 AC-4: F-xx だけの項目は数えない", () => {
    const ids = parseSourceLine("<!-- もとになった共通仕様：C-05・F-25 -->");
    expect([...ids]).toEqual(["C-05"]);
  });

  it("#30 AC-4: 範囲（C-27〜C-29）を展開する", () => {
    const ids = parseSourceLine("<!-- もとになった共通仕様：C-03・C-27〜C-29 -->");
    expect([...ids].sort()).toEqual(["C-03", "C-27", "C-28", "C-29"]);
  });

  it("#30 AC-4: どの形にも当たらない項目はエラー", () => {
    expect(() => parseSourceLine("<!-- もとになった共通仕様：C-05・あいうえお -->")).toThrow();
  });
});

describe("#30 AC-4: findUnassigned（仮のフォルダ）", () => {
  let tmp: string;
  const readmeRows = (ids: string[]) =>
    [
      "# 仮の要件定義",
      "",
      "| 番号 | 内容 | 場所 |",
      "| --- | --- | --- |",
      ...ids.map(
        (id) => `| [${id}](common/x.md#${id.toLowerCase()}) | テスト用の項目 | common/x.md |`,
      ),
      "",
    ].join("\n");

  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "leatherjacket-spec-"));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function setup(name: string, readmeIds: string[], files: Record<string, string>) {
    const dir = path.join(tmp, name);
    const templates = path.join(dir, "templates");
    mkdirSync(templates, { recursive: true });
    const readme = path.join(dir, "README.md");
    writeFileSync(readme, readmeRows(readmeIds), "utf8");
    for (const [rel, body] of Object.entries(files)) {
      const p = path.join(templates, rel);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, body, "utf8");
    }
    return { readme, templates };
  }

  it("#30 AC-4: collectSpecIds がテンプレート全体（入れ子・SKILL.md の frontmatter 後を含む）から番号を集める", async () => {
    const { templates } = setup("collect", ["C-01"], {
      "a.md": "<!-- もとになった共通仕様：C-01・C-02 -->\n本文\n",
      "sub/SKILL.md": "---\nname: x\n---\n<!-- もとになった共通仕様：C-03〜C-04 -->\n",
      "sub/rules.txt": "# もとになった共通仕様：C-05（F-25）\n",
    });
    const ids = await collectSpecIds(templates);
    expect([...ids].sort()).toEqual(["C-01", "C-02", "C-03", "C-04", "C-05"]);
  });

  it("#30 AC-4: 未割り当ての番号があると、その番号を返す", async () => {
    const { readme, templates } = setup("unassigned", ["C-01", "C-02", "C-03"], {
      "a.md": "<!-- もとになった共通仕様：C-01 -->\n",
      "b.md": "<!-- もとになった共通仕様：C-03 -->\n",
    });
    const result = await findUnassigned(readme, templates);
    expect([...result]).toEqual(["C-02"]);
  });

  it("#30 AC-4: すべて割り当て済みなら空", async () => {
    const { readme, templates } = setup("complete", ["C-01", "C-02"], {
      "a.md": "<!-- もとになった共通仕様：C-01・C-02 -->\n",
    });
    expect([...(await findUnassigned(readme, templates))]).toEqual([]);
  });

  it("#30 AC-4: README に無い番号がテンプレートにあるとエラー", async () => {
    const { readme, templates } = setup("extra", ["C-01"], {
      "a.md": "<!-- もとになった共通仕様：C-01・C-99 -->\n",
    });
    await expect(Promise.resolve().then(() => findUnassigned(readme, templates))).rejects.toThrow();
  });
});

describe("#30 AC-4: 今のリポジトリ全体", () => {
  it("#30 AC-4: docs/requirements/README.md と templates/ で未割り当てが0件", async () => {
    const result = await findUnassigned(
      path.join(rootDir, "docs", "requirements", "README.md"),
      path.join(rootDir, "templates"),
    );
    expect([...result]).toEqual([]);
  });
});

describe("#37: C-81（設計書）と F-24（良い例・悪い例）", () => {
  it("C-81 が README にあり、テンプレートに割り当てられている", () => {
    const readme = readFileSync(path.join(rootDir, "docs", "requirements", "README.md"), "utf8");
    expect(readme).toContain("[C-81](common/workflow.md#c-81)");
    expect([...collectSpecIds(path.join(rootDir, "templates"))]).toContain("C-81");
  });

  it("C-34（完了の定義）の関係する文書に設計書があり、C-81 の節に書くことが決まっている", () => {
    const workflow = readFileSync(
      path.join(rootDir, "docs", "requirements", "common", "workflow.md"),
      "utf8",
    );
    const done = workflow.slice(workflow.indexOf("## C-34"), workflow.indexOf("## C-35"));
    expect(done).toContain("設計書");
    const c81 = workflow.slice(workflow.indexOf("## C-81"), workflow.indexOf("## C-83"));
    expect(c81).toContain("docs/design/overview.md");
    expect(c81).toContain("書き写さない");
    expect(c81).toContain("実装したPRの中で更新する");
  });

  it("F-24 に、良い例・悪い例の決まり（テストで確かめたものに限る・書き写さない）がある", () => {
    const functional = readFileSync(
      path.join(rootDir, "docs", "requirements", "functional.md"),
      "utf8",
    );
    const f24 = functional.slice(
      functional.indexOf("## F-24"),
      functional.indexOf("### バージョンの選び方"),
    );
    expect(f24).toContain("良い例と悪い例");
    expect(f24).toContain("テストで動作を確かめたものに限る");
    expect(f24).toContain("書き写さない");
    expect(f24).toContain("{{example:");
  });
});

// #3（旧 #38）F-22：テンプレートの冒頭の番号の一覧が、F-21 の表と一致していること
describe("#3 F-21 の表とテンプレートの一致（findTableMismatches）", () => {
  let dir: string;
  const write = (rel: string, text: string) => {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  };
  const FUNCTIONAL = [
    "## F-20",
    '<a id="f-21"></a>',
    "## F-21",
    "**核（`AGENTS.md`に常に書く）**",
    "- 作業の流れ（[C-01](a#c-01)・[C-21](a#c-21)〜[C-23](a#c-23)）",
    "- `CLAUDE.md`：Superpowers（[C-11](a#c-11)）",
    "",
    "**Skill（その作業のときだけ読み込む）**",
    "",
    "| Skill | 含める共通仕様 | 主に読む役割 |",
    "| --- | --- | --- |",
    "| レビュー | [C-33](a#c-33)と、レビューの実行方法 | 計画レビュー |",
    "| 知見 | [F-18](#f-18)・[C-56](a#c-56)と、知見 | 全役割 |",
    '<a id="f-22"></a>',
    "## F-22",
  ].join("\n");

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "harness-q3-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const setup = (over: Record<string, string> = {}) => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    mkdirSync(dir, { recursive: true });
    const files: Record<string, string> = {
      "functional.md": FUNCTIONAL,
      "templates/AGENTS.md": "<!-- もとになった共通仕様：C-01・C-21〜C-23 -->\n# 核\n",
      "templates/CLAUDE.md": "@AGENTS.md\n\n<!-- もとになった共通仕様：C-11 -->\n",
      "templates/skills/review/SKILL.md":
        "---\nname: review\n---\n\n<!-- もとになった共通仕様：C-33 -->\n",
      "templates/skills/knowledge/SKILL.md":
        "---\nname: knowledge\n---\n\n<!-- もとになった共通仕様：F-18・C-56 -->\n",
      ...over,
    };
    for (const [rel, text] of Object.entries(files)) write(rel, text);
    return () => findTableMismatches(path.join(dir, "functional.md"), path.join(dir, "templates"));
  };

  it("表と一致していれば空", () => {
    expect(setup()()).toEqual([]);
  });

  it("AC-1：テンプレートにあって表に無い番号・表にあってテンプレートに無い番号を、両方とも返す", () => {
    const run = setup({
      "templates/AGENTS.md": "<!-- もとになった共通仕様：C-01・C-21・C-22・C-99 -->\n",
    });
    const result = run();
    expect(result.join("\n")).toContain("templates/AGENTS.md");
    expect(result.join("\n")).toContain("C-23");
    expect(result.join("\n")).toContain("C-99");
  });

  it("AC-1：別のテンプレートに割り当てた番号（Skill の取り違え）を検出する", () => {
    const run = setup({
      "templates/skills/review/SKILL.md":
        "---\nname: review\n---\n\n<!-- もとになった共通仕様：C-56 -->\n",
    });
    expect(run().join("\n")).toContain("templates/skills/review/SKILL.md");
  });

  it("AC-2：番号の一覧が欠けたテンプレートを検出する", () => {
    const run = setup({ "templates/CLAUDE.md": "@AGENTS.md\n" });
    expect(run().join("\n")).toMatch(/templates\/CLAUDE\.md.*一覧がありません/);
  });

  it("AC-2：一覧が冒頭（最初の見出しより前）に無く、本文や末尾にだけある場合も、欠けとして検出する", () => {
    const run = setup({
      "templates/AGENTS.md": "# 核\n\n本文\n\n<!-- もとになった共通仕様：C-01・C-21〜C-23 -->\n",
    });
    expect(run().join("\n")).toMatch(/templates\/AGENTS\.md.*一覧がありません/);
  });

  it("F-21 の表に同じ Skill の行が複数あると、エラーにする（後の行が先の行を上書きして見逃さない）", () => {
    const run = setup({
      "functional.md": FUNCTIONAL.replace(
        "| レビュー | [C-33](a#c-33)と、レビューの実行方法 | 計画レビュー |",
        "| レビュー | [C-56](a#c-56) | 計画レビュー |\n| レビュー | [C-33](a#c-33)と、レビューの実行方法 | 計画レビュー |",
      ),
    });
    expect(run).toThrow(/同じ Skill の行が複数あります：レビュー/);
  });

  it("表に無い Skill のフォルダがあると検出する", () => {
    const run = setup({
      "templates/skills/extra/SKILL.md":
        "---\nname: extra\n---\n\n<!-- もとになった共通仕様：C-33 -->\n",
    });
    expect(run().join("\n")).toContain("templates/skills/extra/SKILL.md");
  });

  it("今のリポジトリ（docs/requirements/functional.md と templates/）で食い違いが0件", () => {
    expect(
      findTableMismatches(
        path.join(rootDir, "docs", "requirements", "functional.md"),
        path.join(rootDir, "templates"),
      ),
    ).toEqual([]);
  });
});
