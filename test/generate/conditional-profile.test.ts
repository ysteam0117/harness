// #56 AC-3・R8：回答に応じて出すファイル・設定の仕組み（profile.yaml の files_when・wrangler・wrangler_when）
//
// profile.yaml の新しい項目（条件の書き方は #32 の `when: { answer: <質問の id>, equals | in | notEquals }`）
//
//   files_when:                       # 回答に合うときだけ出すファイル。files と同じ「元: 出力先」
//     - when: { answer: database, equals: d1 }
//       files:
//         files/vitest.d1.config.ts: vitest.config.ts
//   wrangler:                         # wrangler.jsonc に足す設定。package_json と同じく、プロファイル同士を深くまとめる
//     name: "{{app_name}}"            # 値の {{名前}} は、まとめた後に差し込む
//     main: backend/src/index.ts
//   wrangler_when:                    # 回答に合うときだけ足す wrangler の設定
//     - when: { answer: database, equals: d1 }
//       wrangler:
//         d1_databases: [{ binding: DB }]
//
// 想定する型・関数
//
//   // src/generate/profile.ts
//   export type ProfileFilesWhen = { when: When; files: ProfileFile[] };      // When は conditions.ts の型
//   export type ProfileWranglerWhen = { when: When; wrangler: Record<string, unknown> };
//   Profile に追加：
//     filesWhen: ProfileFilesWhen[];              // 書いてなければ []
//     wrangler: Record<string, unknown>;          // 書いてなければ {}
//     wranglerWhen: ProfileWranglerWhen[];        // 書いてなければ []
//   export function selectProfileFiles(profile: Profile, answers: object): ProfileFile[];
//        // files（無条件）の後に、回答に合う files_when を、書いた順に並べる
//   export function mergeWrangler(profiles: Profile[], answers: object): Record<string, unknown>;
//        // 各プロファイルの wrangler と、回答に合う wrangler_when を深くまとめる。
//        // 同じ項目に違う値があれば GenerateError（項目の場所を示す）。渡した Profile は書き換えない
//   loadProfile の検証（誤りは GenerateError）：files_when・wrangler_when が配列でない／要素が連想配列でない／
//     when が #32 の書き方でない（知らない質問の id・演算子が 0 個か 2 個以上）／files・wrangler が欠ける／
//     要素に知らない項目がある／files の元のファイルがない／出力先が相対パスでない／同じ files_when の中で出力先が重なる／
//     wrangler が連想配列でない
//
//   // src/generate/plan.ts
//   BuildOutputsInput に `answers?: Partial<Answers>`（既定 {}）を追加。files_when は回答に合うものだけを出す。
//   出力先の重なり（無条件の files と合った files_when、合った files_when どうし）は、出力先の重なりとして GenerateError
//
//   // src/generate/wrangler.ts
//   export function buildWranglerJsonc(input: {
//     profiles: Profile[]; answers: object; values: Record<string, string>;
//   }): string;
//        // mergeWrangler の結果を JSON として組み立て、先頭に説明の「//」の行を付ける（.jsonc）。
//        // 先頭の「//」の行より後は、そのまま JSON.parse できる。値の {{名前}} は、まとめた後に差し込む（値の " や \ も壊れない）。
//        // 足りない名前は GenerateError。末尾は改行1つ。同じ入力なら同じ結果
import { afterAll, describe, expect, it } from "vitest";
import { GenerateError } from "../../src/generate/errors.js";
import { buildOutputs } from "../../src/generate/plan.js";
import {
  loadProfile,
  mergeWrangler,
  resolveProfiles,
  selectProfileFiles,
} from "../../src/generate/profile.js";
import { buildWranglerJsonc } from "../../src/generate/wrangler.js";
import { cleanupTemplates, fixtureFiles, makeTemplates } from "./helpers.js";

afterAll(cleanupTemplates);

const BASE = `id: alpha
category: lib
name: Alpha
skill_name: lib-alpha
`;

/** AI 向けの出力に必須のひな形（AGENTS.md・CLAUDE.md・skills/・ai-settings/・agents/）。profiles/ は含めない */
function baseTemplates(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fixtureFiles()).filter(([p]) => !p.startsWith("profiles/")),
  );
}

/** alpha だけの小さなひな形。extra で足す・上書きする */
function alpha(yaml: string, extra: Record<string, string> = {}): string {
  return makeTemplates({
    ...baseTemplates(),
    "profiles/lib/alpha/profile.yaml": BASE + yaml,
    "profiles/lib/alpha/SKILL.md": "# alpha\n",
    "profiles/lib/alpha/files/common.ts": "export const common = 1;\n",
    "profiles/lib/alpha/files/d1.ts": "export const kind = 'd1';\n",
    "profiles/lib/alpha/files/pg.ts": "export const kind = 'pg';\n",
    "profiles/lib/_shared/SKILL.md": "共通\n",
    ...extra,
  });
}

const FILES_WHEN = `files:
  files/common.ts: out/common.ts
files_when:
  - when: { answer: database, equals: d1 }
    files:
      files/d1.ts: out/kind.ts
  - when: { answer: database, equals: postgresql }
    files:
      files/pg.ts: out/kind.ts
`;

const load = (yaml: string) => loadProfile(alpha(yaml), "lib/alpha");

describe("#56 AC-3: files_when・wrangler・wrangler_when の読み込み", () => {
  it("#56 AC-3: files_when を、条件（#32 の書き方）と「元: 出力先」で読む", () => {
    const p = load(FILES_WHEN);
    expect(p.filesWhen).toEqual([
      {
        when: { answer: "database", equals: "d1" },
        files: [{ source: "files/d1.ts", destination: "out/kind.ts" }],
      },
      {
        when: { answer: "database", equals: "postgresql" },
        files: [{ source: "files/pg.ts", destination: "out/kind.ts" }],
      },
    ]);
    expect(p.files).toEqual([{ source: "files/common.ts", destination: "out/common.ts" }]);
  });

  it("#56 AC-3: in・notEquals の条件も読める", () => {
    const p = load(`files_when:
  - when: { answer: auth, in: [oidc, both] }
    files: { files/d1.ts: out/a.ts }
  - when: { answer: database, notEquals: none }
    files: { files/pg.ts: out/b.ts }
`);
    expect(p.filesWhen.map((w) => w.when)).toEqual([
      { answer: "auth", in: ["oidc", "both"] },
      { answer: "database", notEquals: "none" },
    ]);
  });

  it("#56 AC-3: wrangler・wrangler_when を読む（値の {{名前}} はそのまま残す）", () => {
    const p = load(`wrangler:
  name: "{{app_name}}"
  main: backend/src/index.ts
wrangler_when:
  - when: { answer: database, equals: d1 }
    wrangler:
      d1_databases: [{ binding: DB }]
`);
    expect(p.wrangler).toEqual({ name: "{{app_name}}", main: "backend/src/index.ts" });
    expect(p.wranglerWhen).toEqual([
      {
        when: { answer: "database", equals: "d1" },
        wrangler: { d1_databases: [{ binding: "DB" }] },
      },
    ]);
  });

  it("#56 AC-3: 書いていないときは、filesWhen・wranglerWhen は空の配列、wrangler は空のオブジェクト", () => {
    const p = load("");
    expect(p.filesWhen).toEqual([]);
    expect(p.wrangler).toEqual({});
    expect(p.wranglerWhen).toEqual([]);
  });

  it("#56 AC-3: files_when が配列でないとエラー", () => {
    expect(() => load("files_when: { files/d1.ts: out/a.ts }\n")).toThrow(GenerateError);
    expect(() => load("files_when: { files/d1.ts: out/a.ts }\n")).toThrow(/files_when/);
  });

  it("#56 AC-3: files_when の要素に when がないとエラー", () => {
    expect(() => load("files_when:\n  - files: { files/d1.ts: out/a.ts }\n")).toThrow(
      /files_when.*when|when.*files_when/,
    );
  });

  it("#56 AC-3: files_when の要素に files がないとエラー", () => {
    expect(() => load("files_when:\n  - when: { answer: database, equals: d1 }\n")).toThrow(
      /files/,
    );
  });

  it("#56 AC-3: when の answer が知らない質問の id だとエラー", () => {
    expect(() =>
      load(
        "files_when:\n  - when: { answer: no_such_question, equals: d1 }\n    files: { files/d1.ts: out/a.ts }\n",
      ),
    ).toThrow(/no_such_question/);
  });

  it("#56 AC-3: when の演算子が 0 個・2 個以上だとエラー", () => {
    expect(() =>
      load("files_when:\n  - when: { answer: database }\n    files: { files/d1.ts: out/a.ts }\n"),
    ).toThrow(GenerateError);
    expect(() =>
      load(
        "files_when:\n  - when: { answer: database, equals: d1, notEquals: none }\n    files: { files/d1.ts: out/a.ts }\n",
      ),
    ).toThrow(GenerateError);
  });

  it("#56 AC-3: files_when の要素に知らない項目（書き間違い）があるとエラー", () => {
    expect(() =>
      load(
        "files_when:\n  - when: { answer: database, equals: d1 }\n    files: { files/d1.ts: out/a.ts }\n    file: x\n",
      ),
    ).toThrow(/知らない項目|file/);
  });

  it("#56 AC-3: files_when の元のファイルがないとエラー（ファイルを示す）", () => {
    expect(() =>
      load(
        "files_when:\n  - when: { answer: database, equals: d1 }\n    files: { files/missing.ts: out/a.ts }\n",
      ),
    ).toThrow(/files\/missing\.ts/);
  });

  it("#56 AC-3: files_when の出力先が相対パスでない（.. や 絶対パス）とエラー", () => {
    for (const dest of ["../a.ts", "/abs/a.ts", "a//b.ts"]) {
      expect(() =>
        load(
          `files_when:\n  - when: { answer: database, equals: d1 }\n    files: { files/d1.ts: "${dest}" }\n`,
        ),
      ).toThrow(GenerateError);
    }
  });

  it("#56 AC-3: 同じ files_when の中で出力先が重なるとエラー", () => {
    expect(() =>
      load(
        "files_when:\n  - when: { answer: database, equals: d1 }\n    files:\n      files/d1.ts: out/a.ts\n      files/pg.ts: out/a.ts\n",
      ),
    ).toThrow(/out\/a\.ts/);
  });

  it("#56 AC-3: wrangler が連想配列でないとエラー", () => {
    expect(() => load("wrangler: [a, b]\n")).toThrow(/wrangler/);
  });

  it("#56 AC-3: wrangler_when の要素に wrangler がない・when が誤りだとエラー", () => {
    expect(() => load("wrangler_when:\n  - when: { answer: database, equals: d1 }\n")).toThrow(
      /wrangler/,
    );
    expect(() =>
      load("wrangler_when:\n  - when: { answer: nope, equals: d1 }\n    wrangler: { a: 1 }\n"),
    ).toThrow(/nope/);
  });

  it("#56 AC-3: wrangler_when が配列でないとエラー", () => {
    expect(() => load("wrangler_when: { a: 1 }\n")).toThrow(/wrangler_when/);
  });
});

describe("#56 AC-3: 回答に合うファイルの選び方（selectProfileFiles）", () => {
  const profile = load(FILES_WHEN);
  const dests = (answers: object) => selectProfileFiles(profile, answers).map((f) => f.destination);

  it("#56 AC-3: D1 のときは、無条件の files と D1 の files_when だけを出す", () => {
    expect(selectProfileFiles(profile, { database: "d1" })).toEqual([
      { source: "files/common.ts", destination: "out/common.ts" },
      { source: "files/d1.ts", destination: "out/kind.ts" },
    ]);
  });

  it("#56 AC-3: PostgreSQL のときは PostgreSQL の files_when だけを出す", () => {
    expect(selectProfileFiles(profile, { database: "postgresql" })).toEqual([
      { source: "files/common.ts", destination: "out/common.ts" },
      { source: "files/pg.ts", destination: "out/kind.ts" },
    ]);
  });

  it("#56 AC-3: どの条件にも合わないときは、無条件の files だけ（エラーにしない）", () => {
    expect(dests({ database: "none" })).toEqual(["out/common.ts"]);
    expect(dests({})).toEqual(["out/common.ts"]);
  });

  it("#56 AC-3: 合った files_when が複数あるときは、書いた順に並べる", () => {
    const p = load(`files_when:
  - when: { answer: database, notEquals: none }
    files: { files/pg.ts: out/second.ts }
  - when: { answer: database, equals: d1 }
    files: { files/d1.ts: out/third.ts }
`);
    expect(selectProfileFiles(p, { database: "d1" }).map((f) => f.destination)).toEqual([
      "out/second.ts",
      "out/third.ts",
    ]);
  });
});

describe("#56 AC-3: buildOutputs が files_when を出す", () => {
  const input = (templatesDir: string, answers: object) => ({
    templatesDir,
    ais: ["claude" as const],
    profiles: ["lib/alpha"],
    values: { app_name: "testapp-001", claude_model_planner: "m" },
    answers: answers as never,
  });
  const pathsOf = (r: { files: { path: string }[] }) => r.files.map((f) => f.path);

  it("#56 AC-3: D1・PostgreSQL・DB なしで、出るファイルが変わり、中身は合った元のファイル", () => {
    const dir = alpha(FILES_WHEN);
    const d1 = buildOutputs(input(dir, { database: "d1" }));
    const pg = buildOutputs(input(dir, { database: "postgresql" }));
    const none = buildOutputs(input(dir, { database: "none" }));
    expect(pathsOf(d1)).toContain("out/kind.ts");
    expect(d1.files.find((f) => f.path === "out/kind.ts")?.content).toContain("'d1'");
    expect(pg.files.find((f) => f.path === "out/kind.ts")?.content).toContain("'pg'");
    expect(pathsOf(none)).not.toContain("out/kind.ts");
    for (const r of [d1, pg, none]) expect(pathsOf(r)).toContain("out/common.ts");
  });

  it("#56 AC-3: 合った files_when の出力先が、無条件の files と重なるとエラー（重ならない回答ならエラーにしない）", () => {
    const dir = alpha(`files:
  files/common.ts: out/kind.ts
files_when:
  - when: { answer: database, equals: d1 }
    files: { files/d1.ts: out/kind.ts }
`);
    expect(() => buildOutputs(input(dir, { database: "d1" }))).toThrow(GenerateError);
    expect(() => buildOutputs(input(dir, { database: "d1" }))).toThrow(/out\/kind\.ts/);
    expect(() => buildOutputs(input(dir, { database: "none" }))).not.toThrow();
  });

  it("#56 AC-3: 同時に合った2つの files_when が同じ出力先を持つとエラー", () => {
    const dir = alpha(`files_when:
  - when: { answer: database, notEquals: none }
    files: { files/d1.ts: out/kind.ts }
  - when: { answer: database, equals: d1 }
    files: { files/pg.ts: out/kind.ts }
`);
    expect(() => buildOutputs(input(dir, { database: "d1" }))).toThrow(/out\/kind\.ts/);
    expect(() => buildOutputs(input(dir, { database: "postgresql" }))).not.toThrow();
  });

  it("#56 AC-3: 回答に合う files_when の出力先が、AI 向けの出力と重なってもエラー", () => {
    const dir = makeTemplates({
      ...baseTemplates(),
      "profiles/lib/alpha/profile.yaml": `${BASE}files_when:
  - when: { answer: database, equals: d1 }
    files: { files/d1.ts: AGENTS.md }
`,
      "profiles/lib/alpha/SKILL.md": "# alpha\n",
      "profiles/lib/alpha/files/d1.ts": "x\n",
    });
    expect(() => buildOutputs(input(dir, { database: "d1" }))).toThrow(/AGENTS\.md/);
  });

  it("#56 AC-3: files_when のファイルも、{{名前}} を差し込み、足りない名前はエラー", () => {
    const dir = alpha(
      `files_when:
  - when: { answer: database, equals: d1 }
    files: { files/named.ts: out/named.ts }
`,
      { "profiles/lib/alpha/files/named.ts": "export const n = '{{app_name}}';\n" },
    );
    const r = buildOutputs(input(dir, { database: "d1" }));
    expect(r.files.find((f) => f.path === "out/named.ts")?.content).toContain("testapp-001");
    expect(() =>
      buildOutputs({ ...input(dir, { database: "d1" }), values: { claude_model_planner: "m" } }),
    ).toThrow(/app_name/);
  });

  it("#56 AC-3: answers を渡さない既存の呼び方も動く（files_when は何も出ない）", () => {
    const dir = alpha(FILES_WHEN);
    const r = buildOutputs({
      templatesDir: dir,
      ais: ["claude"],
      profiles: ["lib/alpha"],
      values: { app_name: "testapp-001", claude_model_planner: "m" },
    });
    expect(pathsOf(r)).toContain("out/common.ts");
    expect(pathsOf(r)).not.toContain("out/kind.ts");
  });
});

describe("#56 AC-3: wrangler の設定をまとめる（mergeWrangler）", () => {
  const merge = (templatesDir: string, keys: string[], answers: object) =>
    mergeWrangler(resolveProfiles(templatesDir, keys), answers);

  const TWO = {
    "profiles/lib/alpha/profile.yaml": `${BASE}wrangler:
  name: "{{app_name}}"
  vars: { ALLOWED_ORIGINS: "{{allowed_origins}}" }
wrangler_when:
  - when: { answer: database, equals: d1 }
    wrangler:
      d1_databases: [{ binding: DB }]
  - when: { answer: database, equals: postgresql }
    wrangler:
      hyperdrive: [{ binding: HYPERDRIVE }]
`,
    "profiles/lib/alpha/SKILL.md": "# alpha\n",
    "profiles/lib/beta/profile.yaml": `id: beta
category: lib
name: Beta
skill_name: lib-beta
wrangler:
  vars: { FEATURE: "on" }
  assets: { not_found_handling: single-page-application }
`,
    "profiles/lib/beta/SKILL.md": "# beta\n",
    "profiles/lib/_shared/SKILL.md": "共通\n",
  };

  it("#56 AC-3: 複数のプロファイルの wrangler を深くまとめる（vars は両方の項目が残る）", () => {
    const dir = makeTemplates(TWO);
    const w = merge(dir, ["lib/alpha", "lib/beta"], { database: "none" });
    expect(w).toEqual({
      name: "{{app_name}}",
      vars: { ALLOWED_ORIGINS: "{{allowed_origins}}", FEATURE: "on" },
      assets: { not_found_handling: "single-page-application" },
    });
  });

  it("#56 AC-3: 回答に合う wrangler_when だけをまとめる（D1・PostgreSQL・DB なし）", () => {
    const dir = makeTemplates(TWO);
    expect(merge(dir, ["lib/alpha"], { database: "d1" })).toHaveProperty("d1_databases");
    expect(merge(dir, ["lib/alpha"], { database: "d1" })).not.toHaveProperty("hyperdrive");
    expect(merge(dir, ["lib/alpha"], { database: "postgresql" })).toHaveProperty("hyperdrive");
    expect(merge(dir, ["lib/alpha"], { database: "postgresql" })).not.toHaveProperty(
      "d1_databases",
    );
    const none = merge(dir, ["lib/alpha"], { database: "none" });
    expect(none).not.toHaveProperty("d1_databases");
    expect(none).not.toHaveProperty("hyperdrive");
  });

  it("#56 AC-3: 同じ項目に違う値があるとエラー（項目の場所を示す）。同じ値ならエラーにしない", () => {
    const conflict = makeTemplates({
      ...TWO,
      "profiles/lib/beta/profile.yaml": `id: beta
category: lib
name: Beta
skill_name: lib-beta
wrangler:
  vars: { ALLOWED_ORIGINS: "other" }
`,
    });
    expect(() => merge(conflict, ["lib/alpha", "lib/beta"], {})).toThrow(GenerateError);
    expect(() => merge(conflict, ["lib/alpha", "lib/beta"], {})).toThrow(/ALLOWED_ORIGINS/);
    const same = makeTemplates({
      ...TWO,
      "profiles/lib/beta/profile.yaml": `id: beta
category: lib
name: Beta
skill_name: lib-beta
wrangler:
  vars: { ALLOWED_ORIGINS: "{{allowed_origins}}" }
`,
    });
    expect(() => merge(same, ["lib/alpha", "lib/beta"], {})).not.toThrow();
  });

  it("#56 AC-3: wrangler_when が同じ項目に違う値を足すとエラー", () => {
    const dir = makeTemplates({
      ...TWO,
      "profiles/lib/beta/profile.yaml": `id: beta
category: lib
name: Beta
skill_name: lib-beta
wrangler_when:
  - when: { answer: database, equals: d1 }
    wrangler:
      name: another
`,
    });
    expect(() => merge(dir, ["lib/alpha", "lib/beta"], { database: "d1" })).toThrow(/name/);
    expect(() => merge(dir, ["lib/alpha", "lib/beta"], { database: "none" })).not.toThrow();
  });

  it("#56 AC-3: __proto__ の項目はエラー", () => {
    const dir = makeTemplates({
      ...TWO,
      "profiles/lib/beta/profile.yaml": `id: beta
category: lib
name: Beta
skill_name: lib-beta
wrangler:
  vars:
    __proto__: { polluted: true }
`,
    });
    expect(() => merge(dir, ["lib/alpha", "lib/beta"], {})).toThrow(GenerateError);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("#56 AC-3: 渡した Profile を書き換えない", () => {
    const dir = makeTemplates(TWO);
    const profiles = resolveProfiles(dir, ["lib/alpha", "lib/beta"]);
    const before = JSON.stringify(profiles);
    const merged = mergeWrangler(profiles, { database: "d1" });
    (merged["vars"] as Record<string, unknown>)["ADDED"] = "x";
    (merged["d1_databases"] as { binding: string }[])[0]!.binding = "CHANGED";
    expect(JSON.stringify(profiles)).toBe(before);
  });
});

describe("#56 AC-3: wrangler.jsonc の組み立て（buildWranglerJsonc）", () => {
  const dir = makeTemplates({
    "profiles/lib/alpha/profile.yaml": `${BASE}wrangler:
  name: "{{app_name}}"
  main: backend/src/index.ts
  vars: { ALLOWED_ORIGINS: "{{allowed_origins}}" }
wrangler_when:
  - when: { answer: database, equals: d1 }
    wrangler:
      d1_databases: [{ binding: DB, database_name: "{{app_name}}-db" }]
`,
    "profiles/lib/alpha/SKILL.md": "# alpha\n",
    "profiles/lib/_shared/SKILL.md": "共通\n",
  });
  const profiles = resolveProfiles(dir, ["lib/alpha"]);
  const values = { app_name: "testapp-001", allowed_origins: "http://localhost:5173" };

  /** 先頭の「//」の行（説明）を取り除いて JSON として読む。先頭の行以外にコメントがあれば失敗する */
  function parse(text: string): { header: string[]; json: Record<string, unknown> } {
    const lines = text.split("\n");
    const header: string[] = [];
    while (lines[0]?.startsWith("//")) header.push(lines.shift() as string);
    return { header, json: JSON.parse(lines.join("\n")) as Record<string, unknown> };
  }

  it("#56 AC-3: 先頭に説明の「//」の行があり、あとは JSON として読める。{{名前}} は差し込み済み", () => {
    const text = buildWranglerJsonc({ profiles, answers: { database: "d1" }, values });
    const { header, json } = parse(text);
    expect(header.length).toBeGreaterThan(0);
    expect(json["name"]).toBe("testapp-001");
    expect(json["main"]).toBe("backend/src/index.ts");
    expect(json["vars"]).toEqual({ ALLOWED_ORIGINS: "http://localhost:5173" });
    expect(json["d1_databases"]).toEqual([{ binding: "DB", database_name: "testapp-001-db" }]);
    expect(text).not.toMatch(/\{\{/);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("#56 AC-3: 回答に合わない設定は出ない", () => {
    const { json } = parse(buildWranglerJsonc({ profiles, answers: { database: "none" }, values }));
    expect(json).not.toHaveProperty("d1_databases");
  });

  it('#56 AC-3: 値に " や \\ があっても JSON が壊れない（まとめた後に差し込む）', () => {
    const { json } = parse(
      buildWranglerJsonc({
        profiles,
        answers: { database: "none" },
        values: { ...values, app_name: 'a"b\\c' },
      }),
    );
    expect(json["name"]).toBe('a"b\\c');
  });

  it("#56 AC-3: 値の足りない名前はエラー（名前を示す）", () => {
    const run = () =>
      buildWranglerJsonc({ profiles, answers: {}, values: { app_name: "testapp-001" } });
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/allowed_origins/);
  });

  it("#56 AC-3: 同じ入力なら同じ結果になる", () => {
    const run = () => buildWranglerJsonc({ profiles, answers: { database: "d1" }, values });
    expect(run()).toBe(run());
  });
});

// #72 AC-1：files_when に all を書ける。認証なしのときだけ出す・認証ありのときに差し替える、の仕組みの確認
describe("#72 AC-1: files_when の all（組み合わせの条件）", () => {
  const input = (templatesDir: string, answers: object) => ({
    templatesDir,
    ais: ["claude" as const],
    profiles: ["lib/alpha"],
    values: { app_name: "testapp-001", claude_model_planner: "m" },
    answers: answers as never,
  });
  const dest = (r: { files: { path: string }[] }) => r.files.map((f) => f.path);

  const WITH_ALL = `files_when:
  - when: { all: [{ answer: database, equals: d1 }, { answer: auth, notEquals: none }] }
    files: { files/d1.ts: out/kind.ts }
  - when: { all: [{ answer: database, equals: d1 }, { answer: auth, equals: none }] }
    files: { files/pg.ts: out/kind.ts }
`;

  it("#72 AC-1: all の files_when を読み、組み合わせごとに出し分ける", () => {
    const p = load(WITH_ALL);
    expect(p.filesWhen[0]?.when).toEqual({
      all: [
        { answer: "database", equals: "d1" },
        { answer: "auth", notEquals: "none" },
      ],
    });
    const content = (answers: object) =>
      buildOutputs(input(alpha(WITH_ALL), answers)).files.find((f) => f.path === "out/kind.ts")
        ?.content;
    expect(content({ database: "d1", auth: "app" })).toContain("'d1'");
    expect(content({ database: "d1", auth: "none" })).toContain("'pg'");
    expect(content({ database: "postgresql", auth: "app" })).toBeUndefined();
  });

  it("#72 AC-1: files から files_when（auth が none のときだけ）へ移しても、auth none の出力は同じ", () => {
    const before = buildOutputs(
      input(alpha("files:\n  files/common.ts: out/common.ts\n  files/d1.ts: out/kind.ts\n"), {
        database: "d1",
        auth: "none",
      }),
    );
    const moved = `files:
  files/common.ts: out/common.ts
files_when:
  - when: { answer: auth, equals: none }
    files: { files/d1.ts: out/kind.ts }
`;
    const after = buildOutputs(input(alpha(moved), { database: "d1", auth: "none" }));
    expect(after.files).toEqual(before.files);
    // 認証ありのときは、元のファイルを出さない（後続の Issue が認証側の版を置ける）
    const withAuth = buildOutputs(input(alpha(moved), { database: "d1", auth: "app" }));
    expect(dest(withAuth)).not.toContain("out/kind.ts");
  });

  it("#72 AC-1: 認証側の版と元の版が同じ出力先でも、条件が排他なら重ならない", () => {
    const yaml = `files_when:
  - when: { answer: auth, equals: none }
    files: { files/d1.ts: out/kind.ts }
  - when: { answer: auth, notEquals: none }
    files: { files/pg.ts: out/kind.ts }
`;
    const none = buildOutputs(input(alpha(yaml), { auth: "none" }));
    const app = buildOutputs(input(alpha(yaml), { auth: "app" }));
    expect(none.files.find((f) => f.path === "out/kind.ts")?.content).toContain("'d1'");
    expect(app.files.find((f) => f.path === "out/kind.ts")?.content).toContain("'pg'");
  });

  it("#72 AC-1: all の誤りは loadProfile でエラー（場所を示す）", () => {
    expect(() =>
      load("files_when:\n  - when: { all: [] }\n    files: { files/d1.ts: out/a.ts }\n"),
    ).toThrow(/files_when の 1 番目.*all/);
  });
});
