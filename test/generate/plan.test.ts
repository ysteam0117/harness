// 想定する型（実装は src/generate/plan.ts をこれに合わせる）
//
//   export type BuildOutputsInput = {
//     templatesDir: string;
//     ais: Ai[];                         // "claude" | "codex"（adapter.ts の型）
//     profiles: string[];                // "<分類>/<id>" の一覧（resolveProfiles に渡す。requires の不足はエラー）
//     values: Record<string, string>;    // 名前 → 値
//   };
//   export function buildOutputs(input: BuildOutputsInput): {
//     files: { path: string; content: string }[];
//          // AI向けの出力（buildAiOutputs）＋プロファイルの files（差し込み済み）。
//          // path は "/" 区切りの相対パス。パスの順（文字列の既定の並べ替え）に並べる。同じ入力なら同じ結果
//          // 出力先のパスが重なったらエラー（GenerateError）
//     packageJson: Record<string, unknown>;   // mergePackageJson の結果（optional_packages は加えない）
//   };
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GenerateError } from "../../src/generate/errors.js";
import { buildOutputs } from "../../src/generate/plan.js";
import {
  cleanupTemplates,
  fakeValues,
  fixtureFiles,
  fixturesDir,
  LEFTOVER_NAME,
  makeTemplates,
  realTemplatesDir,
} from "./helpers.js";

afterAll(cleanupTemplates);

const smallValues = {
  app_name: "testapp_001",
  claude_model_planner: "model-claude-test",
  codex_model_planner: "model-codex-test",
  codex_effort_planner: "low",
};

function content(files: { path: string; content: string }[], p: string): string {
  const f = files.find((x) => x.path === p);
  if (!f) throw new Error(`出力に ${p} がありません`);
  return f.content;
}

describe("#31 AC-3: まとめ（小さなひな形）", () => {
  it("#31 AC-3: AI向けの出力とプロファイルの files が1つの一覧になり、パスの順に並ぶ", () => {
    const { files } = buildOutputs({
      templatesDir: fixturesDir,
      ais: ["claude", "codex"],
      profiles: ["lib/alpha", "lib/beta"],
      values: smallValues,
    });
    const paths = files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort());
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        "CLAUDE.md",
        ".claude/skills/lib-alpha/SKILL.md",
        ".agents/skills/lib-beta/SKILL.md",
        "out/src/a.ts",
        "out/src/b.ts",
        "out/src/c.ts",
      ]),
    );
    for (const p of paths) {
      expect(p).not.toContain("\\");
      expect(p.startsWith("/")).toBe(false);
    }
  });

  it("#31 AC-3: プロファイルの files の中身も差し込みの対象にする", () => {
    const { files } = buildOutputs({
      templatesDir: fixturesDir,
      ais: ["claude"],
      profiles: ["lib/alpha"],
      values: smallValues,
    });
    expect(content(files, "out/src/a.ts")).toBe(
      'import { b } from "./b";\nexport const a = b + "testapp_001";\n',
    );
    expect(content(files, "out/src/b.ts")).toBe('export const b = "b";\n');
  });

  it("#31 AC-1: プロファイルの files に未定義の名前が残るとエラーになる（ファイル名を示す）", () => {
    // AGENTS.md などは通り、プロファイルの files だけに専用の未定義の名前を置く
    const files = fixtureFiles();
    files["profiles/lib/alpha/files/a.ts"] = 'export const a = "{{only_in_profile_file}}";\n';
    const dir = makeTemplates(files);
    const run = () =>
      buildOutputs({
        templatesDir: dir,
        ais: ["claude"],
        profiles: ["lib/alpha"],
        values: smallValues,
      });
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/only_in_profile_file/);
    expect(run).toThrow(/a\.ts/);
  });

  it("#31 AC-4: packageJson は選んだプロファイルの package_json をまとめたもの", () => {
    const { packageJson } = buildOutputs({
      templatesDir: fixturesDir,
      ais: ["claude"],
      profiles: ["lib/alpha", "lib/beta"],
      values: smallValues,
    });
    expect(packageJson).toEqual({
      scripts: { alpha: "alpha run", beta: "beta run" },
      overrides: { "@scope/pkg": { zod: "$zod" } },
    });
  });

  it("#31 AC-4: requires が足りなければエラーにする（自動で足さない）", () => {
    expect(() =>
      buildOutputs({
        templatesDir: fixturesDir,
        ais: ["claude"],
        profiles: ["lib/beta"],
        values: smallValues,
      }),
    ).toThrow(/lib\/alpha/);
  });

  it("#31 AC-4: AI向けの出力とプロファイルの files の出力先が重なったらエラーにする", () => {
    const files = fixtureFiles();
    files["profiles/lib/alpha/profile.yaml"] = (
      files["profiles/lib/alpha/profile.yaml"] ?? ""
    ).replace("files/a.ts: out/src/a.ts", "files/a.ts: AGENTS.md");
    const dir = makeTemplates(files);
    const run = () =>
      buildOutputs({
        templatesDir: dir,
        ais: ["claude"],
        profiles: ["lib/alpha"],
        values: smallValues,
      });
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/AGENTS\.md/);
  });

  it("#31 AC-4: Skill の出力先と、プロファイルの files の出力先が重なってもエラーにする", () => {
    const files = fixtureFiles();
    files["profiles/lib/alpha/profile.yaml"] = (
      files["profiles/lib/alpha/profile.yaml"] ?? ""
    ).replace("files/a.ts: out/src/a.ts", "files/a.ts: .claude/skills/lib-alpha/SKILL.md");
    const dir = makeTemplates(files);
    expect(() =>
      buildOutputs({
        templatesDir: dir,
        ais: ["claude"],
        profiles: ["lib/alpha"],
        values: smallValues,
      }),
    ).toThrow(GenerateError);
  });

  it("#31 AC-3: 同じ入力で2回呼ぶと同じ結果になる（#34 のスナップショットのため）", () => {
    const run = () =>
      buildOutputs({
        templatesDir: fixturesDir,
        ais: ["codex", "claude"],
        profiles: ["lib/beta", "lib/alpha"],
        values: smallValues,
      });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("#31 AC-3: プロファイルを選ぶ順や ais の順が違っても、同じ結果になる", () => {
    const a = buildOutputs({
      templatesDir: fixturesDir,
      ais: ["claude", "codex"],
      profiles: ["lib/alpha", "lib/beta"],
      values: smallValues,
    });
    const b = buildOutputs({
      templatesDir: fixturesDir,
      ais: ["codex", "claude"],
      profiles: ["lib/beta", "lib/alpha"],
      values: smallValues,
    });
    expect(b.files).toEqual(a.files);
    expect(b.packageJson).toEqual(a.packageJson);
  });

  it("#31 AC-3: ディスクには書かない（呼んでも templates の中身が変わらない）", () => {
    const before = JSON.stringify(fixtureFiles());
    buildOutputs({
      templatesDir: fixturesDir,
      ais: ["claude"],
      profiles: ["lib/alpha"],
      values: smallValues,
    });
    expect(JSON.stringify(fixtureFiles())).toBe(before);
  });
});

describe("#31 AC-4: 実際の templates/ での結合", () => {
  function resolveImport(from: string, spec: string, known: Set<string>): string | undefined {
    const base = path.posix.join(path.posix.dirname(from), spec);
    return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((c) => known.has(c));
  }

  it("#31 AC-4: Hono とロガーを選んだ出力で、backend の中の相対の import の先がすべて出力に含まれる", () => {
    const { files } = buildOutputs({
      templatesDir: realTemplatesDir,
      ais: ["claude", "codex"],
      profiles: ["backend-framework/hono", "logger/structured-logger"],
      values: fakeValues(),
    });
    const known = new Set(files.map((f) => f.path));
    expect(known.has("backend/src/lib/error-handler.ts")).toBe(true);
    expect(known.has("backend/src/lib/logger/logger.ts")).toBe(true);

    const importRe = /(?:from|import)\s+["'](\.{1,2}\/[^"']+)["']/g;
    const missing: string[] = [];
    let checked = 0;
    for (const f of files.filter((x) => x.path.startsWith("backend/") && x.path.endsWith(".ts"))) {
      for (const m of f.content.matchAll(importRe)) {
        checked += 1;
        if (!resolveImport(f.path, m[1] ?? "", known)) missing.push(`${f.path} -> ${m[1]}`);
      }
    }
    expect(checked).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });

  it("#31 AC-4: error-handler.ts は logger を ./logger/logger から読む", () => {
    const { files } = buildOutputs({
      templatesDir: realTemplatesDir,
      ais: ["claude"],
      profiles: ["backend-framework/hono", "logger/structured-logger"],
      values: fakeValues(),
    });
    const text = content(files, "backend/src/lib/error-handler.ts");
    expect(text).toContain('"./logger/logger"');
    expect(text).not.toContain('"../logger/logger"');
  });

  it("#31 AC-1: Hono とロガーの出力に、名前（{{...}}）の残りがない", () => {
    const { files } = buildOutputs({
      templatesDir: realTemplatesDir,
      ais: ["claude", "codex"],
      profiles: ["backend-framework/hono", "logger/structured-logger"],
      values: fakeValues(),
    });
    for (const f of files) expect(f.content, f.path).not.toMatch(LEFTOVER_NAME);
  });

  it("#31 AC-4: 実際の8つのプロファイルをすべて選んで生成でき、出力先が重ならない", () => {
    const { files, packageJson } = buildOutputs({
      templatesDir: realTemplatesDir,
      ais: ["claude", "codex"],
      profiles: [
        "backend-framework/hono",
        "data-access/drizzle",
        "frontend-build/vite-react-router",
        "frontend-state/tanstack-query-rhf-zod",
        "http-client/axios",
        "logger/structured-logger",
        "quality/typescript-standard",
        "test-framework/vitest-playwright",
      ],
      values: fakeValues(),
    });
    const paths = files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual([...paths].sort());
    for (const f of files) expect(f.content, f.path).not.toMatch(LEFTOVER_NAME);
    expect(Object.keys(packageJson)).toEqual(expect.arrayContaining(["scripts", "overrides"]));
  });

  it("#31 AC-4: optional_packages（zustand）は package.json の依存に自動で加えない", () => {
    const { packageJson } = buildOutputs({
      templatesDir: realTemplatesDir,
      ais: ["claude"],
      profiles: ["frontend-state/tanstack-query-rhf-zod"],
      values: fakeValues(),
    });
    expect(JSON.stringify(packageJson)).not.toContain("zustand");
  });

  it("#31 AC-3: 実際の templates/ でも、同じ入力で2回呼ぶと同じ結果になる", () => {
    const run = () =>
      buildOutputs({
        templatesDir: realTemplatesDir,
        ais: ["claude", "codex"],
        profiles: ["logger/structured-logger"],
        values: fakeValues(),
      });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("#31 AC-3: 値の足りない名前があると、足りない名前を示してエラーになる", () => {
    const values = fakeValues();
    delete values["app_name"];
    const run = () =>
      buildOutputs({
        templatesDir: realTemplatesDir,
        ais: ["claude"],
        profiles: [],
        values,
      });
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/app_name/);
  });
});

describe("#31 AC-4: 出力先の重なり（大文字小文字・親フォルダ）", () => {
  /** alpha の files の出力先を差し替えたひな形で、claude を選んで生成する */
  function runWithDestination(dest: string, ais: ("claude" | "codex")[] = ["claude"]) {
    const files = fixtureFiles();
    files["profiles/lib/alpha/profile.yaml"] = (
      files["profiles/lib/alpha/profile.yaml"] ?? ""
    ).replace("files/a.ts: out/src/a.ts", `files/a.ts: ${dest}`);
    const dir = makeTemplates(files);
    return () =>
      buildOutputs({
        templatesDir: dir,
        ais,
        profiles: ["lib/alpha"],
        values: smallValues,
      });
  }

  it("#31 AC-4: 大文字・小文字だけが違う出力先（AGENTS.md と agents.md）はエラーにし、2つのパスを示す", () => {
    const run = runWithDestination("agents.md");
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/AGENTS\.md/);
    expect(run).toThrow(/agents\.md/);
  });

  it("#31 AC-4: あるファイルが別の出力の親フォルダになる場合（.claude と .claude/settings.json）はエラーにし、2つのパスを示す", () => {
    const run = runWithDestination(".claude");
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/\.claude\/settings\.json/);
    expect(run).toThrow(/\.claude(?!\/)/);
  });

  it("#31 AC-4: 親フォルダの重なりは、AI向けの出力の中だけでなく、プロファイルの files どうしでもエラーにする", () => {
    const files = fixtureFiles();
    files["profiles/lib/alpha/profile.yaml"] = (
      files["profiles/lib/alpha/profile.yaml"] ?? ""
    ).replace("files/b.ts: out/src/b.ts", "files/b.ts: out/src");
    const dir = makeTemplates(files);
    const run = () =>
      buildOutputs({
        templatesDir: dir,
        ais: ["claude"],
        profiles: ["lib/alpha"],
        values: smallValues,
      });
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/out\/src\/a\.ts/);
    expect(run).toThrow(/out\/src(?!\/)/);
  });

  it("#31 AC-4: プロファイルの files どうしの大文字小文字だけの違いもエラーにする", () => {
    const files = fixtureFiles();
    files["profiles/lib/alpha/profile.yaml"] = (
      files["profiles/lib/alpha/profile.yaml"] ?? ""
    ).replace("files/b.ts: out/src/b.ts", "files/b.ts: OUT/SRC/A.ts");
    const dir = makeTemplates(files);
    const run = () =>
      buildOutputs({
        templatesDir: dir,
        ais: ["claude"],
        profiles: ["lib/alpha"],
        values: smallValues,
      });
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/out\/src\/a\.ts/);
    expect(run).toThrow(/OUT\/SRC\/A\.ts/);
  });

  it("#31 AC-4: Codex の Skill のフォルダ（.agents/skills）と同名のファイルもエラーにする", () => {
    const run = runWithDestination(".agents", ["codex"]);
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/\.agents\/skills\//);
  });

  it("#31 AC-4: 重ならない出力先（似た名前のフォルダ）はエラーにしない", () => {
    expect(runWithDestination(".claude-extra/x.ts")).not.toThrow();
    expect(runWithDestination("AGENTS.md.bak")).not.toThrow();
  });
});

describe("#31 AC-2: プロファイルの files のコメントと CRLF", () => {
  const marker = "もとになった共通仕様";

  it("#31 AC-2: プロファイルの files の冒頭のハーネス用の説明のコメントは取り除き、通常のコメントは残す", () => {
    const files = fixtureFiles();
    files["profiles/lib/alpha/files/b.ts"] =
      `<!-- ${marker}：C-00 -->\n// 通常のコードのコメント\nexport const b = "b"; // 行末\n/* ブロック */\n`;
    files["profiles/lib/alpha/files/a.ts"] =
      `// ${marker}：C-01\n<!-- 途中の注釈 -->\nexport const a = 1;\n`;
    const dir = makeTemplates(files);
    const out = buildOutputs({
      templatesDir: dir,
      ais: ["claude"],
      profiles: ["lib/alpha"],
      values: smallValues,
    }).files;
    const b = content(out, "out/src/b.ts");
    expect(b).not.toContain(marker);
    expect(b).toBe('// 通常のコードのコメント\nexport const b = "b"; // 行末\n/* ブロック */\n');
    const a = content(out, "out/src/a.ts");
    expect(a).toContain("<!-- 途中の注釈 -->");
    expect(a).toContain("export const a = 1;");
  });

  it("#31 AC-2: 実際の templates で、どのプロファイルの files の出力にも「もとになった共通仕様」の説明が残らない", () => {
    const { files } = buildOutputs({
      templatesDir: realTemplatesDir,
      ais: ["claude"],
      profiles: [
        "backend-framework/hono",
        "logger/structured-logger",
        "http-client/axios",
        "quality/typescript-standard",
        "test-framework/vitest-playwright",
        "frontend-build/vite-react-router",
      ],
      values: fakeValues(),
    });
    for (const f of files.filter(
      (x) => x.path.startsWith("backend/") || x.path.startsWith("frontend/"),
    ))
      expect(f.content, f.path).not.toMatch(/^\s*(<!--|\/\/|#)\s*もとになった共通仕様/mu);
  });

  it("#31 AC-1: 回答の値に含まれる CRLF も、出力では LF になる", () => {
    const { files } = buildOutputs({
      templatesDir: fixturesDir,
      ais: ["claude", "codex"],
      profiles: ["lib/alpha"],
      values: { ...smallValues, app_name: "testapp_001\r\n2行目\r3行目" },
    });
    for (const f of files) expect(f.content, f.path).not.toContain("\r");
    expect(content(files, "AGENTS.md")).toContain("testapp_001\n2行目\n3行目");
    expect(content(files, "out/src/a.ts")).toContain("testapp_001\n2行目\n3行目");
  });
});

describe("#31 AC-2: プロファイルの元のファイルの改行が CRLF・CR の場合", () => {
  const marker = "もとになった共通仕様";

  it.each([
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])(
    "#31 AC-2: 元のファイルが %s でも、冒頭の説明のコメントを取り除き、通常のコメントは残し、出力は LF になる",
    (_label, eol) => {
      const files = fixtureFiles();
      files["profiles/lib/alpha/files/b.ts"] = [
        `<!-- ${marker}：C-00 -->`,
        "// 通常のコードのコメント",
        'export const b = "b";',
        "<!-- 途中の注釈 -->",
        "",
      ].join(eol);
      files["profiles/lib/alpha/files/a.ts"] = [
        `// ${marker}：C-01`,
        "// 残すコメント",
        "export const a = 1;",
        "",
      ].join(eol);
      const dir = makeTemplates(files);
      const out = buildOutputs({
        templatesDir: dir,
        ais: ["claude"],
        profiles: ["lib/alpha"],
        values: smallValues,
      }).files;
      const b = content(out, "out/src/b.ts");
      expect(b).toBe('// 通常のコードのコメント\nexport const b = "b";\n<!-- 途中の注釈 -->\n');
      const a = content(out, "out/src/a.ts");
      expect(a).not.toContain(marker);
      expect(a).toContain("// 残すコメント\nexport const a = 1;\n");
      for (const f of out) expect(f.content, f.path).not.toContain("\r");
    },
  );
});
