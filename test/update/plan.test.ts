// #35 判定（planUpdate）。純粋な関数。想定する型：src/update/plan.ts
import { describe, expect, it } from "vitest";
import { fingerprint } from "../../src/generate/config.js";
import { planUpdate, type FileState, type PlanInput } from "../../src/update/plan.js";

const file = (p: string, content: string) => ({ path: p, content });
const has = (text: string): FileState => ({ kind: "file", text });
const absent: FileState = { kind: "absent" };

function plan(over: Partial<Omit<PlanInput, "current">> & { current: Record<string, FileState> }) {
  const { current, ...rest } = over;
  return planUpdate({
    files: [],
    recorded: {},
    removed: [],
    ...rest,
    current: new Map(Object.entries(current)),
  });
}

describe("#35 判定：管理するファイルごとの扱い", () => {
  it("#35 AC-1: 記録あり・今の指紋が記録と同じ（書き換えていない）・新しい中身と違う → replace", () => {
    const d = plan({
      files: [file("CLAUDE.md", "新\n")],
      recorded: { "CLAUDE.md": fingerprint("旧\n") },
      current: { "CLAUDE.md": has("旧\n") },
    });
    expect(d).toEqual([{ kind: "replace", path: "CLAUDE.md", file: file("CLAUDE.md", "新\n") }]);
  });

  it("#35 AC-1: 改行が CRLF でも、中身が同じなら書き換えていない（replace）", () => {
    const d = plan({
      files: [file("CLAUDE.md", "新\n")],
      recorded: { "CLAUDE.md": fingerprint("旧\n") },
      current: { "CLAUDE.md": has("旧\r\n") },
    });
    expect(d[0]?.kind).toBe("replace");
  });

  it("#35 今の中身が新しい中身と同じ → unchanged（書かない）", () => {
    const d = plan({
      files: [file("CLAUDE.md", "同じ\n")],
      recorded: { "CLAUDE.md": fingerprint("旧\n") },
      current: { "CLAUDE.md": has("同じ\r\n") },
    });
    expect(d[0]?.kind).toBe("unchanged");
  });

  it("#35 AC-2: 記録あり・今の指紋が記録と違う（利用者が書き換えた）→ conflict", () => {
    const d = plan({
      files: [file("CLAUDE.md", "新\n")],
      recorded: { "CLAUDE.md": fingerprint("旧\n") },
      current: { "CLAUDE.md": has("利用者の編集\n") },
    });
    expect(d).toEqual([
      {
        kind: "conflict",
        path: "CLAUDE.md",
        file: file("CLAUDE.md", "新\n"),
        current: "利用者の編集\n",
      },
    ]);
  });

  it("#35 AC-2: 記録なしで、新しい組にあり、同じパスに違う中身のファイルがある → conflict", () => {
    const d = plan({
      files: [file("docs/secrets.md", "新\n")],
      current: { "docs/secrets.md": has("利用者が先に作った\n") },
    });
    expect(d[0]?.kind).toBe("conflict");
  });

  it("#35 記録あり・ファイルが無い → missing", () => {
    const d = plan({
      files: [file("CLAUDE.md", "新\n")],
      recorded: { "CLAUDE.md": fingerprint("旧\n") },
      current: { "CLAUDE.md": absent },
    });
    expect(d[0]?.kind).toBe("missing");
  });

  it("#35 AC-3: 記録なし・新しい組にあり・ファイルが無い → added", () => {
    const d = plan({
      files: [file(".claude/skills/new/SKILL.md", "新\n")],
      current: { ".claude/skills/new/SKILL.md": absent },
    });
    expect(d[0]?.kind).toBe("added");
  });

  it("#35 AC-3: 記録あり・新しい組に無い → obsolete（ファイルは見ない）", () => {
    const d = plan({
      files: [],
      recorded: { ".claude/skills/old/SKILL.md": fingerprint("旧\n") },
      current: {},
    });
    expect(d).toEqual([{ kind: "obsolete", path: ".claude/skills/old/SKILL.md" }]);
  });

  it("#35 R1: 消したままにしたパス（removed）は、新しい組にあって無くても added にしない（removed_kept）", () => {
    const d = plan({
      files: [file("CLAUDE.md", "新\n")],
      removed: ["CLAUDE.md"],
      current: { "CLAUDE.md": absent },
    });
    expect(d).toEqual([{ kind: "removed_kept", path: "CLAUDE.md" }]);
  });

  it("#35 R1: 消したままのパスに、利用者がファイルを置いた（同じ中身）→ unchanged", () => {
    const d = plan({
      files: [file("CLAUDE.md", "新\n")],
      removed: ["CLAUDE.md"],
      current: { "CLAUDE.md": has("新\n") },
    });
    expect(d[0]?.kind).toBe("unchanged");
  });

  it("#35 判定は新しい組のパスの順（obsolete は最後）", () => {
    const d = plan({
      files: [file("a.md", "1\n"), file("b.md", "2\n")],
      recorded: { "z.md": fingerprint("旧\n") },
      current: { "a.md": absent, "b.md": absent },
    });
    expect(d.map((x) => x.path)).toEqual(["a.md", "b.md", "z.md"]);
  });
});
