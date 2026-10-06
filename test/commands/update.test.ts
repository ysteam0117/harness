// #35 harness update。一時フォルダに create の出力を作り、書き換え・削除などをして試す。
// 本物の gh・ネットワークは使わない（git は一時フォルダの中だけ）。実データ・個人名は使わない（架空の値だけ）。
// 想定する型：src/commands/update.ts（UpdateDeps・UpdateOptions・runUpdate）
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rename as realRename, readFile as realReadFile, rm as realRm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runUpdate } from "../../src/commands/update.js";
import { fingerprint } from "../../src/generate/config.js";
import { FakePrompter } from "../questions/helpers.js";
import { FIXED_DAY } from "../versions/helpers.js";
import {
  cleanupRoots,
  editConfig,
  exists,
  freshProject,
  newRoot,
  read,
  readConfig,
  simulateOldVersion,
  snapshot,
  unmanagedSnapshot,
  updateSetup,
  write,
} from "../update/helpers.js";

afterEach(() => {
  cleanupRoots();
  vi.restoreAllMocks();
});

/** 出力の Markdown から、「### 見出し」の節の本文を取り出す（なければ ""） */
function section(out: string, title: string): string {
  const lines = out.split("\n");
  const start = lines.findIndex((l) => l.startsWith("### ") && l.includes(title));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("#"));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

class HookPrompter extends FakePrompter {
  before?: (method: string, id: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async select(o: any): Promise<any> {
    this.before?.("select", o.id as string);
    return super.select(o);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async confirm(o: any): Promise<boolean> {
    this.before?.("confirm", o.id);
    return super.confirm(o);
  }
}

const NEW_REPLACED = "CLAUDE.md";
const CONFLICT = "docs/secrets.md";
const MISSING = "scripts/env-check.mjs";
const ADDED = ".github/pull_request_template.md";
const OBSOLETE = ".claude/skills/old-skill/SKILL.md";

interface Prepared {
  dir: string;
  /** 新しいハーネスが作る中身（更新の後に、こうなる） */
  newContent: Record<string, string>;
}

/** 5つの状態を1つのプロジェクトに作る：置き換え・書き換え済み・消した・新しく追加・不要になった */
async function prepared(over: Record<string, unknown> = {}): Promise<Prepared> {
  const dir = await freshProject(over);
  const newContent = {
    [NEW_REPLACED]: read(dir, NEW_REPLACED),
    [CONFLICT]: read(dir, CONFLICT),
    [MISSING]: read(dir, MISSING),
    [ADDED]: read(dir, ADDED),
  };
  simulateOldVersion(dir, NEW_REPLACED, "# 古いハーネスの CLAUDE.md\n");
  write(dir, CONFLICT, "# 利用者が書き換えた secrets\n");
  rmSync(path.join(dir, ...MISSING.split("/")));
  rmSync(path.join(dir, ...ADDED.split("/")));
  write(dir, OBSOLETE, "# 古い Skill\n");
  editConfig(dir, (doc) => {
    delete doc.managed_files[ADDED];
    doc.managed_files[OBSOLETE] = fingerprint("# 古い Skill\n");
  });
  // プロジェクトのもの（更新しない）
  write(dir, "docs/requirements.md", "# 利用者の要件\n");
  write(dir, "docs/project-rules.md", "# 利用者のルール\n");
  write(dir, "backend/src/app.ts", "// 利用者のコード\n");
  return { dir, newContent };
}

function git(dir: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=testuser_001",
      "-c",
      "user.email=testuser_001@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: dir, encoding: "utf8" },
  );
}

describe("#35 AC-1: 書き換えていない管理ファイルは、新しい内容で置き換わる", () => {
  it("#35 AC-1: --yes で置き換わる。config.yaml は update・更新日・新しい指紋になり、終了コード0。結果の一覧（Markdown）を出す", async () => {
    const { dir, newContent } = await prepared();
    const s = updateSetup(dir);
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(read(dir, NEW_REPLACED)).toBe(newContent[NEW_REPLACED]);
    const config = readConfig(dir);
    expect(config["mode"]).toBe("update");
    expect(config["updated_on"]).toBe(FIXED_DAY);
    expect(config["generated_on"]).toBe(FIXED_DAY);
    expect(config.managed_files[NEW_REPLACED]).toBe(
      fingerprint(newContent[NEW_REPLACED] as string),
    );
    expect(section(s.out(), "置き換え")).toContain(NEW_REPLACED);
    expect(s.out()).toContain("テストと品質チェックを実行し");
    expect(s.prompter.notes.join("\n")).toContain("更新の間は、ファイルを編集しないでください");
  });

  it("#35 AC-1: 改行が CRLF に変わっているだけで、中身は書き換えていないファイルも、置き換わる", async () => {
    const { dir, newContent } = await prepared();
    write(dir, NEW_REPLACED, "# 古いハーネスの CLAUDE.md\r\n");
    const s = updateSetup(dir);
    await runUpdate({ yes: true }, s.deps);
    expect(read(dir, NEW_REPLACED)).toBe(newContent[NEW_REPLACED]);
  });

  it("#35 何も変わらない（新しい組＝今のファイル）ときは、管理ファイルを1つも書かない。config.yaml だけが更新される", async () => {
    for (const over of [
      {},
      { repository: "local", check_location: "local", ais: ["claude", "codex"] },
      { database: "postgresql", postgres_provider: "neon" },
    ]) {
      const dir = await freshProject(over);
      const before = snapshot(dir);
      const s = updateSetup(dir);
      const out = await runUpdate({ yes: true }, s.deps);
      expect(out.exitCode, s.err()).toBe(0);
      const after = snapshot(dir);
      const changed = [...after.keys()].filter((k) => before.get(k) !== after.get(k));
      expect(changed, JSON.stringify(over)).toEqual([".harness/config.yaml"]);
      expect([...before.keys()].sort()).toEqual([...after.keys()].sort());
    }
  });
});

describe("#35 AC-2: 書き換えたファイルは置き換えず、差分を示して選ばせる", () => {
  it("#35 AC-2: --yes では、残す（バイト列が同じ）。新しい内容を <path>.harness-new に置き、記録の指紋は変えない", async () => {
    const { dir, newContent } = await prepared();
    const recorded = readConfig(dir).managed_files[CONFLICT];
    const s = updateSetup(dir);
    await runUpdate({ yes: true }, s.deps);
    expect(read(dir, CONFLICT)).toBe("# 利用者が書き換えた secrets\n");
    expect(read(dir, `${CONFLICT}.harness-new`)).toBe(newContent[CONFLICT]);
    expect(readConfig(dir).managed_files[CONFLICT]).toBe(recorded);
    expect(section(s.out(), "残した")).toContain(`${CONFLICT}.harness-new`);
  });

  it("#35 AC-2: 対話では、差分を見せて選ばせる。「置き換える」を選ぶと、置き換わり、指紋は新しい内容になる", async () => {
    const { dir, newContent } = await prepared();
    const s = updateSetup(
      dir,
      { [`update_conflict:${CONFLICT}`]: ["replace"], [`update_restore:${MISSING}`]: [false] },
      { interactive: true },
    );
    const out = await runUpdate({}, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(read(dir, CONFLICT)).toBe(newContent[CONFLICT]);
    expect(exists(dir, `${CONFLICT}.harness-new`)).toBe(false);
    expect(readConfig(dir).managed_files[CONFLICT]).toBe(
      fingerprint(newContent[CONFLICT] as string),
    );
    const shown = s.prompter.notes.join("\n");
    expect(shown).toContain("-# 利用者が書き換えた secrets");
    expect(s.prompter.askedIds).toContain(`update_conflict:${CONFLICT}`);
  });

  it("#35 AC-2: 「残す」を選ぶと、何も置かない（.harness-new もなし）。指紋は記録のまま", async () => {
    const { dir } = await prepared();
    const recorded = readConfig(dir).managed_files[CONFLICT];
    const s = updateSetup(
      dir,
      { [`update_conflict:${CONFLICT}`]: ["keep"], [`update_restore:${MISSING}`]: [false] },
      { interactive: true },
    );
    await runUpdate({}, s.deps);
    expect(read(dir, CONFLICT)).toBe("# 利用者が書き換えた secrets\n");
    expect(exists(dir, `${CONFLICT}.harness-new`)).toBe(false);
    expect(readConfig(dir).managed_files[CONFLICT]).toBe(recorded);
  });

  it("#35 AC-2: 「新しい内容を .harness-new に置く」を選ぶと、置く", async () => {
    const { dir, newContent } = await prepared();
    const s = updateSetup(
      dir,
      { [`update_conflict:${CONFLICT}`]: ["new"], [`update_restore:${MISSING}`]: [false] },
      { interactive: true },
    );
    await runUpdate({}, s.deps);
    expect(read(dir, `${CONFLICT}.harness-new`)).toBe(newContent[CONFLICT]);
    expect(read(dir, CONFLICT)).toBe("# 利用者が書き換えた secrets\n");
  });

  it("#35 AC-2: 残したファイルは、次の更新でも書き換え済みと判定される（また残す）", async () => {
    const { dir } = await prepared();
    await runUpdate({ yes: true }, updateSetup(dir).deps);
    const s2 = updateSetup(dir);
    await runUpdate({ yes: true }, s2.deps);
    expect(read(dir, CONFLICT)).toBe("# 利用者が書き換えた secrets\n");
    expect(section(s2.out(), "残した")).toContain(CONFLICT);
  });

  it("#35 AC-2: 記録がなく（記録から外れ）、同じパスに違う中身のファイルがある場合も、同じく残して .harness-new を置く", async () => {
    const { dir, newContent } = await prepared();
    editConfig(dir, (doc) => {
      delete doc.managed_files[CONFLICT];
    });
    await runUpdate({ yes: true }, updateSetup(dir).deps);
    expect(read(dir, CONFLICT)).toBe("# 利用者が書き換えた secrets\n");
    expect(read(dir, `${CONFLICT}.harness-new`)).toBe(newContent[CONFLICT]);
  });

  it("#35 R2: <path>.harness-new が既にあれば上書きせず、.harness-new.2 に置く（利用者が編集した .harness-new は変わらない）", async () => {
    const { dir, newContent } = await prepared();
    write(dir, `${CONFLICT}.harness-new`, "利用者が編集した .harness-new\n");
    await runUpdate({ yes: true }, updateSetup(dir).deps);
    expect(read(dir, `${CONFLICT}.harness-new`)).toBe("利用者が編集した .harness-new\n");
    expect(read(dir, `${CONFLICT}.harness-new.2`)).toBe(newContent[CONFLICT]);
    write(dir, `${CONFLICT}.harness-new.2`, "これも編集\n");
    await runUpdate({ yes: true }, updateSetup(dir).deps);
    expect(read(dir, `${CONFLICT}.harness-new.2`)).toBe("これも編集\n");
    expect(read(dir, `${CONFLICT}.harness-new.3`)).toBe(newContent[CONFLICT]);
  });
});

describe("#35 AC-3: 追加したファイルと、不要になったファイル", () => {
  it("#35 AC-3: 新しく追加されたファイルは追加し、指紋を記録する", async () => {
    const { dir, newContent } = await prepared();
    const s = updateSetup(dir);
    await runUpdate({ yes: true }, s.deps);
    expect(read(dir, ADDED)).toBe(newContent[ADDED]);
    expect(readConfig(dir).managed_files[ADDED]).toBe(fingerprint(newContent[ADDED] as string));
    expect(section(s.out(), "追加")).toContain(ADDED);
  });

  it("#35 AC-3: 不要になったファイルは削除せず（バイト列も同じ）、一覧で知らせ、記録から外す", async () => {
    const { dir } = await prepared();
    const s = updateSetup(dir);
    await runUpdate({ yes: true }, s.deps);
    expect(read(dir, OBSOLETE)).toBe("# 古い Skill\n");
    expect(readConfig(dir).managed_files).not.toHaveProperty(OBSOLETE);
    expect(section(s.out(), "不要")).toContain(OBSOLETE);
    expect(section(s.out(), "不要")).toContain("削除していません");
  });
});

describe("#35 R1: 消した管理ファイルの扱い", () => {
  it("#35 --yes では、消したままにする。removed_files に入り、2回続けて更新しても復元されない", async () => {
    const { dir } = await prepared();
    const s1 = updateSetup(dir);
    await runUpdate({ yes: true }, s1.deps);
    expect(exists(dir, MISSING)).toBe(false);
    expect(readConfig(dir).removed_files).toEqual([MISSING]);
    expect(readConfig(dir).managed_files).not.toHaveProperty(MISSING);
    expect(section(s1.out(), "消したまま")).toContain(MISSING);
    const s2 = updateSetup(dir);
    const out = await runUpdate({ yes: true }, s2.deps);
    expect(out.exitCode).toBe(0);
    expect(exists(dir, MISSING)).toBe(false);
    expect(readConfig(dir).removed_files).toEqual([MISSING]);
    expect(section(s2.out(), "消したまま")).toContain(MISSING);
  });

  it("#35 対話で「復元する」を選ぶと戻り、removed_files から外れ、指紋が記録される", async () => {
    const { dir, newContent } = await prepared();
    await runUpdate({ yes: true }, updateSetup(dir).deps);
    // 書き換え済みの CONFLICT は、また選ぶ
    const again = updateSetup(
      dir,
      {
        [`update_restore:${MISSING}`]: [true],
        [`update_conflict:${CONFLICT}`]: ["keep"],
      },
      { interactive: true },
    );
    const out = await runUpdate({}, again.deps);
    expect(out.exitCode, again.err()).toBe(0);
    expect(read(dir, MISSING)).toBe(newContent[MISSING]);
    expect(readConfig(dir)).not.toHaveProperty("removed_files");
    expect(readConfig(dir).managed_files[MISSING]).toBe(fingerprint(newContent[MISSING] as string));
  });

  it("#35 対話で、消したファイルを「消したまま」にすると、復元しない", async () => {
    const { dir } = await prepared();
    const s = updateSetup(
      dir,
      { [`update_restore:${MISSING}`]: [false], [`update_conflict:${CONFLICT}`]: ["keep"] },
      { interactive: true },
    );
    await runUpdate({}, s.deps);
    expect(exists(dir, MISSING)).toBe(false);
    expect(readConfig(dir).removed_files).toEqual([MISSING]);
  });
});

describe("#35 AC-4: プロジェクトのものは変更しない", () => {
  it("#35 AC-4: 管理しないファイルのバイト列が、更新の前後で同じ（--yes・対話・--dry-run）", async () => {
    for (const mode of ["yes", "interactive", "dry"] as const) {
      const { dir } = await prepared();
      const before = unmanagedSnapshot(dir);
      expect(before.size).toBeGreaterThan(10);
      const s =
        mode === "interactive"
          ? updateSetup(
              dir,
              {
                [`update_conflict:${CONFLICT}`]: ["replace"],
                [`update_restore:${MISSING}`]: [true],
              },
              { interactive: true },
            )
          : updateSetup(dir);
      const out = await runUpdate(
        mode === "interactive" ? {} : mode === "yes" ? { yes: true } : { dryRun: true, yes: true },
        s.deps,
      );
      expect(out.exitCode, `${mode}: ${s.err()}`).toBe(0);
      const after = unmanagedSnapshot(dir);
      // 管理しないファイルは、増えも減りも変わりもしない（.harness-new・追加・不要の記録は管理するファイルの側）
      const onlyBefore = [...before.keys()].filter((k) => !after.has(k));
      expect(onlyBefore, mode).toEqual([]);
      for (const [k, v] of before) expect(after.get(k), `${mode}: ${k}`).toBe(v);
      const added = [...after.keys()].filter((k) => !before.has(k));
      expect(
        added.every((k) => k.endsWith(".harness-new")),
        `${mode}: ${added.join(",")}`,
      ).toBe(true);
    }
  });

  it("#35 AC-4: 管理しないファイルが config.yaml の managed_files に書かれていても、触らない（無視して知らせる）", async () => {
    const dir = await freshProject();
    const pkgBefore = read(dir, "package.json");
    editConfig(dir, (doc) => {
      doc.managed_files["package.json"] = fingerprint(pkgBefore);
    });
    const s = updateSetup(dir);
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(read(dir, "package.json")).toBe(pkgBefore);
    expect(readConfig(dir).managed_files).not.toHaveProperty("package.json");
    expect(s.out()).toContain("package.json");
  });

  it("#35 AC-4: package.json の scripts が新しいハーネスと違えば、書かずに「設定の変化」として知らせる", async () => {
    const dir = await freshProject();
    const pkg = JSON.parse(read(dir, "package.json")) as { scripts: Record<string, string> };
    const [name] = Object.keys(pkg.scripts);
    delete pkg.scripts[name as string];
    const edited = `${JSON.stringify(pkg, null, 2)}\n`;
    write(dir, "package.json", edited);
    const s = updateSetup(dir);
    await runUpdate({ yes: true }, s.deps);
    expect(read(dir, "package.json")).toBe(edited);
    expect(section(s.out(), "設定の変化")).toContain(`scripts.${name as string}`);
  });
});

describe("#35 --dry-run", () => {
  it("#35 判定の一覧だけを表示し、何も書かない（config.yaml・ロックも含め、全ファイルが同じ）", async () => {
    const { dir } = await prepared();
    const before = snapshot(dir);
    const listing = readdirSync(path.join(dir, ".harness"));
    const s = updateSetup(dir);
    const out = await runUpdate({ dryRun: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(snapshot(dir)).toEqual(before);
    expect(readdirSync(path.join(dir, ".harness"))).toEqual(listing);
    expect(s.out()).toContain("--dry-run");
    expect(section(s.out(), "置き換え")).toContain(NEW_REPLACED);
    expect(section(s.out(), "残した")).toContain(CONFLICT);
    expect(section(s.out(), "追加")).toContain(ADDED);
    expect(section(s.out(), "不要")).toContain(OBSOLETE);
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#35 --dry-run は、未コミットの変更があっても止まらない（何も書かないため）", async () => {
    const { dir } = await prepared();
    const s = updateSetup(
      dir,
      {},
      {
        runGit: async (args) =>
          args[0] === "rev-parse"
            ? { code: 0, stdout: "true\n", stderr: "" }
            : { code: 0, stdout: " M CLAUDE.md\n", stderr: "" },
      },
    );
    const out = await runUpdate({ dryRun: true }, s.deps);
    expect(out.exitCode).toBe(0);
  });
});

describe("#35 増えた質問・新しい版・新しい警告", () => {
  it("#35 古い config から回答を1つ抜くと、その質問だけ聞かれる（対話）。回答は config に入る", async () => {
    const dir = await freshProject();
    editConfig(dir, (doc) => {
      delete doc.answers["check_location"];
    });
    const s = updateSetup(dir, { check_location: ["local"] }, { interactive: true });
    const out = await runUpdate({}, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(s.prompter.askedIds).toEqual(["check_location"]);
    expect(readConfig(dir).answers["check_location"]).toBe("local");
    expect(section(s.out(), "増えた質問")).toContain("check_location");
  });

  it("#35 --yes で、既定の値がない質問が増えていたら、何も書かずに止まって案内する", async () => {
    const dir = await freshProject();
    editConfig(dir, (doc) => {
      delete doc.answers["check_location"];
    });
    const before = snapshot(dir);
    const s = updateSetup(dir);
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("check_location");
    expect(s.err()).toContain("既定の値がない質問");
    expect(snapshot(dir)).toEqual(before);
  });

  it("#35 既定の値のある質問（未定）が増えていたら、--yes でも既定で進み、増えた質問に出る", async () => {
    const dir = await freshProject();
    editConfig(dir, (doc) => {
      delete doc.answers["admin"];
    });
    const s = updateSetup(dir);
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(readConfig(dir).answers["admin"]).toBe("undecided");
    expect(section(s.out(), "増えた質問")).toContain("admin");
  });

  it("#35 新しい版が必要な依存（記録にない版）は、検証済みの版を使い、ネットワークを使わない。理由を記録する", async () => {
    const dir = await freshProject();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const config = readConfig(dir);
    const dropped = config.versions[config.versions.length - 1] as {
      name: string;
      version: string;
    };
    editConfig(dir, (doc) => {
      doc.versions = doc.versions.filter((v) => v.name !== dropped.name);
    });
    const s = updateSetup(dir);
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    const entry = readConfig(dir).versions.find((v) => v.name === dropped.name);
    expect(entry?.reason).toBe("更新で追加（検証済みの版）");
    expect(entry?.version).toBe(dropped.version);
  });

  it("#35 記録された版は、そのまま使う（変えない）", async () => {
    const dir = await freshProject();
    const before = readConfig(dir).versions;
    await runUpdate({ yes: true }, updateSetup(dir).deps);
    expect(readConfig(dir).versions).toEqual(before);
  });

  describe("新しい警告", () => {
    async function warned() {
      // 公開リポジトリで品質チェックがローカルだけ → 警告 public-needs-ci
      const over = { visibility: "public", check_location: "local" };
      const dir = await freshProject(over, ["public-needs-ci"]);
      return dir;
    }

    it("#35 記録した警告は、また承知を求めない（新しい警告ではない）", async () => {
      const dir = await warned();
      const s = updateSetup(dir);
      const out = await runUpdate({ yes: true }, s.deps);
      expect(out.exitCode, s.err()).toBe(0);
    });

    it("#35 --yes で、記録にない新しい警告が出たら、何も書かずに止まる", async () => {
      const dir = await warned();
      editConfig(dir, (doc) => {
        doc.accepted_warnings = [];
      });
      const before = snapshot(dir);
      const s = updateSetup(dir);
      const out = await runUpdate({ yes: true }, s.deps);
      expect(out.exitCode).toBe(1);
      expect(s.err()).toContain("public-needs-ci");
      expect(s.err()).toContain("承知していない警告");
      expect(snapshot(dir)).toEqual(before);
    });

    it("#35 対話で承知すると、docs/adr/ に新しい ADR を足し（既存の ADR は変えない）、accepted_warnings に記録する", async () => {
      const dir = await warned();
      const adrBefore = read(dir, "docs/adr/0001-accepted-warnings.md");
      editConfig(dir, (doc) => {
        doc.accepted_warnings = [];
      });
      const s = updateSetup(
        dir,
        { "accept_warning:public-needs-ci": [true] },
        { interactive: true },
      );
      const out = await runUpdate({}, s.deps);
      expect(out.exitCode, s.err()).toBe(0);
      expect(read(dir, "docs/adr/0001-accepted-warnings.md")).toBe(adrBefore);
      const adrs = readdirSync(path.join(dir, "docs", "adr")).filter((n) => /^\d{4}-/.test(n));
      const added = adrs.filter(
        (n) => n !== "0001-accepted-warnings.md" && n !== "0000-template.md",
      );
      expect(added).toHaveLength(1);
      expect(added[0]).toMatch(/^0002-/);
      expect(read(dir, `docs/adr/${added[0] as string}`)).toContain("public-needs-ci");
      expect(readConfig(dir).accepted_warnings.map((w) => w.id)).toEqual(["public-needs-ci"]);
      expect(section(s.out(), "ADR")).toContain(added[0] as string);
    });

    it("#35 対話で承知しなければ、何も書かず、終了コード0", async () => {
      const dir = await warned();
      editConfig(dir, (doc) => {
        doc.accepted_warnings = [];
      });
      const before = snapshot(dir);
      const s = updateSetup(
        dir,
        { "accept_warning:public-needs-ci": [false] },
        { interactive: true },
      );
      const out = await runUpdate({}, s.deps);
      expect(out.exitCode).toBe(0);
      expect(snapshot(dir)).toEqual(before);
    });

    it("#35 --dry-run では、新しい警告があっても止まらず、一覧に出す（何も書かない）", async () => {
      const dir = await warned();
      editConfig(dir, (doc) => {
        doc.accepted_warnings = [];
      });
      const before = snapshot(dir);
      const s = updateSetup(dir);
      const out = await runUpdate({ dryRun: true }, s.deps);
      expect(out.exitCode, s.err()).toBe(0);
      expect(s.out()).toContain("public-needs-ci");
      expect(snapshot(dir)).toEqual(before);
    });
  });

  it("#35 整合性チェックのエラー（回答が成り立たない）なら、何も書かずに止まる", async () => {
    const dir = await freshProject();
    editConfig(dir, (doc) => {
      doc.answers["database"] = "none";
      delete doc.answers["data_access"];
      doc.answers["auth"] = "app";
      delete doc.answers["idp"];
    });
    const before = snapshot(dir);
    const s = updateSetup(dir);
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("整合性チェック");
    expect(snapshot(dir)).toEqual(before);
  });
});

describe("#35 R4: 実行権限（Git のフック）", () => {
  it.skipIf(process.platform === "win32")(
    "#35 R4: .githooks/pre-commit を、置き換え・追加・復元した後に、実行権限がある",
    async () => {
      const over = { repository: "local", check_location: "local" };
      const hook = ".githooks/pre-commit";
      // 置き換え
      let dir = await freshProject(over);
      const content = read(dir, hook);
      simulateOldVersion(dir, hook, "#!/bin/sh\n# 古い版\n");
      await runUpdate({ yes: true }, updateSetup(dir).deps);
      expect(read(dir, hook)).toBe(content);
      expect(statSync(path.join(dir, hook)).mode & 0o111).toBe(0o111);
      // 追加
      dir = await freshProject(over);
      rmSync(path.join(dir, hook));
      editConfig(dir, (doc) => {
        delete doc.managed_files[hook];
      });
      await runUpdate({ yes: true }, updateSetup(dir).deps);
      expect(statSync(path.join(dir, hook)).mode & 0o111).toBe(0o111);
      // 復元（対話）
      dir = await freshProject(over);
      rmSync(path.join(dir, hook));
      await runUpdate(
        {},
        updateSetup(dir, { [`update_restore:${hook}`]: [true] }, { interactive: true }).deps,
      );
      expect(read(dir, hook)).toBe(content);
      expect(statSync(path.join(dir, hook)).mode & 0o111).toBe(0o111);
    },
  );
});

describe("#35 安全：止まる条件", () => {
  it("#35 config.yaml が無いフォルダでは、エラー（harness create のフォルダで実行する案内）。何も書かない", async () => {
    const root = newRoot();
    const s = updateSetup(root);
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain(".harness/config.yaml");
    expect(readdirSync(root)).toEqual([]);
  });

  it("#35 --dir で、別のフォルダのプロジェクトを指定できる", async () => {
    const dir = await freshProject();
    const s = updateSetup(dir, {}, { cwd: path.dirname(dir) });
    const out = await runUpdate({ yes: true, dir: path.basename(dir) }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(readConfig(dir)["mode"]).toBe("update");
  });

  it("#35 壊れた config.yaml はエラー（何も書かない）", async () => {
    const dir = await freshProject();
    write(dir, ".harness/config.yaml", "harness_version: [\n");
    const before = snapshot(dir);
    const s = updateSetup(dir);
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("config.yaml");
    expect(snapshot(dir)).toEqual(before);
  });

  it("#35 安全: managed_files に ../ を含むパスがあれば、エラー。生成先の外にも中にも書かない", async () => {
    const dir = await freshProject();
    editConfig(dir, (doc) => {
      doc.managed_files["../outside.md"] = "a".repeat(64);
    });
    const before = snapshot(dir);
    const s = updateSetup(dir);
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(existsSync(path.join(path.dirname(dir), "outside.md"))).toBe(false);
    expect(snapshot(dir)).toEqual(before);
  });

  it("#35 安全: 管理するファイルの途中のフォルダがリンク（ジャンクション）なら、拒む。リンクの先は変わらない", async () => {
    const { dir } = await prepared();
    const outside = newRoot();
    const linkedDir = path.join(dir, ".github", "ISSUE_TEMPLATE");
    cpSync(linkedDir, path.join(outside, "ISSUE_TEMPLATE"), { recursive: true });
    rmSync(linkedDir, { recursive: true });
    symlinkSync(path.join(outside, "ISSUE_TEMPLATE"), linkedDir, "junction");
    const outsideBefore = snapshot(outside);
    const s = updateSetup(dir);
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("リンク");
    expect(snapshot(outside)).toEqual(outsideBefore);
    expect(read(dir, CONFLICT)).toBe("# 利用者が書き換えた secrets\n");
  });

  it("#35 ダウングレード（記録された版が、実行中のハーネスより新しい）なら止まる", async () => {
    const dir = await freshProject();
    editConfig(dir, (doc) => {
      doc["harness_version"] = "9.9.9";
    });
    const before = snapshot(dir);
    const s = updateSetup(dir, {}, { harnessVersion: () => "1.0.0" });
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("ダウングレード");
    expect(s.err()).toContain("9.9.9");
    expect(snapshot(dir)).toEqual(before);
  });

  it("#35 端末でなく --yes もないときは、確認できないので止まる（何も書かない）", async () => {
    const dir = await freshProject();
    const before = snapshot(dir);
    const s = updateSetup(dir);
    const out = await runUpdate({}, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("--yes");
    expect(snapshot(dir)).toEqual(before);
  });

  it("#35 未コミットの変更があれば止まる。--allow-dirty で続けられる", async () => {
    const dir = await freshProject();
    const dirtyGit = async (args: string[]) =>
      args[0] === "rev-parse"
        ? { code: 0, stdout: "true\n", stderr: "" }
        : { code: 0, stdout: " M README.md\n", stderr: "" };
    const before = snapshot(dir);
    const s = updateSetup(dir, {}, { runGit: dirtyGit });
    const stopped = await runUpdate({ yes: true }, s.deps);
    expect(stopped.exitCode).toBe(1);
    expect(s.err()).toContain("未コミットの変更");
    expect(s.err()).toContain("--allow-dirty");
    expect(snapshot(dir)).toEqual(before);
    const s2 = updateSetup(dir, {}, { runGit: dirtyGit });
    const ok = await runUpdate({ yes: true, allowDirty: true }, s2.deps);
    expect(ok.exitCode, s2.err()).toBe(0);
  });

  it("#35 Git のフォルダでなければ、警告だけで続ける", async () => {
    const dir = await freshProject();
    const s = updateSetup(
      dir,
      {},
      { runGit: async () => ({ code: 128, stdout: "", stderr: "not a git repository" }) },
    );
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode, s.err()).toBe(0);
    expect(s.prompter.notes.join("\n") + s.err()).toContain("Git");
  });

  it(
    "#35 本物の git：一時フォルダの中の、変更のないリポジトリでは進み、変更を加えると止まる",
    { retry: 2 },
    async () => {
      const dir = await freshProject();
      git(dir, "init", "-q");
      git(dir, "config", "core.autocrlf", "false");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "初回（テスト）");
      const ok = updateSetup(dir, {}, { runGit: undefined });
      const out = await runUpdate({ yes: true, dryRun: false }, ok.deps);
      expect(out.exitCode, ok.err()).toBe(0);
      // config.yaml が更新されて、未コミットの変更になる → 次の更新は止まる
      const stopped = updateSetup(dir, {}, { runGit: undefined });
      const out2 = await runUpdate({ yes: true }, stopped.deps);
      expect(out2.exitCode).toBe(1);
      expect(stopped.err()).toContain("未コミットの変更");
    },
  );

  it("#35 R5: ロックがあれば（別の更新が実行中・途中で止まった）、止まる。ロックは消さず、何も書かない", async () => {
    const dir = await freshProject();
    write(dir, ".harness/.update-lock", "前回の更新\n");
    const before = snapshot(dir);
    const s = updateSetup(dir);
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("別の更新が実行中か");
    expect(s.err()).toContain(".update-lock");
    expect(snapshot(dir)).toEqual(before);
  });

  it("#35 R5: 成功・失敗・止まった後に、ロックが残らない", async () => {
    // 成功
    const dir = await freshProject();
    await runUpdate({ yes: true }, updateSetup(dir).deps);
    expect(readdirSync(path.join(dir, ".harness"))).toEqual(["config.yaml"]);
    // 失敗（rename で失敗）
    const p = await prepared();
    const s = updateSetup(
      p.dir,
      {},
      {
        fs: {
          rename: async () => {
            throw new Error("失敗（テスト）");
          },
        },
      },
    );
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(readdirSync(path.join(p.dir, ".harness"))).toEqual(["config.yaml"]);
    // 警告を承知しなかった・確認で止まった
    const q = await freshProject();
    editConfig(q, (doc) => {
      doc.answers["admin"] = "undecided";
    });
    await runUpdate({}, updateSetup(q).deps);
    expect(readdirSync(path.join(q, ".harness"))).toEqual(["config.yaml"]);
  });
});

describe("#35 R5・R7: 判定の後にファイルが変わったら、何も書かずに止まる", () => {
  it.each(["edit", "delete", "create-removed", "create-missing"] as const)(
    "別のファイルの対話中に %s が起きると、何も書かず利用者の状態を残す",
    async (change) => {
      const { dir } = await prepared();
      const unchanged = "AGENTS.md";
      if (change === "create-removed") {
        editConfig(dir, (doc) => {
          doc.removed_files = [MISSING];
          delete doc.managed_files[MISSING];
        });
      }
      // 生のハッシュで確かめるため、編集は改行だけを変える。
      const original = read(dir, unchanged);
      const prompter = new HookPrompter({
        [`update_conflict:${CONFLICT}`]: ["keep"],
        [`update_restore:${MISSING}`]: [false],
      });
      let expected: ReturnType<typeof snapshot> | undefined;
      prompter.before = (_m, id) => {
        if (id !== `update_conflict:${CONFLICT}`) return;
        if (change === "edit") write(dir, unchanged, original.replace(/\r?\n/g, "\r\n"));
        else if (change === "delete") rmSync(path.join(dir, unchanged));
        else write(dir, MISSING, "利用者が作ったファイル\n");
        expected = snapshot(dir);
        expected.delete(".harness/.update-lock");
      };
      const s = updateSetup(dir, {}, { interactive: true }, prompter);
      const out = await runUpdate({}, s.deps);
      expect(expected).toBeDefined();
      expect(out.exitCode).toBe(1);
      expect(s.err()).toContain("判定の後にファイルが変わりました");
      expect(s.err()).toContain("何も書き換えていません");
      expect(snapshot(dir)).toEqual(expected);
      expect(s.out()).toBe("");
    },
  );

  it("#35 R5: 対話の途中（判定の後）に、置き換える対象を書き換えると、止まる。利用者の編集が残る", async () => {
    const { dir } = await prepared();
    const prompter = new HookPrompter({
      [`update_conflict:${CONFLICT}`]: ["keep"],
      [`update_restore:${MISSING}`]: [false],
    });
    prompter.before = (_m, id) => {
      if (id === `update_restore:${MISSING}` || id === `update_conflict:${CONFLICT}`) {
        write(dir, NEW_REPLACED, "# 判定の後の編集\n");
      }
    };
    const before = snapshot(dir);
    const s = updateSetup(dir, {}, { interactive: true }, prompter);
    const out = await runUpdate({}, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("判定の後にファイルが変わりました");
    expect(read(dir, NEW_REPLACED)).toBe("# 判定の後の編集\n");
    const after = snapshot(dir);
    for (const [k, v] of before) if (k !== NEW_REPLACED) expect(after.get(k), k).toBe(v);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  });

  it("#35 R5: 判定の後に、.harness-new の置き場所にファイルができていたら、止まる（上書きしない）", async () => {
    const { dir } = await prepared();
    const prompter = new HookPrompter({
      [`update_conflict:${CONFLICT}`]: ["new"],
      [`update_restore:${MISSING}`]: [false],
    });
    prompter.before = (_m, id) => {
      if (id === `update_conflict:${CONFLICT}`) return;
      write(dir, `${CONFLICT}.harness-new`, "後からできたファイル\n");
    };
    const s = updateSetup(dir, {}, { interactive: true }, prompter);
    const out = await runUpdate({}, s.deps);
    expect(out.exitCode).toBe(1);
    expect(read(dir, `${CONFLICT}.harness-new`)).toBe("後からできたファイル\n");
    expect(read(dir, NEW_REPLACED)).toBe("# 古いハーネスの CLAUDE.md\n");
  });

  it("#35 R5: 判定の後に、追加する場所にファイルができていたら、止まる", async () => {
    const { dir } = await prepared();
    const prompter = new HookPrompter({
      [`update_conflict:${CONFLICT}`]: ["keep"],
      [`update_restore:${MISSING}`]: [false],
    });
    prompter.before = (_m, id) => {
      if (id === `update_restore:${MISSING}`) write(dir, ADDED, "利用者が先に作った\n");
    };
    const s = updateSetup(dir, {}, { interactive: true }, prompter);
    const out = await runUpdate({}, s.deps);
    expect(out.exitCode).toBe(1);
    expect(read(dir, ADDED)).toBe("利用者が先に作った\n");
  });

  it("#35 R7: 判定の後に、改行だけ（LF→CRLF）を変えても止まり、変えた中身が残る", async () => {
    const { dir } = await prepared();
    const target = path.join(dir, ...NEW_REPLACED.split("/"));
    let changed = false;
    const s = updateSetup(
      dir,
      {},
      {
        fs: {
          readFile: async (file) => {
            const buf = await realReadFile(file);
            if (!changed && path.resolve(file) === path.resolve(target)) {
              changed = true;
              writeFileSync(target, "# 古いハーネスの CLAUDE.md\r\n");
            }
            return buf;
          },
        },
      },
    );
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("判定の後にファイルが変わりました");
    expect(readFileSync(target, "utf8")).toBe("# 古いハーネスの CLAUDE.md\r\n");
  });
});

describe("#35 原子性（コマンド全体）", () => {
  it("#35 どの rename で失敗させても、どのファイルも元のバイト列。config.yaml も同じ。一時的な場所・退避・ロックが残らない。終了コード1", async () => {
    const { dir: template } = await prepared();
    let total = 0;
    {
      const probe = path.join(newRoot(), "p");
      cpSync(template, probe, { recursive: true });
      const s = updateSetup(
        probe,
        {},
        {
          fs: {
            rename: async (from, to) => {
              total += 1;
              await realRename(from, to);
            },
          },
        },
      );
      expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
    }
    expect(total).toBeGreaterThanOrEqual(6);
    for (let n = 1; n <= total; n += 1) {
      const dir = path.join(newRoot(), "p");
      cpSync(template, dir, { recursive: true });
      const before = snapshot(dir);
      let calls = 0;
      const s = updateSetup(
        dir,
        {},
        {
          fs: {
            rename: async (from, to) => {
              if ((calls += 1) === n) throw new Error("rename の失敗（テスト）");
              await realRename(from, to);
            },
          },
        },
      );
      const out = await runUpdate({ yes: true }, s.deps);
      expect(out.exitCode, `rename ${String(n)} 回目`).toBe(1);
      expect(snapshot(dir), `rename ${String(n)} 回目`).toEqual(before);
      expect(readdirSync(path.join(dir, ".harness")), `rename ${String(n)} 回目`).toEqual([
        "config.yaml",
      ]);
      expect(s.err()).toContain("元に戻しました");
    }
  });

  it("#35 R3: 復元も失敗したときは、退避を残し、「元に戻せなかったファイル」と退避の場所を表示して、終了コード1", async () => {
    const { dir } = await prepared();
    let calls = 0;
    const s = updateSetup(
      dir,
      {},
      {
        fs: {
          rename: async (from, to) => {
            calls += 1;
            if (from.includes(".update-backup-") || calls === 4) {
              throw new Error("rename の失敗（テスト）");
            }
            await realRename(from, to);
          },
        },
      },
    );
    const out = await runUpdate({ yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("元に戻せなかったファイル");
    const backups = readdirSync(path.join(dir, ".harness")).filter((n) =>
      n.startsWith(".update-backup-"),
    );
    expect(backups).toHaveLength(1);
    expect(s.err()).toContain(backups[0] as string);
    const kept = path.join(dir, ".harness", backups[0] as string);
    expect(readdirSync(kept).length).toBeGreaterThan(0);
    // 元の内容は、退避のどこかにある（この更新の置き換えの対象の元の中身）
    const found: string[] = [];
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const full = path.join(d, name);
        if (statSync(full).isDirectory()) walk(full);
        else found.push(readFileSync(full, "utf8"));
      }
    };
    walk(kept);
    expect(found.some((t) => t === "# 古いハーネスの CLAUDE.md\n")).toBe(true);
    // ロックは残らない
    expect(existsSync(path.join(dir, ".harness", ".update-lock"))).toBe(false);
  });
});

describe("#35 中断と削除記録", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "最後の rename の直後の %s は全ファイルを元のバイト列に戻す",
    async (signal) => {
      const { dir } = await prepared();
      const before = snapshot(dir);
      let interrupted = false;
      const s = updateSetup(
        dir,
        {},
        {
          fs: {
            rename: async (from, to) => {
              await realRename(from, to);
              if (
                from.includes(".update-tmp-") &&
                to === path.join(dir, ".harness", "config.yaml")
              ) {
                interrupted = true;
                process.emit(signal);
              }
            },
          },
        },
      );
      expect((await runUpdate({ yes: true }, s.deps)).exitCode).toBe(130);
      expect(interrupted).toBe(true);
      expect(snapshot(dir)).toEqual(before);
      expect(s.err()).toContain("更新を止めて元に戻しました");
      expect(s.err()).not.toContain("ファイルは変更していません");
      expect(s.out()).toBe("");
    },
  );

  it.each(["SIGINT", "SIGTERM"] as const)(
    "退避を消した直後の %s は更新完了として扱う",
    async (signal) => {
      const { dir, newContent } = await prepared();
      let interrupted = false;
      const s = updateSetup(
        dir,
        {},
        {
          fs: {
            rm: async (file, options) => {
              await realRm(file, options);
              if (file.includes(".update-backup-")) {
                interrupted = true;
                process.emit(signal);
              }
            },
          },
        },
      );
      expect((await runUpdate({ yes: true }, s.deps)).exitCode, s.err()).toBe(0);
      expect(interrupted).toBe(true);
      expect(read(dir, NEW_REPLACED)).toBe(newContent[NEW_REPLACED]);
      expect(readConfig(dir).updated_on).toBe(FIXED_DAY);
      expect(readdirSync(path.join(dir, ".harness"))).toEqual(["config.yaml"]);
      expect(s.err()).toContain("更新は完了しました");
      expect(s.err()).not.toContain("ファイルは変更していません");
      expect(s.out()).toContain(NEW_REPLACED);
    },
  );

  it.each(["SIGINT", "SIGTERM"] as const)(
    "適用中の %s は元に戻してロックを消す",
    async (signal) => {
      const { dir } = await prepared();
      const before = snapshot(dir);
      const listeners = [process.listeners("SIGINT"), process.listeners("SIGTERM")];
      let interrupted = false;
      const s = updateSetup(
        dir,
        {},
        {
          fs: {
            rename: async (from, to) => {
              await realRename(from, to);
              if (!interrupted) {
                interrupted = true;
                process.emit(signal);
              }
            },
          },
        },
      );
      expect((await runUpdate({ yes: true }, s.deps)).exitCode).toBe(130);
      expect(snapshot(dir)).toEqual(before);
      expect(process.listeners("SIGINT")).toEqual(listeners[0]);
      expect(process.listeners("SIGTERM")).toEqual(listeners[1]);
    },
  );

  it.each(["SIGINT", "SIGTERM"] as const)(
    "質問待ちの %s はロックを消して130を返す",
    async (signal) => {
      const { dir } = await prepared();
      const before = snapshot(dir);
      const listeners = [process.listeners("SIGINT"), process.listeners("SIGTERM")];
      const prompter = new HookPrompter();
      prompter.select = async () => {
        expect(exists(dir, ".harness/.update-lock")).toBe(true);
        process.emit(signal);
        return new Promise<never>(() => undefined);
      };
      const out = await runUpdate({}, updateSetup(dir, {}, { interactive: true }, prompter).deps);
      expect(out.exitCode).toBe(130);
      expect(snapshot(dir)).toEqual(before);
      expect(exists(dir, ".harness/.update-lock")).toBe(false);
      expect(process.listeners("SIGINT")).toEqual(listeners[0]);
      expect(process.listeners("SIGTERM")).toEqual(listeners[1]);
    },
  );

  it("新しい組から外れた削除記録は、戻った後も --yes で復元しない", async () => {
    const dir = await freshProject();
    rmSync(path.join(dir, NEW_REPLACED));
    editConfig(dir, (doc) => {
      doc.removed_files = [NEW_REPLACED];
      delete doc.managed_files[NEW_REPLACED];
      doc.answers["ais"] = ["codex"];
    });
    const first = updateSetup(dir);
    expect((await runUpdate({ yes: true }, first.deps)).exitCode, first.err()).toBe(0);
    expect(readConfig(dir).removed_files).toContain(NEW_REPLACED);
    expect(exists(dir, NEW_REPLACED)).toBe(false);
    editConfig(dir, (doc) => {
      doc.answers["ais"] = ["claude"];
    });
    const second = updateSetup(dir);
    expect((await runUpdate({ yes: true }, second.deps)).exitCode, second.err()).toBe(0);
    expect(readConfig(dir).removed_files).toContain(NEW_REPLACED);
    expect(exists(dir, NEW_REPLACED)).toBe(false);
    expect(section(second.out(), "消したまま")).toContain(NEW_REPLACED);
  });
});

describe("#35 CLI の入口", () => {
  it("#35 update の入口（Commander）に --yes・--dir・--dry-run・--allow-dirty がある。--allow-dirty の説明に保護が無くなることを書く", async () => {
    const { updateCommand } = await import("../../src/commands/update.js");
    const cmd = updateCommand();
    const names = cmd.options.map((o) => o.long);
    expect(names).toEqual(expect.arrayContaining(["--yes", "--dir", "--dry-run", "--allow-dirty"]));
    const dirty = cmd.options.find((o) => o.long === "--allow-dirty");
    expect(dirty?.description).toContain("Git");
  });
});
