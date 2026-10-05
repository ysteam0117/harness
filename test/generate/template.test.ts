// 想定する型（実装は src/generate/template.ts・errors.ts をこれに合わせる）
//
//   export class GenerateError extends Error {}   // errors.ts。name は "GenerateError"。メッセージは日本語
//
//   export function renderTemplate(
//     template: string,                       // ひな形の中身
//     values: Record<string, string>,         // 名前 → 値（回答）
//     options: { templatesDir: string; fileName: string },
//     // templatesDir：{{include:<分類>/_shared}} の引用先を探すひな形の場所
//     // fileName：エラーのメッセージに入れるファイルの名前
//   ): string;                                // 差し込んだ後の文字列（改行は LF）
import { afterAll, describe, expect, it } from "vitest";
import { GenerateError } from "../../src/generate/errors.js";
import { expandExamples, listExampleRegions, renderTemplate } from "../../src/generate/template.js";
import { cleanupTemplates, fixturesDir, makeTemplates } from "./helpers.js";

afterAll(cleanupTemplates);

const opts = { templatesDir: fixturesDir, fileName: "SKILL.md" };

describe("#31 AC-1: 名前の置き換え", () => {
  it("#31 AC-1: {{名前}} が回答の値に置き換わる（同じ名前が複数回あってもすべて）", () => {
    const out = renderTemplate(
      "名前は {{app_name}}、もう一度 {{app_name}}、DB は {{db_kind}}",
      { app_name: "testapp_001", db_kind: "postgresql" },
      opts,
    );
    expect(out).toBe("名前は testapp_001、もう一度 testapp_001、DB は postgresql");
  });

  it("#31 AC-1: 値が空文字でも置き換わる", () => {
    expect(renderTemplate("a{{x}}b", { x: "" }, opts)).toBe("ab");
  });

  it("#31 AC-1: 未定義の名前が残るとエラーになり、ファイル名と足りない名前をすべて示す", () => {
    let error: unknown;
    try {
      renderTemplate(
        "{{app_name}} {{db_name}} {{other_name}} {{db_name}}",
        { app_name: "testapp_001" },
        { templatesDir: fixturesDir, fileName: "docs/sample.md" },
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(GenerateError);
    const message = (error as Error).message;
    expect(message).toContain("docs/sample.md");
    expect(message).toContain("db_name");
    expect(message).toContain("other_name");
    // 重複は除いて示す
    expect(message.split("db_name")).toHaveLength(2);
  });

  it("#31 AC-1: 値の中の {{x}} は再展開せず、そのまま残す", () => {
    const out = renderTemplate("{{a}}", { a: "{{b}}", b: "展開されてはいけない" }, opts);
    expect(out).toBe("{{b}}");
  });

  it("#31 AC-1: 値の中にある未定義の名前はエラーにしない（判定はひな形にもとからある名前だけ）", () => {
    expect(renderTemplate("{{a}}", { a: "{{zzz}}" }, opts)).toBe("{{zzz}}");
  });

  it("#31 AC-1: 値に $& や $1 を含んでも、そのまま入る", () => {
    expect(renderTemplate("{{a}}", { a: "$& $1 $$" }, opts)).toBe("$& $1 $$");
  });

  it("#31 AC-1: JSX の style={{ color: 'red' }} は触らず、エラーにもしない", () => {
    const src = 'const el = <div style={{ color: "red" }} data-x={{ a: 1 }} />;';
    expect(renderTemplate(src, {}, opts)).toBe(src);
  });

  it("#31 AC-1: 空白入りの {{ x }} は差し込みの対象にしない", () => {
    expect(renderTemplate("{{ x }} {{x}}", { x: "1" }, opts)).toBe("{{ x }} 1");
  });

  it("#31 AC-1: 名前の形は小文字で始まり、小文字・数字・_ だけ（大文字や - を含むものは対象外）", () => {
    const src = "{{Upper}} {{a-b}} {{1abc}}";
    expect(renderTemplate(src, {}, opts)).toBe(src);
  });

  it("#31 AC-1: 文字列でない値が渡されたらエラーにする", () => {
    for (const bad of [1, true, null, undefined, { a: 1 }, ["x"]]) {
      expect(() => renderTemplate("{{n}}", { n: bad as unknown as string }, opts)).toThrow(
        GenerateError,
      );
    }
  });

  it("#31 AC-1: 改行は LF にそろえる", () => {
    expect(renderTemplate("a\r\nb\r\n{{x}}\r\n", { x: "c" }, opts)).toBe("a\nb\nc\n");
  });
});

describe("#31 AC-2: {{include:...}} による共通の部分の引用", () => {
  it("#31 AC-2: 引用が共通の部分（_shared/SKILL.md）に置き換わる", () => {
    const out = renderTemplate(
      "前\n{{include:lib/_shared}}\n後\n",
      { app_name: "testapp_001" },
      opts,
    );
    expect(out).toContain("## 共通のルール");
    expect(out.startsWith("前\n")).toBe(true);
    expect(out.endsWith("後\n")).toBe(true);
    expect(out).not.toContain("{{include:");
  });

  it("#31 AC-2: 引用先の先頭の HTML コメントの行は取り除く", () => {
    const out = renderTemplate("{{include:lib/_shared}}", { app_name: "testapp_001" }, opts);
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("もとになった共通仕様");
  });

  it("#31 AC-2: 引用先の中の名前も置き換える", () => {
    const out = renderTemplate("{{include:lib/_shared}}", { app_name: "testapp_001" }, opts);
    expect(out).toContain("testapp_001 では、値をパラメータで渡す。");
    expect(out).not.toContain("{{app_name}}");
  });

  it("#31 AC-2: 引用先の中にある未定義の名前もエラーになる", () => {
    expect(() => renderTemplate("{{include:lib/_shared}}", {}, opts)).toThrow(/app_name/);
  });

  it("#31 AC-2: 本文の途中にあるコメントは取り除かない（先頭の行だけ）", () => {
    const dir = makeTemplates({
      "profiles/c/_shared/SKILL.md": "<!-- 説明 -->\n本文\n<!-- 途中のコメント -->\n続き\n",
    });
    const out = renderTemplate("{{include:c/_shared}}", {}, { templatesDir: dir, fileName: "x" });
    expect(out).not.toContain("説明");
    expect(out).toContain("<!-- 途中のコメント -->");
  });

  it("#31 AC-2: 引用先がなければエラーにする（引用の書き方を示す）", () => {
    expect(() => renderTemplate("{{include:lib/nothing}}", {}, opts)).toThrow(GenerateError);
    expect(() => renderTemplate("{{include:nocat/_shared}}", {}, opts)).toThrow(/nocat\/_shared/);
  });

  it.each([
    "{{include:lib}}",
    "{{include:lib/other}}",
    "{{include:../lib/_shared}}",
    "{{include:lib/../lib/_shared}}",
    "{{include:/lib/_shared}}",
    "{{include:lib\\_shared}}",
    "{{include:a/b/_shared}}",
  ])("#31 AC-2: 形の誤った引用 %s はエラーにする", (src) => {
    expect(() => renderTemplate(src, { app_name: "testapp_001" }, opts)).toThrow(GenerateError);
  });

  it("#31 AC-2: 引用の中の引用はエラーにする（循環を起こさない）", () => {
    const dir = makeTemplates({
      "profiles/c/_shared/SKILL.md": "{{include:c/_shared}}\n",
    });
    expect(() =>
      renderTemplate("{{include:c/_shared}}", {}, { templatesDir: dir, fileName: "x" }),
    ).toThrow(GenerateError);

    const dir2 = makeTemplates({
      "profiles/c/_shared/SKILL.md": "<!-- c -->\n前 {{include:d/_shared}}\n",
      "profiles/d/_shared/SKILL.md": "本文\n",
    });
    expect(() =>
      renderTemplate("{{include:c/_shared}}", {}, { templatesDir: dir2, fileName: "x" }),
    ).toThrow(GenerateError);
  });

  it("#31 AC-2: 引用先の中の CRLF も LF にそろえる", () => {
    const dir = makeTemplates({ "profiles/c/_shared/SKILL.md": "a\r\nb\r\n" });
    const out = renderTemplate("{{include:c/_shared}}", {}, { templatesDir: dir, fileName: "x" });
    expect(out).not.toContain("\r");
  });
});

describe("#31: 差し込みは決まった結果を返す", () => {
  it("#31 AC-1: 同じ入力で2回呼ぶと同じ結果になる", () => {
    const run = () =>
      renderTemplate("{{include:lib/_shared}}\n{{app_name}}", { app_name: "testapp_001" }, opts);
    expect(run()).toBe(run());
  });
});

// #37：{{example:<出力先のパス>#<名前>}}（生成物のテストのファイルから、良い例・悪い例の範囲を差し込む）
const EXAMPLE_FILE = [
  "// ファイルの先頭の説明",
  "import { x } from 'y';",
  "",
  "// #region example:good",
  "export function good() {",
  "  return 1;",
  "}",
  "// #endregion",
  "",
  "describe('テスト', () => {",
  "  // #region example:bad",
  "  function bad() {",
  "    return '{{x}}';",
  "  }",
  "  // #endregion",
  "});",
  "",
].join("\n");

const outputs = [{ path: "backend/src/rules-examples/a.test.ts", content: EXAMPLE_FILE }];
const exampleOpts = { fileName: "SKILL.md" };

function expandOne(spec: string, files = outputs): string {
  return expandExamples(`前\n{{example:${spec}}}\n後`, files, exampleOpts.fileName);
}

describe("#37: 例の差し込み（expandExamples）", () => {
  it("指定した範囲だけが、```ts のコードブロックで入り、region の行は残らない", () => {
    const out = expandOne("backend/src/rules-examples/a.test.ts#good");
    expect(out).toBe("前\n```ts\nexport function good() {\n  return 1;\n}\n```\n後");
    expect(out).not.toContain("#region");
    expect(out).not.toContain("#endregion");
    expect(out).not.toContain("import { x }");
  });

  it("字下げをそろえる（共通の字下げだけを除く）", () => {
    const out = expandOne("backend/src/rules-examples/a.test.ts#bad");
    expect(out).toBe("前\n```ts\nfunction bad() {\n  return '{{x}}';\n}\n```\n後");
  });

  it("差し込んだコードの中の {{名前}} は、再び展開しない", () => {
    const out = expandOne("backend/src/rules-examples/a.test.ts#bad");
    expect(out).toContain("{{x}}");
  });

  it("指示のない文章は、そのまま", () => {
    expect(expandExamples("例はありません {{x}}", outputs, "SKILL.md")).toBe(
      "例はありません {{x}}",
    );
  });

  it("出力にないパスは、ファイル名とパスを示してエラーになる", () => {
    let error: unknown;
    try {
      expandOne("backend/src/rules-examples/none.test.ts#good");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(GenerateError);
    expect((error as Error).message).toContain("SKILL.md");
    expect((error as Error).message).toContain("backend/src/rules-examples/none.test.ts");
  });

  it("範囲の名前がないときは、エラーになる", () => {
    expect(() => expandOne("backend/src/rules-examples/a.test.ts#missing")).toThrow(GenerateError);
  });

  it("同じ名前の範囲が2つあるときは、エラーになる", () => {
    const twice = [
      {
        path: "a.ts",
        content:
          "// #region example:dup\n1\n// #endregion\n// #region example:dup\n2\n// #endregion\n",
      },
    ];
    expect(() => expandOne("a.ts#dup", twice)).toThrow(GenerateError);
  });

  it("閉じていない範囲は、エラーになる", () => {
    const open = [{ path: "a.ts", content: "// #region example:open\n1\n" }];
    expect(() => expandOne("a.ts#open", open)).toThrow(GenerateError);
  });

  it("パスに .. を含む・書き方が誤っているときは、エラーになる", () => {
    expect(() => expandOne("../a.test.ts#good")).toThrow(GenerateError);
    expect(() => expandOne("backend/src/rules-examples/a.test.ts")).toThrow(GenerateError);
  });

  it("listExampleRegions：ファイルの範囲の名前を、すべて返す", () => {
    expect(listExampleRegions(EXAMPLE_FILE)).toEqual(["good", "bad"]);
  });
});
