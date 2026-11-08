// #60：Orca連携・統括AIの整合性チェック（F-30）と、その事実（facts.ts）
import { describe, expect, it } from "vitest";
import { collectFacts } from "../../src/checks/facts.js";
import type { ToolStatus } from "../../src/checks/tools.js";
import { evaluateRules, loadRules } from "../../src/checks/rules.js";
import { baseAnswers } from "../questions/helpers.js";

const rules = loadRules();
const okTools = async (): Promise<ToolStatus[]> => [
  { name: "node", state: "ok", version: "24.0.0" },
];

async function hitIds(over: Record<string, unknown>): Promise<string[]> {
  const answers = baseAnswers(over);
  const facts = await collectFacts(answers, { cwd: "unused", checkTools: okTools });
  const r = evaluateRules(rules, answers, facts);
  return [...r.errors, ...r.warnings, ...r.infos].map((h) => h.id);
}

describe("#60 AC-6: 統括AIの整合性チェック", () => {
  it("#60 AC-6: orca が none で orchestrator_ai があると、orchestrator-without-orca がエラーになる", async () => {
    const ids = await hitIds({ orca: "none", orchestrator_ai: "claude" });
    expect(ids).toContain("orchestrator-without-orca");
    const rule = rules.find((r) => r.id === "orchestrator-without-orca");
    expect(rule?.level).toBe("error");
    expect(rule?.fix).toEqual(["orca", "orchestrator_ai"]);
  });

  it("#60 AC-6: orca が省略されていても、orchestrator_ai があれば orchestrator-without-orca になる", async () => {
    const answers = baseAnswers({ orchestrator_ai: "claude" }) as Record<string, unknown>;
    delete answers["orca"];
    const facts = await collectFacts(answers, { cwd: "unused", checkTools: okTools });
    expect(facts.orchestrator_without_orca).toBe(true);
  });

  it("#60 AC-6: orchestrator_ai が ais に含まれないと、orchestrator-not-in-ais がエラーになる", async () => {
    const ids = await hitIds({ ais: ["claude"], orca: "use", orchestrator_ai: "codex" });
    expect(ids).toContain("orchestrator-not-in-ais");
    expect(ids).not.toContain("orchestrator-without-orca");
    expect(rules.find((r) => r.id === "orchestrator-not-in-ais")?.level).toBe("error");
  });

  it("#60 AC-1: 連携なし・正しい指定では、どちらの規則にも当たらない", async () => {
    for (const over of [
      {},
      { orca: "none" },
      { orca: "use", orchestrator_ai: "claude" },
      { ais: ["claude", "codex"], orca: "use", orchestrator_ai: "codex" },
    ]) {
      const ids = await hitIds(over);
      expect(ids).not.toContain("orchestrator-without-orca");
      expect(ids).not.toContain("orchestrator-not-in-ais");
    }
  });
});
