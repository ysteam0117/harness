// #20 data/adoption-checks.yaml（差の一覧に出す共通仕様の一覧と、判定の方法）。
// 項目の過不足は、docs/requirements/common/*.md の冒頭の表と照らして確かめる。架空の値だけを使う。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadAdoptionChecks } from "../../src/adopt/assess.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMMON = path.join(ROOT, "docs", "requirements", "common");

/** 各ファイルの冒頭の表（最初の「## 」より前）にある C-xx。<a id> の形と [C-xx](#c-xx) の形の両方 */
function idsInRequirements(): string[] {
  const ids: string[] = [];
  for (const name of readdirSync(COMMON).filter((n) => n.endsWith(".md"))) {
    const text = readFileSync(path.join(COMMON, name), "utf8").replace(/\r\n/g, "\n");
    const head = text.split(/^## /m)[0] ?? "";
    for (const line of head.split("\n")) {
      const m = /^\|\s*(?:<a id="c-\d+"><\/a>|\[)?(C-\d+)/.exec(line);
      if (m?.[1] !== undefined) ids.push(m[1]);
    }
  }
  return ids;
}

describe("#20 AC-1: 共通仕様の一覧(data/adoption-checks.yaml)", () => {
  it("#20 AC-1: 要件の文書の冒頭の表の C-xx と、過不足なく一致する", () => {
    const required = idsInRequirements();
    expect(required.length).toBeGreaterThan(50);
    expect(new Set(required).size).toBe(required.length);
    const ids = loadAdoptionChecks().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => !required.includes(id))).toEqual([]);
    expect(required.filter((id) => !ids.includes(id))).toEqual([]);
  });

  it("#20 AC-1: すべての項目に見出しがあり、判定の方法は決まった値のどれか", () => {
    const methods = ["harness_files", "ci", "stack", "answers", "scan", "manual"];
    for (const c of loadAdoptionChecks()) {
      expect(c.title.length, c.id).toBeGreaterThan(0);
      expect(methods, c.id).toContain(c.method);
    }
  });

  it("#20 AC-1: 方法ごとの必須の項目がそろっている", () => {
    for (const c of loadAdoptionChecks()) {
      if (c.method === "harness_files") expect(c.files?.length ?? 0, c.id).toBeGreaterThan(0);
      if (c.method === "stack") {
        expect(c.stack?.class !== undefined || c.stack?.technology !== undefined, c.id).toBe(true);
      }
      if (c.method === "answers") expect(c.rule, c.id).toMatch(/^C-\d+$/);
    }
  });

  it("#20 AC-1: 条件つきのルール(rule)は、回答からの判定(judge)が出しうる番号だけ", async () => {
    const { judge } = await import("../../src/generate/judgment.js");
    const { baseAnswers } = await import("../questions/helpers.js");
    // 質問をすべて「ある」にしたとき、判定が有効にするルール
    const all = new Set(
      judge(
        baseAnswers({
          personal_data: "sensitive",
          admin: "yes",
          critical_ops: "yes",
          critical_ops_kinds: ["payment"],
          collaborative: "yes",
          org_separation: "yes",
          realtime: "yes",
          availability: "critical",
        }) as never,
      ).enabledRules,
    );
    for (const c of loadAdoptionChecks()) {
      if (c.rule !== undefined) expect(all.has(c.rule), `${c.id} の rule ${c.rule}`).toBe(true);
    }
  });
});
