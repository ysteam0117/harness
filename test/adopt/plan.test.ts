// #15 導入の判定（純粋な関数。ディスクは見ない）。想定する型：src/adopt/plan.ts（planAdopt）
import { describe, expect, it } from "vitest";
import { planAdopt } from "../../src/adopt/plan.js";
import type { AdoptFile } from "../../src/adopt/build.js";
import type { FileState } from "../../src/update/plan.js";

const doc = (p: string, body: string): AdoptFile => ({ path: p, content: body, kind: "doc" });
const file = (p: string, content: string): AdoptFile => ({ path: p, content, kind: "file" });
const present = (text: string): FileState => ({ kind: "file", text });

describe("#15 AC-2: 導入の判定", () => {
  it("#15 AC-2: AGENTS.md・CLAUDE.md は、有無にかかわらず doc-merge（無ければ current は undefined）", () => {
    const decisions = planAdopt({
      files: [doc("AGENTS.md", "本文A"), doc("CLAUDE.md", "本文C")],
      current: new Map<string, FileState>([["AGENTS.md", present("既存\n")]]),
    });
    expect(decisions).toEqual([
      { kind: "doc-merge", path: "AGENTS.md", body: "本文A", current: "既存\n" },
      { kind: "doc-merge", path: "CLAUDE.md", body: "本文C", current: undefined },
    ]);
  });

  it("#15 AC-2: 無いファイルは add", () => {
    const f = file(".claude/skills/testing/SKILL.md", "中身");
    expect(planAdopt({ files: [f], current: new Map() })).toEqual([
      { kind: "add", path: f.path, file: f },
    ]);
  });

  it("#15 AC-2: 同じ中身なら same（改行の違いだけでも same）", () => {
    const f = file(".claude/skills/a/SKILL.md", "一行目\n二行目\n");
    const decisions = planAdopt({
      files: [f],
      current: new Map([[f.path, present("一行目\r\n二行目\r\n")]]),
    });
    expect(decisions).toEqual([{ kind: "same", path: f.path, file: f }]);
  });

  it("#15 AC-2: 同じ名前で中身が違えば choose（今の中身を持つ）", () => {
    const f = file(".claude/agents/planner.md", "ハーネスの計画役");
    const decisions = planAdopt({
      files: [f],
      current: new Map([[f.path, present("利用者の計画役")]]),
    });
    expect(decisions).toEqual([
      { kind: "choose", path: f.path, file: f, current: "利用者の計画役" },
    ]);
  });

  it("#15 AC-2: 判定の順は渡されたファイルの順", () => {
    const a = file("b.md", "1");
    const b = file("a.md", "2");
    expect(planAdopt({ files: [a, b], current: new Map() }).map((d) => d.path)).toEqual([
      "b.md",
      "a.md",
    ]);
  });
});
