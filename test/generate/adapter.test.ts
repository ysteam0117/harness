// 想定する型（実装は src/generate/adapter.ts・frontmatter.ts をこれに合わせる）
//
//   export type Ai = "claude" | "codex";
//   export type OutputFile = { path: string; content: string };
//        // path：出力先の相対パス（"/" 区切り、先頭に "/" や "./" を付けない）。content：UTF-8 の文字列（LF）
//
//   export function buildAiOutputs(input: {
//     templatesDir: string;
//     ais: Ai[];                         // 1つ以上。"claude"・"codex" 以外、0個はエラー（GenerateError）
//     profiles: Profile[];               // resolveProfiles の結果（Skill の出力に使う。files は扱わない）
//     values: Record<string, string>;    // 名前 → 値。選んでいないAIの値は求めない（余分な値は無視する）
//   }): OutputFile[];
//        // AGENTS.md・CLAUDE.md・Skill・エージェントの定義・権限の設定を、F-21 の表のとおりに返す
//        // 並びは問わない（plan.ts がパスの順に並べる）。同じパスが重なったらエラー
//
// エージェントのひな形（templates/agents/<ファイル名>.md）の形（冒頭の値は引用符で囲む）
//   ---
//   name: <共通の name>
//   description: <共通の description>
//   claude:
//     tools: Read, Grep, Glob
//     model: "{{claude_model_planner}}"
//   codex:
//     name: <Codex の name>
//     model: "{{codex_model_planner}}"
//     model_reasoning_effort: "{{codex_effort_planner}}"
//     sandbox_mode: read-only
//   ---
//   <本文：閉じの "---" の行の次の行からファイルの終わりまで。先頭の空行もそのまま本文に含める>
//
// Claude の出力：冒頭は name・description・tools・model だけ（claude: の中身を上に出す）。本文はそのまま
// Codex の出力（.codex/agents/<codex.name>.toml）：name（codex.name）・description（共通）・model・
//   model_reasoning_effort・sandbox_mode（codex の中身）・developer_instructions（本文）。すべて基本文字列
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { buildAiOutputs, type OutputFile } from "../../src/generate/adapter.js";
import { GenerateError } from "../../src/generate/errors.js";
import { loadProfile, resolveProfiles } from "../../src/generate/profile.js";
import {
  AGENT_ROLES,
  cleanupTemplates,
  fakeValues,
  fixturesDir,
  LEFTOVER_NAME,
  makeTemplates,
  requiredTemplateFiles,
  REAL_AGENTS,
  REAL_SKILLS,
  realTemplatesDir,
} from "./helpers.js";
import { readFileSync } from "node:fs";
import path from "node:path";

afterAll(cleanupTemplates);

const claudeValues = { app_name: "testapp_001", claude_model_planner: "model-claude-test" };
const codexValues = {
  app_name: "testapp_001",
  codex_model_planner: "model-codex-test",
  codex_effort_planner: "high",
};

function paths(files: OutputFile[]): string[] {
  return files.map((f) => f.path).sort();
}

function byPath(files: OutputFile[], p: string): string {
  const file = files.find((f) => f.path === p);
  if (!file) throw new Error(`出力に ${p} がありません：${paths(files).join(", ")}`);
  return file.content;
}

function splitFrontmatter(text: string): { head: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error("冒頭（---）がありません");
  return { head: parseYaml(m[1] ?? "") as Record<string, unknown>, body: m[2] ?? "" };
}

/** ひな形の先頭の「# もとになった共通仕様」で始まる行だけを取り除く（ほかの行は一字一句そのまま） */
function stripRulesMarker(text: string): string {
  return text.replace(/^# もとになった共通仕様[^\n]*\n/u, "");
}

const alpha = () => loadProfile(fixturesDir, "lib/alpha");

describe("#31 AC-3: 選んだAIごとの出力先", () => {
  it("#31 AC-3: claude だけを選ぶと、Claude Code の置き場所と形式で出力する", () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["claude"],
      profiles: [alpha()],
      values: claudeValues,
    });
    expect(paths(files)).toEqual([
      ".claude/agents/planner.md",
      ".claude/settings.json",
      ".claude/skills/demo-skill/SKILL.md",
      ".claude/skills/lib-alpha/SKILL.md",
      "AGENTS.md",
      "CLAUDE.md",
    ]);
  });

  it("#31 AC-3: codex だけを選ぶと、Codex の置き場所と形式で出力する（CLAUDE.md・Claude の設定は出さない）", () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["codex"],
      profiles: [alpha()],
      values: codexValues,
    });
    expect(paths(files)).toEqual([
      ".agents/skills/demo-skill/SKILL.md",
      ".agents/skills/lib-alpha/SKILL.md",
      ".codex/agents/demo_planner.toml",
      ".codex/rules/default.rules",
      "AGENTS.md",
    ]);
  });

  it("#31 AC-3: 両方を選ぶと、両方を出す（AGENTS.md は1つ）", () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["claude", "codex"],
      profiles: [alpha()],
      values: { ...claudeValues, ...codexValues },
    });
    expect(paths(files)).toEqual([
      ".agents/skills/demo-skill/SKILL.md",
      ".agents/skills/lib-alpha/SKILL.md",
      ".claude/agents/planner.md",
      ".claude/settings.json",
      ".claude/skills/demo-skill/SKILL.md",
      ".claude/skills/lib-alpha/SKILL.md",
      ".codex/agents/demo_planner.toml",
      ".codex/rules/default.rules",
      "AGENTS.md",
      "CLAUDE.md",
    ]);
  });

  it("#31 AC-3: ais の並び・重複で結果が変わらない", () => {
    const a = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["claude", "codex"],
      profiles: [],
      values: { ...claudeValues, ...codexValues },
    });
    const b = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["codex", "claude", "codex"],
      profiles: [],
      values: { ...claudeValues, ...codexValues },
    });
    expect(paths(b)).toEqual(paths(a));
  });

  it("#31 AC-3: プロファイルの Skill の出力先の名前は skill_name で、{{include}} も展開される", () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["claude"],
      profiles: [alpha()],
      values: claudeValues,
    });
    const skill = byPath(files, ".claude/skills/lib-alpha/SKILL.md");
    expect(skill).toContain("## 共通のルール");
    expect(skill).toContain("アプリ名：testapp_001");
    expect(skill).not.toContain("{{");
    expect(skill).not.toContain("<!--");
  });

  it("#31 AC-3: AGENTS.md・CLAUDE.md・Skill の名前を差し込む", () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["claude"],
      profiles: [],
      values: claudeValues,
    });
    expect(byPath(files, "AGENTS.md")).toContain("# testapp_001 の指針");
    expect(byPath(files, ".claude/skills/demo-skill/SKILL.md")).toContain("# デモ testapp_001");
    expect(byPath(files, "CLAUDE.md")).toBe("@AGENTS.md\n");
  });

  it("#31 AC-3: AI の選択肢の誤り（0個・知らない名前）はエラーにする", () => {
    for (const ais of [[], ["gemini"], ["claude", "gemini"], ["Claude"]]) {
      expect(() =>
        buildAiOutputs({
          templatesDir: fixturesDir,
          ais: ais as never,
          profiles: [],
          values: { ...claudeValues, ...codexValues },
        }),
      ).toThrow(GenerateError);
    }
  });

  it("#31 AC-3: 出力のパスは相対の「/」区切りで、同じパスが重ならない", () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["claude", "codex"],
      profiles: [alpha()],
      values: { ...claudeValues, ...codexValues },
    });
    for (const f of files) {
      expect(f.path).not.toMatch(/^(\/|\.\/)/u);
      expect(f.path).not.toContain("\\");
      expect(f.path.split("/")).not.toContain("..");
      expect(f.content).not.toContain("\r");
    }
    expect(new Set(paths(files)).size).toBe(files.length);
  });

  it("#31 AC-3: 同じ入力で2回呼ぶと同じ結果になる", () => {
    const run = () =>
      buildAiOutputs({
        templatesDir: fixturesDir,
        ais: ["claude", "codex"],
        profiles: [alpha()],
        values: { ...claudeValues, ...codexValues },
      });
    expect(run()).toEqual(run());
  });
});

describe("#31 AC-3: 選んだAIの値だけを求める", () => {
  it("#31 AC-3: Codex だけを選び、Claude の値を渡さなくても成功する", () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["codex"],
      profiles: [],
      values: codexValues,
    });
    expect(files.length).toBeGreaterThan(0);
  });

  it("#31 AC-3: Claude だけを選び、Codex の値を渡さなくても成功する", () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["claude"],
      profiles: [],
      values: claudeValues,
    });
    expect(files.length).toBeGreaterThan(0);
  });

  it("#31 AC-3: 選んだAIの値が足りなければ、足りない名前を示してエラーにする", () => {
    const run = () =>
      buildAiOutputs({
        templatesDir: fixturesDir,
        ais: ["codex"],
        profiles: [],
        values: { app_name: "testapp_001", codex_model_planner: "m" },
      });
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/codex_effort_planner/);
  });

  it("#31 AC-3: 選んだAIの値が文字列でなければエラーにする", () => {
    expect(() =>
      buildAiOutputs({
        templatesDir: fixturesDir,
        ais: ["claude"],
        profiles: [],
        values: { ...claudeValues, claude_model_planner: 5 as unknown as string },
      }),
    ).toThrow(GenerateError);
  });
});

describe("#31 AC-3: 権限の設定", () => {
  it("#31 AC-3: Claude の設定は JSON として読め、ask・deny が元のとおり", () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["claude"],
      profiles: [],
      values: claudeValues,
    });
    const settings = JSON.parse(byPath(files, ".claude/settings.json")) as {
      permissions: { ask: string[]; deny: string[] };
    };
    const original = JSON.parse(
      readFileSync(path.join(fixturesDir, "ai-settings", "claude-settings.json"), "utf8"),
    ) as typeof settings;
    expect(settings.permissions.ask).toEqual(original.permissions.ask);
    expect(settings.permissions.deny).toEqual(original.permissions.deny);
  });

  it("#31 AC-3: Codex のルールの中身が元のとおり", () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["codex"],
      profiles: [],
      values: codexValues,
    });
    const original = readFileSync(
      path.join(fixturesDir, "ai-settings", "codex-default.rules"),
      "utf8",
    );
    expect(original).toContain("もとになった共通仕様");
    const out = byPath(files, ".codex/rules/default.rules");
    expect(out).toBe(stripRulesMarker(original));
    expect(out).not.toContain("もとになった共通仕様");
  });
});

describe("#31 AC-3: エージェントの定義", () => {
  it("#31 AC-3: Claude のエージェントの冒頭は name・description・tools・model だけで、codex: が残らない", () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["claude"],
      profiles: [],
      values: claudeValues,
    });
    const text = byPath(files, ".claude/agents/planner.md");
    expect(text).not.toContain("codex");
    expect(text).not.toContain("claude:");
    const { head, body } = splitFrontmatter(text);
    expect(head).toEqual({
      name: "demo-planner",
      description: "テスト用の計画の役割。ファイルは編集しない。",
      tools: "Read, Grep, Glob",
      model: "model-claude-test",
    });
    expect(body).toBe("\n# 計画（testapp_001）\n\n作業の過程と結果は、すべて日本語で書く。\n");
  });

  it("#31 AC-3: Claude のエージェントは両方を選んでも冒頭に codex: が残らない", () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["claude", "codex"],
      profiles: [],
      values: { ...claudeValues, ...codexValues },
    });
    expect(byPath(files, ".claude/agents/planner.md")).not.toContain("model_reasoning_effort");
  });

  it("#31 AC-3: Codex のエージェントは TOML で、各項目と本文（developer_instructions）が元どおり", () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["codex"],
      profiles: [],
      values: codexValues,
    });
    const toml = parseToml(byPath(files, ".codex/agents/demo_planner.toml"));
    expect(toml).toEqual({
      name: "demo_planner",
      description: "テスト用の計画の役割。ファイルは編集しない。",
      model: "model-codex-test",
      model_reasoning_effort: "high",
      sandbox_mode: "read-only",
      developer_instructions:
        "\n# 計画（testapp_001）\n\n作業の過程と結果は、すべて日本語で書く。\n",
    });
  });

  it('#31 AC-3: Codex の TOML は、複数行の書き方（"""）を使わず、基本文字列だけで書く', () => {
    const files = buildAiOutputs({
      templatesDir: fixturesDir,
      ais: ["codex"],
      profiles: [],
      values: codexValues,
    });
    const text = byPath(files, ".codex/agents/demo_planner.toml");
    expect(text).not.toContain('"""');
    expect(text).not.toContain("'''");
    expect(text).not.toMatch(/= '/);
  });

  it('#31 AC-3: 制御文字・先頭の改行・"・\\・""" を含む本文も、TOML に書いて読み戻すと元どおりになる', () => {
    const body =
      '\n先頭の改行\n引用符 " と バックスラッシュ \\ と \\n の文字\n三連 """ と \'\'\'\n' +
      "タブ\tと\u0001制御\u001f文字と\u007fと終端 \\\n末尾の空行\n\n";
    const dir = makeTemplates({
      ...requiredTemplateFiles(),
      "agents/tricky.md": `---
name: tricky
description: 'ダブルクォート " と \\ を含む説明'
claude:
  tools: Read
  model: "{{claude_model_planner}}"
codex:
  name: tricky_codex
  model: "{{codex_model_planner}}"
  model_reasoning_effort: "{{codex_effort_planner}}"
  sandbox_mode: workspace-write
---
${body}`,
    });
    const files = buildAiOutputs({
      templatesDir: dir,
      ais: ["codex", "claude"],
      profiles: [],
      values: { ...claudeValues, ...codexValues },
    });
    const text = byPath(files, ".codex/agents/tricky_codex.toml");
    // 生の制御文字（改行以外）を TOML の中に直接書かない
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
    expect(text).not.toContain('"""');
    const toml = parseToml(text) as Record<string, unknown>;
    expect(toml["developer_instructions"]).toBe(body);
    expect(toml["description"]).toBe('ダブルクォート " と \\ を含む説明');
    expect(toml["sandbox_mode"]).toBe("workspace-write");
    // Claude 側の本文はそのまま
    expect(byPath(files, ".claude/agents/tricky.md").endsWith(`---\n${body}`)).toBe(true);
  });

  it("#31 AC-3: 本文の中の {{名前}} も差し込む（冒頭の引用符付きの名前と同じ値で）", () => {
    const dir = makeTemplates({
      ...requiredTemplateFiles(),
      "agents/a.md": `---
name: a
description: d
claude:
  tools: Read
  model: "{{claude_model_a}}"
codex:
  name: a
  model: "{{codex_model_a}}"
  model_reasoning_effort: low
  sandbox_mode: read-only
---
本文 {{app_name}}
`,
    });
    const files = buildAiOutputs({
      templatesDir: dir,
      ais: ["codex"],
      profiles: [],
      values: { app_name: "testapp_001", codex_model_a: "m-a" },
    });
    const toml = parseToml(byPath(files, ".codex/agents/a.toml")) as Record<string, unknown>;
    expect(toml["developer_instructions"]).toBe("本文 testapp_001\n");
    expect(toml["model"]).toBe("m-a");
  });

  it("#31 AC-3: 冒頭（---）がないエージェントのひな形はエラーにする", () => {
    const dir = makeTemplates({ ...requiredTemplateFiles(), "agents/bad.md": "# 冒頭がない\n" });
    expect(() =>
      buildAiOutputs({ templatesDir: dir, ais: ["claude"], profiles: [], values: claudeValues }),
    ).toThrow(GenerateError);
  });

  it("#31 AC-3: codex: の中の name がないエージェントはエラーにする（Codex を選んだとき）", () => {
    const dir = makeTemplates({
      ...requiredTemplateFiles(),
      "agents/bad.md": `---
name: bad
description: d
claude:
  tools: Read
  model: "{{claude_model_planner}}"
codex:
  model: "{{codex_model_planner}}"
  model_reasoning_effort: "{{codex_effort_planner}}"
  sandbox_mode: read-only
---
本文
`,
    });
    expect(() =>
      buildAiOutputs({ templatesDir: dir, ais: ["codex"], profiles: [], values: codexValues }),
    ).toThrow(GenerateError);
  });
});

describe("#31 AC-3: 実際の templates/ での出力", () => {
  const profiles = () =>
    resolveProfiles(realTemplatesDir, [
      "backend-framework/hono",
      "logger/structured-logger",
      "data-access/drizzle",
    ]);

  it("#31 AC-3: 全エージェントと全 Skill が出力され、名前（{{...}}）の残りがない（値は架空のもの）", () => {
    const files = buildAiOutputs({
      templatesDir: realTemplatesDir,
      ais: ["claude", "codex"],
      profiles: profiles(),
      values: fakeValues(),
    });
    const all = paths(files);
    for (const agent of Object.keys(REAL_AGENTS)) {
      expect(all).toContain(`.claude/agents/${agent}.md`);
      expect(all).toContain(`.codex/agents/${REAL_AGENTS[agent]}.toml`);
    }
    for (const skill of REAL_SKILLS) {
      expect(all).toContain(`.claude/skills/${skill}/SKILL.md`);
      expect(all).toContain(`.agents/skills/${skill}/SKILL.md`);
    }
    for (const skill of ["backend-hono", "logger", "data-access-drizzle"]) {
      expect(all).toContain(`.claude/skills/${skill}/SKILL.md`);
      expect(all).toContain(`.agents/skills/${skill}/SKILL.md`);
    }
    for (const file of files) {
      expect(file.content, file.path).not.toMatch(LEFTOVER_NAME);
      expect(file.content, file.path).not.toContain("{{include:");
    }
  });

  it("#31 AC-3: 選んでいないAIの値なしに生成できる（Codex だけ・Claude だけ）", () => {
    const all = fakeValues();
    const codexOnly = Object.fromEntries(
      Object.entries(all).filter(([k]) => !k.startsWith("claude_")),
    );
    const claudeOnly = Object.fromEntries(
      Object.entries(all).filter(([k]) => !k.startsWith("codex_")),
    );
    const c = buildAiOutputs({
      templatesDir: realTemplatesDir,
      ais: ["codex"],
      profiles: profiles(),
      values: codexOnly,
    });
    expect(paths(c).some((p) => p.startsWith(".claude/"))).toBe(false);
    expect(paths(c)).not.toContain("CLAUDE.md");
    const l = buildAiOutputs({
      templatesDir: realTemplatesDir,
      ais: ["claude"],
      profiles: profiles(),
      values: claudeOnly,
    });
    expect(paths(l).some((p) => p.startsWith(".codex/") || p.startsWith(".agents/"))).toBe(false);
  });

  it("#31 AC-3: 全エージェントで、選んだAIのモデルの値が文字列として一致する", () => {
    const files = buildAiOutputs({
      templatesDir: realTemplatesDir,
      ais: ["claude", "codex"],
      profiles: [],
      values: fakeValues(),
    });
    for (const [file, codexName] of Object.entries(REAL_AGENTS)) {
      const role = codexName;
      expect(AGENT_ROLES).toContain(role);
      const { head } = splitFrontmatter(byPath(files, `.claude/agents/${file}.md`));
      expect(head["model"], file).toBe(`claude-model-${role}-test`);
      expect(head["name"], file).toBe(file);
      expect(Object.keys(head), file).not.toContain("codex");
      expect(Object.keys(head), file).not.toContain("claude");

      const toml = parseToml(byPath(files, `.codex/agents/${codexName}.toml`)) as Record<
        string,
        unknown
      >;
      expect(toml["name"], file).toBe(codexName);
      expect(toml["model"], file).toBe(`codex-model-${role}-test`);
      expect(toml["model_reasoning_effort"], file).toBe("medium");
      expect(["read-only", "workspace-write"], file).toContain(toml["sandbox_mode"]);
      expect(typeof toml["description"], file).toBe("string");
    }
  });

  it("#31 AC-3: 全エージェントで、Codex の本文（developer_instructions）が Claude の本文と一致する", () => {
    const files = buildAiOutputs({
      templatesDir: realTemplatesDir,
      ais: ["claude", "codex"],
      profiles: [],
      values: fakeValues(),
    });
    for (const [file, codexName] of Object.entries(REAL_AGENTS)) {
      const { body } = splitFrontmatter(byPath(files, `.claude/agents/${file}.md`));
      const toml = parseToml(byPath(files, `.codex/agents/${codexName}.toml`)) as Record<
        string,
        unknown
      >;
      expect(toml["developer_instructions"], file).toBe(body);
      expect(body.length, file).toBeGreaterThan(100);
    }
  });

  it("#31 AC-3: 実際の権限の設定が元のとおり出力される（Claude は JSON、Codex は中身が同じ）", () => {
    const files = buildAiOutputs({
      templatesDir: realTemplatesDir,
      ais: ["claude", "codex"],
      profiles: [],
      values: fakeValues(),
    });
    const original = readFileSync(
      path.join(realTemplatesDir, "ai-settings", "claude-settings.json"),
      "utf8",
    );
    const out = JSON.parse(byPath(files, ".claude/settings.json")) as {
      permissions: { ask: string[]; deny: string[] };
    };
    const src = JSON.parse(original) as typeof out;
    expect(out.permissions.ask).toEqual(src.permissions.ask);
    expect(out.permissions.deny).toEqual(src.permissions.deny);
    const rules = byPath(files, ".codex/rules/default.rules");
    const rulesSrc = readFileSync(
      path.join(realTemplatesDir, "ai-settings", "codex-default.rules"),
      "utf8",
    );
    expect(rulesSrc).toContain("もとになった共通仕様");
    expect(rules).toBe(
      stripRulesMarker(rulesSrc).replace(
        "{{env_check_how}}",
        fakeValues()["env_check_how"] as string,
      ),
    );
    expect(rules).not.toContain("もとになった共通仕様");
  });

  it("#31 AC-3: Drizzle の Skill に、共通の部分（data-access/_shared）が引用されて入る", () => {
    const files = buildAiOutputs({
      templatesDir: realTemplatesDir,
      ais: ["claude"],
      profiles: profiles(),
      values: fakeValues(),
    });
    const skill = byPath(files, ".claude/skills/data-access-drizzle/SKILL.md");
    expect(skill).toContain("## データアクセスの共通ルール");
    expect(skill).not.toContain("もとになった共通仕様：C-03");
    expect(skill).toContain("このプロジェクトのDB：dummy-database");
  });
});

describe("#31 AC-3: 必須のひな形がない場合はエラー（C-71）", () => {
  const agent = requiredAgent();

  function requiredAgent(): Record<string, string> {
    return {
      "agents/planner.md": `---
name: p
description: d
claude:
  tools: Read
  model: "{{claude_model_planner}}"
codex:
  name: p
  model: "{{codex_model_planner}}"
  model_reasoning_effort: "{{codex_effort_planner}}"
  sandbox_mode: read-only
---
本文
`,
    };
  }

  const cases: { missing: string; ais: ("claude" | "codex")[] }[] = [
    { missing: "AGENTS.md", ais: ["codex"] },
    { missing: "ai-settings/claude-settings.json", ais: ["claude"] },
    { missing: "ai-settings/codex-default.rules", ais: ["codex"] },
    { missing: "skills/demo-skill/SKILL.md", ais: ["claude"] },
    { missing: "CLAUDE.md", ais: ["claude"] },
  ];

  it.each(cases)(
    "#31 AC-3: $missing がないとエラーにし、足りないファイル名を示す",
    ({ missing, ais }) => {
      const files = { ...requiredTemplateFiles(), ...agent };
      delete files[missing];
      const dir = makeTemplates(files);
      const run = () =>
        buildAiOutputs({
          templatesDir: dir,
          ais,
          profiles: [],
          values: { ...claudeValues, ...codexValues },
        });
      expect(run).toThrow(GenerateError);
      expect(run).toThrow(
        missing.startsWith("skills/") ? "skills" : (missing.split("/").pop() as string),
      );
    },
  );

  it("#31 AC-3: agents/ がないとエラーにする", () => {
    const dir = makeTemplates(requiredTemplateFiles());
    expect(() =>
      buildAiOutputs({
        templatesDir: dir,
        ais: ["claude"],
        profiles: [],
        values: claudeValues,
      }),
    ).toThrow(GenerateError);
  });

  it("#31 AC-3: CLAUDE.md は codex だけを選ぶ場合は必須ではない", () => {
    const files = { ...requiredTemplateFiles(), ...agent };
    delete files["CLAUDE.md"];
    const dir = makeTemplates(files);
    expect(() =>
      buildAiOutputs({ templatesDir: dir, ais: ["codex"], profiles: [], values: codexValues }),
    ).not.toThrow();
  });
});

describe("#31 AC-3: ハーネス用の説明のコメントは出力に残さない", () => {
  const MARK = "もとになった共通仕様";

  it("#31 AC-3: 実際の templates で、AGENTS.md・CLAUDE.md・Skill・エージェントの出力に含まれない", () => {
    const files = buildAiOutputs({
      templatesDir: realTemplatesDir,
      ais: ["claude", "codex"],
      profiles: resolveProfiles(realTemplatesDir, [
        "data-access/drizzle",
        "logger/structured-logger",
      ]),
      values: fakeValues(),
    });
    for (const f of files) expect(f.content, f.path).not.toContain(MARK);
  });

  it("#31 AC-3: fixtures で、コメントを持つ AGENTS.md・CLAUDE.md・Skill の出力に含まれない", () => {
    const base = requiredTemplateFiles();
    const dir = makeTemplates({
      ...base,
      "AGENTS.md": `<!-- ${MARK}：C-01 -->\n\n# {{app_name}}\n`,
      "CLAUDE.md": `@AGENTS.md\n\n<!-- ${MARK}：C-11 -->\n\n# Claude 固有\n`,
      "skills/demo-skill/SKILL.md": `---\nname: demo-skill\ndescription: d\n---\n\n<!-- ${MARK}：C-03 -->\n# デモ\n`,
      "agents/planner.md": `---
name: p
description: d
claude:
  tools: Read
  model: "{{claude_model_planner}}"
codex:
  name: p
  model: "{{codex_model_planner}}"
  model_reasoning_effort: "{{codex_effort_planner}}"
  sandbox_mode: read-only
---
<!-- ${MARK}：C-02 -->
本文
`,
    });
    const files = buildAiOutputs({
      templatesDir: dir,
      ais: ["claude", "codex"],
      profiles: [],
      values: { ...claudeValues, ...codexValues },
    });
    for (const f of files) expect(f.content, f.path).not.toContain(MARK);
    expect(byPath(files, "AGENTS.md")).toContain("# testapp_001");
    expect(byPath(files, "CLAUDE.md")).toContain("# Claude 固有");
    expect(byPath(files, ".claude/skills/demo-skill/SKILL.md")).toContain("# デモ");
    expect(byPath(files, ".claude/skills/demo-skill/SKILL.md")).toContain("name: demo-skill");
  });
});
