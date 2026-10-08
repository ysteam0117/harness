// #20 差の一覧(assessAdoption / renderAdoptionDoc)。機械的に分かる項目だけ判定し、ほかは「未確認」。
// ディスクは読まない純粋な関数なので、架空の入力だけで確かめる。
import { describe, expect, it } from "vitest";
import {
  assessAdoption,
  loadAdoptionChecks,
  renderAdoptionDoc,
  VERDICT_LABEL,
  type AdoptionCheck,
  type AssessInput,
  type Verdict,
} from "../../src/adopt/assess.js";
import type { DetectedStack } from "../../src/adopt/detect.js";
import { judge } from "../../src/generate/judgment.js";
import { baseAnswers } from "../questions/helpers.js";

const EMPTY_STACK: DetectedStack = { apps: [], notes: [] };

function stackOf(...items: { class: string; technology: string; evidence: string[] }[]) {
  return {
    apps: [{ dir: ".", app: true, packages: [], items }],
    notes: [],
  } as unknown as DetectedStack;
}

const FILES = { added: [], merged: [], replaced: [], kept: [], same: [] };

function input(over: Partial<AssessInput> & { checks: AdoptionCheck[] }): AssessInput {
  return {
    enabledRules: [],
    files: FILES,
    stack: EMPTY_STACK,
    scan: { status: "passed" },
    ...over,
  };
}

const verdictOf = (a: ReturnType<typeof assessAdoption>, id: string): Verdict | undefined =>
  a.results.find((r) => r.id === id)?.verdict;

const manual = (id: string): AdoptionCheck => ({ id, title: `項目 ${id}`, method: "manual" });

describe("#20 AC-2: 差の一覧の判定", () => {
  it("#20 AC-2: 判定の値は5種類で、ラベルは決まっている", () => {
    expect(VERDICT_LABEL).toEqual({
      met: "満たしている",
      partial: "一部",
      unmet: "満たしていない",
      na: "対象外",
      unconfirmed: "未確認",
    });
  });

  it("#20 AC-2: manual は未確認", () => {
    const a = assessAdoption(input({ checks: [manual("C-01")] }));
    expect(verdictOf(a, "C-01")).toBe("unconfirmed");
  });

  it("#20 AC-2: 導入物の項目:足した・統合した・置き換えた・同じ内容なら満たしている", () => {
    const check: AdoptionCheck = {
      id: "C-05",
      title: "標準ルール",
      method: "harness_files",
      files: ["AGENTS.md", "CLAUDE.md"],
    };
    for (const key of ["added", "merged", "replaced", "same"] as const) {
      const a = assessAdoption(
        input({ checks: [check], files: { ...FILES, [key]: ["AGENTS.md", "CLAUDE.md"] } }),
      );
      expect(verdictOf(a, "C-05"), key).toBe("met");
    }
  });

  it("#20 AC-2: 導入物の項目:既存を残したファイルが1つでもあれば一部", () => {
    const check: AdoptionCheck = {
      id: "C-68",
      title: "AI の設定",
      method: "harness_files",
      files: [".claude/settings.json"],
    };
    const a = assessAdoption(
      input({ checks: [check], files: { ...FILES, kept: [".claude/settings.json"] } }),
    );
    expect(verdictOf(a, "C-68")).toBe("partial");
  });

  it("#20 AC-2: 導入物の項目:今回導入しなかったファイルしかなければ未確認(選ばなかった AI の分は数えない)", () => {
    const check: AdoptionCheck = {
      id: "C-56",
      title: "知見",
      method: "harness_files",
      files: [".claude/skills/knowledge/SKILL.md", ".agents/skills/knowledge/SKILL.md"],
    };
    const only = assessAdoption(
      input({ checks: [check], files: { ...FILES, added: [".claude/skills/knowledge/SKILL.md"] } }),
    );
    expect(verdictOf(only, "C-56")).toBe("met");
    const none = assessAdoption(input({ checks: [check] }));
    expect(verdictOf(none, "C-56")).toBe("unconfirmed");
  });

  it("#20 AC-2: CI:harness-check.yml を足す・既存の CI がある→一部、どちらも無い→満たしていない", () => {
    const check: AdoptionCheck = { id: "C-61", title: "CI", method: "ci" };
    const withFile = assessAdoption(
      input({
        checks: [check],
        files: { ...FILES, added: [".github/workflows/harness-check.yml"] },
      }),
    );
    expect(verdictOf(withFile, "C-61")).toBe("partial");
    const withExisting = assessAdoption(
      input({
        checks: [check],
        stack: stackOf({
          class: "ci",
          technology: "GitHub Actions",
          evidence: [".github/workflows/ci.yml"],
        }),
      }),
    );
    expect(verdictOf(withExisting, "C-61")).toBe("partial");
    const none = assessAdoption(input({ checks: [check] }));
    expect(verdictOf(none, "C-61")).toBe("unmet");
  });

  it("#20 AC-2: 技術の項目:判定できていれば一部(設定の差は未確認と書く)、できていなければ満たしていない", () => {
    const check: AdoptionCheck = {
      id: "C-57",
      title: "整形",
      method: "stack",
      stack: { technology: "Prettier" },
    };
    const found = assessAdoption(
      input({
        checks: [check],
        stack: stackOf({ class: "quality", technology: "Prettier", evidence: [".prettierrc"] }),
      }),
    );
    expect(verdictOf(found, "C-57")).toBe("partial");
    const basis = found.results[0]?.basis ?? "";
    expect(basis).toContain("設定の差は未確認");
    expect(basis).toContain(".prettierrc");
    const other = assessAdoption(
      input({
        checks: [check],
        stack: stackOf({ class: "quality", technology: "ESLint", evidence: ["eslint.config.js"] }),
      }),
    );
    expect(verdictOf(other, "C-57")).toBe("unmet");
  });

  it("#20 AC-2: 技術の項目:分類(class)でも判定できる", () => {
    const check: AdoptionCheck = {
      id: "C-24",
      title: "テスト",
      method: "stack",
      stack: { class: "test" },
    };
    const found = assessAdoption(
      input({
        checks: [check],
        stack: stackOf({ class: "test", technology: "Jest", evidence: ["jest.config.js"] }),
      }),
    );
    expect(verdictOf(found, "C-24")).toBe("partial");
    expect(verdictOf(assessAdoption(input({ checks: [check] })), "C-24")).toBe("unmet");
  });

  it("#20 AC-2: 秘密情報の確認:通っていれば満たしている(clean が partial の項目は一部)、省いていれば未確認", () => {
    const plain: AdoptionCheck = { id: "C-90", title: "秘密", method: "scan" };
    const half: AdoptionCheck = { id: "C-82", title: "テスト", method: "scan", clean: "partial" };
    const passed = assessAdoption(input({ checks: [plain, half], scan: { status: "passed" } }));
    expect(verdictOf(passed, "C-90")).toBe("met");
    expect(verdictOf(passed, "C-82")).toBe("partial");
    const skipped = assessAdoption(input({ checks: [plain, half], scan: { status: "skipped" } }));
    expect(verdictOf(skipped, "C-90")).toBe("unconfirmed");
    expect(verdictOf(skipped, "C-82")).toBe("unconfirmed");
  });

  it("#20 AC-2: 条件つきのルール:回答で有効でなければ対象外、有効なら元の方法で判定する", () => {
    const check: AdoptionCheck = { id: "C-19", title: "試行制限", method: "answers", rule: "C-19" };
    const off = assessAdoption(input({ checks: [check], enabledRules: ["C-09"] }));
    expect(verdictOf(off, "C-19")).toBe("na");
    const on = assessAdoption(input({ checks: [check], enabledRules: ["C-09", "C-19"] }));
    expect(verdictOf(on, "C-19")).toBe("unconfirmed");
  });

  it("#20 AC-2: 未定の回答は安全側で有効になり、対象外にならない(実際の判定と質問の回答で確かめる)", () => {
    const checks = loadAdoptionChecks().filter((c) => c.rule !== undefined);
    expect(checks.length).toBeGreaterThan(0);
    const undecided = judge(
      baseAnswers({
        personal_data: "undecided",
        admin: "undecided",
        critical_ops: "undecided",
        collaborative: "undecided",
        org_separation: "undecided",
        realtime: "undecided",
        availability: "undecided",
      }) as never,
    );
    const a = assessAdoption(input({ checks, enabledRules: undecided.enabledRules }));
    expect(a.results.filter((r) => r.verdict === "na")).toEqual([]);
    const strict = judge(
      baseAnswers({
        personal_data: "none",
        admin: "no",
        critical_ops: "no",
        collaborative: "no",
        org_separation: "no",
        realtime: "no",
        availability: "tolerant",
      }) as never,
    );
    const b = assessAdoption(input({ checks, enabledRules: strict.enabledRules }));
    expect(b.results.every((r) => r.verdict === "na")).toBe(true);
  });

  it("#20 AC-2: 件数は判定の値ごとに数える", () => {
    const a = assessAdoption(
      input({
        checks: [manual("C-01"), manual("C-02"), { id: "C-61", title: "CI", method: "ci" }],
      }),
    );
    expect(a.counts).toEqual({ met: 0, partial: 0, unmet: 1, na: 0, unconfirmed: 2 });
  });

  it("#20 AC-2: 実際の一覧(data)で、全項目に判定の値がつく", () => {
    const a = assessAdoption({
      enabledRules: [],
      files: { ...FILES, merged: ["AGENTS.md", "CLAUDE.md"] },
      stack: EMPTY_STACK,
      scan: { status: "skipped" },
    });
    expect(a.results.length).toBe(loadAdoptionChecks().length);
    expect(verdictOf(a, "C-05")).toBe("met");
  });
});

describe("#20 AC-3: 差の一覧の文書(docs/harness-adoption.md)", () => {
  const checks: AdoptionCheck[] = [
    { id: "C-05", title: "標準ルール", method: "harness_files", files: ["AGENTS.md"] },
    manual("C-01"),
    { id: "C-61", title: "CI", method: "ci" },
  ];
  const assessed = assessAdoption(input({ checks, files: { ...FILES, merged: ["AGENTS.md"] } }));
  const doc = renderAdoptionDoc(assessed, { appName: "sample-app", day: "2026-10-08" });

  it("#20 AC-3: 凡例・件数・表・未確認の埋め方・次の手順がある", () => {
    expect(doc).toContain("# ハーネスの導入の差の一覧");
    expect(doc).toContain("sample-app");
    expect(doc).toContain("2026-10-08");
    for (const label of Object.values(VERDICT_LABEL)) expect(doc).toContain(label);
    expect(doc).toContain("| C-05 | 標準ルール | 満たしている |");
    expect(doc).toContain("| C-01 | 項目 C-01 | 未確認 |");
    expect(doc).toContain("| C-61 | CI | 満たしていない |");
    expect(doc).toMatch(/満たしている：1 件/);
    expect(doc).toMatch(/未確認：1 件/);
    expect(doc).toContain("adopt-existing");
    expect(doc).toContain("Issue");
  });

  it("#20 AC-3: 値・ファイルの中身は書かない(根拠はパスと名前だけ)", () => {
    const withStack = assessAdoption(
      input({
        checks: [{ id: "C-57", title: "整形", method: "stack", stack: { technology: "Prettier" } }],
        stack: stackOf({ class: "quality", technology: "Prettier", evidence: [".prettierrc"] }),
      }),
    );
    const text = renderAdoptionDoc(withStack, { appName: "sample-app", day: "2026-10-08" });
    expect(text).toContain(".prettierrc");
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/\bpassword\b|\bsecret\b|\btoken\b/i);
  });

  it("#20 AC-3: 同じ入力なら同じ文書になる(改行は LF)", () => {
    expect(renderAdoptionDoc(assessed, { appName: "sample-app", day: "2026-10-08" })).toBe(doc);
    expect(doc).not.toContain("\r");
    expect(doc.endsWith("\n")).toBe(true);
  });
});
