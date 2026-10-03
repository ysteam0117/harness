// 想定する型（実装は src/generate/knowledge.ts をこれに合わせる）。R4：知見は関係するものだけ写す
//
//   export interface KnowledgeEntry {
//     source: string;    // knowledge/ からの相対パス（"db/index-design.md"）。"/" 区切り
//     field: string;     // 分野（source の最初のフォルダ。"db"・"frontend"・"backend"・"general"）
//     file: string;      // ファイル名（"index-design.md"）
//     title: string;     // ファイルの最初の見出し（"# " の行の文字）
//     content: string;   // 中身（改行は LF にそろえる）
//   }
//   export function selectKnowledge(
//     answers: Answers,
//     opts?: { knowledgeDir?: string },    // 既定は実際の knowledge/（ハーネスのリポジトリ直下。配布物にも入る）
//   ): KnowledgeEntry[];
//     // README.md は除く。source の順。data/knowledge-selection.yaml の条件（例：db/* は database ≠ none のとき）で選ぶ。
//     // 条件の書いていないファイルは常に写す
//   export function knowledgeIndexRows(entries: KnowledgeEntry[]): string;
//     // Skill「知見」の表（分野・ファイル・内容）の行。1ファイル1行で、改行でつなぐ。entries が空なら ""
//
//   data/knowledge-selection.yaml：知見のファイル → 回答の条件（#32 の条件の書き方 answer／equals・in・notEquals）
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { knowledgeIndexRows, selectKnowledge } from "../../src/generate/knowledge.js";
import { cleanupTemplates, makeTemplates, realTemplatesDir } from "./helpers.js";
import { completeAnswers } from "./project-helpers.js";

afterEach(cleanupTemplates);

const REAL_KNOWLEDGE = path.resolve(realTemplatesDir, "../knowledge");
const sources = (entries: { source: string }[]) => entries.map((e) => e.source);

describe("#34 R4: 知見は関係するものだけ", () => {
  it("#34 R4: DB ありでは、README 以外のすべての知見が選ばれ、source の順に並ぶ", async () => {
    const entries = selectKnowledge(await completeAnswers({ database: "d1" }));
    expect(sources(entries)).toEqual([
      "backend/api-response-time.md",
      "db/index-design.md",
      "db/sql-complexity.md",
      "frontend/initial-bundle-size.md",
      "general/pentest-scenario.md",
    ]);
    expect(sources(entries)).not.toContain("README.md");
  });

  it("#34 R4: PostgreSQL でも、DB の知見が選ばれる", async () => {
    const entries = selectKnowledge(
      await completeAnswers({ database: "postgresql", postgres_provider: "neon" }),
    );
    expect(sources(entries)).toContain("db/index-design.md");
    expect(sources(entries)).toContain("db/sql-complexity.md");
  });

  it("#34 R4: DB なしでは、db の知見が選ばれず、ほかの分野は選ばれる", async () => {
    const entries = selectKnowledge(await completeAnswers({ database: "none" }));
    expect(sources(entries).filter((s) => s.startsWith("db/"))).toEqual([]);
    expect(sources(entries)).toEqual(
      expect.arrayContaining([
        "backend/api-response-time.md",
        "frontend/initial-bundle-size.md",
        "general/pentest-scenario.md",
      ]),
    );
  });

  it("#34 R4: 各項目は分野・ファイル名・最初の見出し・中身（LF）を持つ", async () => {
    const entries = selectKnowledge(await completeAnswers({ database: "d1" }));
    const idx = entries.find((e) => e.source === "db/index-design.md");
    expect(idx).toBeDefined();
    expect(idx?.field).toBe("db");
    expect(idx?.file).toBe("index-design.md");
    expect(idx?.title).toBe("インデックスの設計");
    const raw = readFileSync(path.join(REAL_KNOWLEDGE, "db", "index-design.md"), "utf8").replace(
      /\r\n/g,
      "\n",
    );
    expect(idx?.content).toBe(raw);
    for (const e of entries) {
      expect(e.title, e.source).not.toBe("");
      expect(e.title, e.source).not.toMatch(/^#/);
      expect(e.content, e.source).not.toContain("\r");
    }
  });

  it("#34 R4: 条件の書いていない知見（新しく足したファイル）は、DB なしでも常に写される。README は写されない", async () => {
    const dir = makeTemplates({
      "README.md": "# 知見の README\n",
      "general/new-note.md": "# 新しい知見のテスト\n\n本文\n",
    });
    const none = selectKnowledge(await completeAnswers({ database: "none" }), {
      knowledgeDir: dir,
    });
    expect(sources(none)).toContain("general/new-note.md");
    expect(sources(none)).not.toContain("README.md");
  });

  it("#34 R4: 同じ入力なら同じ結果になる", async () => {
    const a = await completeAnswers({ database: "d1" });
    expect(selectKnowledge(a)).toEqual(selectKnowledge(a));
  });
});

describe("#34 R4: knowledge_index の行は、写すファイルと同じ一覧から作る", () => {
  it("#34 R4: 1ファイル1行で、分野・ファイル名・見出しを含む表の行になる", async () => {
    const entries = selectKnowledge(await completeAnswers({ database: "d1" }));
    const rows = knowledgeIndexRows(entries).split("\n");
    expect(rows).toHaveLength(entries.length);
    entries.forEach((e, i) => {
      const row = rows[i] ?? "";
      expect(row).toMatch(/^\| .+ \| .+ \| .+ \|$/);
      expect(row).toContain(e.field);
      expect(row).toContain(e.file.replace(/\.md$/, ""));
      expect(row).toContain(e.title);
    });
  });

  it("#34 R4: DB なしでは、db の知見の行がない", async () => {
    const rows = knowledgeIndexRows(selectKnowledge(await completeAnswers({ database: "none" })));
    expect(rows).not.toContain("index-design");
    expect(rows).not.toContain("sql-complexity");
    expect(rows).toContain("api-response-time");
  });

  it("#34 R4: 空の一覧からは空の文字列", () => {
    expect(knowledgeIndexRows([])).toBe("");
  });
});
