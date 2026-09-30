import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  collectSpecIds,
  expandRange,
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
