// #19 Skill「既存のプロジェクトへの導入」（templates/skills/adopt-existing/SKILL.md）。
// 架空の回答（test/fixtures/adopt-skill-answers/answers.yaml）で、Skill が作る回答を CLI が読めることを確かめる。
// 本物のネットワーク・gh は使わない。実データ・個人名は使わない（架空の値だけ）。
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import type { AdoptDeps } from "../../src/commands/adopt.js";
import { runAdopt } from "./git-helpers.js";
import { runUpdate } from "../../src/commands/update.js";
import { AnswersError, parseAnswersYaml } from "../../src/questions/answers.js";
import { questionDefinitions } from "../../src/questions/definitions.js";
import { buildProject } from "../../src/generate/project.js";
import { findTableMismatches, readF21Assignments } from "../../scripts/check-spec-coverage.js";
import { FakePrompter, baseAnswers } from "../questions/helpers.js";
import { FIXED_NOW } from "../versions/helpers.js";
import { cleanScan } from "./secret-scan-helpers.js";
import { cleanupRoots, editConfig, newRoot, readConfig, updateSetup } from "../update/helpers.js";
import { pathsOf, projectInput } from "../generate/project-helpers.js";

afterEach(() => {
  cleanupRoots();
  vi.restoreAllMocks();
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILL_PATH = path.join(ROOT, "templates", "skills", "adopt-existing", "SKILL.md");
const SAMPLE = path.join(ROOT, "test", "fixtures", "adopt-sample");
const ANSWERS = path.join(ROOT, "test", "fixtures", "adopt-skill-answers", "answers.yaml");

const skillText = (): string => readFileSync(SKILL_PATH, "utf8").replace(/\r\n/g, "\n");

/** CLI が端末で聞く質問（Skill が書かない質問）の回答 */
const TERMINAL_ANSWERS = ((): Record<string, unknown> => {
  const b = baseAnswers() as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const def of questionDefinitions) {
    if (def.interactive === false || def.id === "app_name") continue;
    if (def.id in b) out[def.id] = b[def.id];
  }
  return out;
})();

interface Row {
  values: string[];
  condition: string;
  undecided: string;
}

/** 判定の表の行：id → 値・条件・undecided 可否（列：id・質問・選べる値・条件・undecided） */
function tableRows(): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const line of skillText().split("\n")) {
    const m = /^\| `([a-z_]+)` \|/.exec(line);
    if (!m?.[1]) continue;
    const cells = line.split("|").map((c) => c.trim());
    rows.set(m[1], {
      values: (cells[3] ?? "").split("・").map((v) => v.replace(/`/g, "").trim()),
      condition: cells[4] ?? "",
      undecided: cells[5] ?? "",
    });
  }
  return rows;
}

const nonInteractive = questionDefinitions.filter((d) => d.interactive === false);

describe("#19 AC-1: Skill の本文", () => {
  it("#19 ファイルがあり、冒頭に name・description と、もとになった共通仕様 C-05・C-76 がある", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
    const text = skillText();
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    expect(fm?.[1]).toBeDefined();
    const head = parse(fm?.[1] ?? "") as Record<string, unknown>;
    expect(head["name"]).toBe("adopt-existing");
    expect(typeof head["description"]).toBe("string");
    expect(text).toContain("<!-- もとになった共通仕様：C-05・C-76 -->");
  });

  it("#19 interactive:false の質問の id が、すべて判定の表にある", () => {
    const rows = tableRows();
    for (const def of nonInteractive) {
      expect(rows.has(def.id), def.id).toBe(true);
    }
  });

  it("#19 判定の表の値が、質問の定義の選択肢と一字一句同じ", () => {
    const rows = tableRows();
    for (const def of nonInteractive) {
      const expected = (def.options ?? []).map((o) => o.value);
      expect(rows.get(def.id)?.values, def.id).toEqual(expected);
    }
  });

  it("#19 undecided 可否の列が、定義（選択肢に undecided があるか）と一致する", () => {
    const rows = tableRows();
    const allowed = nonInteractive
      .filter((d) => (d.options ?? []).some((o) => o.value === "undecided"))
      .map((d) => d.id);
    const denied = nonInteractive.filter((d) => !allowed.includes(d.id)).map((d) => d.id);
    expect(allowed.length).toBeGreaterThan(5);
    expect(denied.sort()).toEqual(["critical_ops_kinds", "file_kinds", "idp"]);
    for (const id of allowed) expect(rows.get(id)?.undecided, id).toBe("可");
    for (const id of denied) expect(rows.get(id)?.undecided, id).toBe("不可");
  });

  it("#19 秘密情報・undecided・app_name・根拠・確かめ方・後日の反映の記述がある", () => {
    const text = skillText();
    for (const word of [
      "undecided",
      ".env",
      ".env.example",
      "tfstate",
      "app_name",
      "accepted_warnings",
      "# 根拠:",
      "# 根拠: なし（判定できない）",
      "harness adopt --answers",
      "--dry-run",
      ".harness/config.yaml",
      "harness update",
      "未記入の補足",
    ]) {
      expect(text, word).toContain(word);
    }
    expect(text).not.toContain("端末で質問される");
  });

  it("#20 導入のあとに、差の一覧の「未確認」を根拠つきで埋めて Issue にする節がある(秘密情報は開かない・値は書かない)", () => {
    const text = skillText();
    const start = text.indexOf("## 導入のあとに、未確認の項目を埋める");
    expect(start).toBeGreaterThan(0);
    const section = text.slice(start);
    for (const word of [
      "docs/harness-adoption.md",
      "未確認",
      "満たしている",
      "一部",
      "満たしていない",
      "対象外",
      "根拠",
      "Issue",
      "--issue",
    ]) {
      expect(section, word).toContain(word);
    }
    // 導入のあとの節にも、秘密情報を開かない・値を書かない約束がある
    expect(section).toContain(".env");
    expect(section).toMatch(/値|中身/);
  });
});

describe("#19 AC-1: Skill の yaml の例", () => {
  it("#19 例を parseAnswersYaml に通せる。app_name はなく、undecided がある", () => {
    const block = /```yaml\n([\s\S]*?)\n```/.exec(skillText());
    expect(block?.[1]).toBeDefined();
    const parsed = parseAnswersYaml(block?.[1] ?? "");
    expect(parsed.answers).not.toHaveProperty("app_name");
    expect(Object.values(parsed.answers)).toContain("undecided");
    expect(Object.values(parsed.answers)).toContain("no");
  });

  it("#19 fixture（根拠と候補のコメント付き）を読める。undecided の項目には根拠なしと書いてある", () => {
    const text = readFileSync(ANSWERS, "utf8");
    const parsed = parseAnswersYaml(text);
    expect(parsed.answers).not.toHaveProperty("app_name");
    expect(parsed.answers).toMatchObject({
      auth: "oidc",
      idp: "google",
      collaborative: "undecided",
    });
    expect(text).toContain("# 根拠: なし（判定できない）");
    expect(text).toContain("技術プロファイルの候補");
  });
});

describe("#19 規則の根拠：undecided を許さない補足", () => {
  it.each([
    ["idp", { auth: "oidc", idp: "undecided" }],
    ["critical_ops_kinds", { critical_ops: "yes", critical_ops_kinds: "undecided" }],
    ["file_kinds", { file_upload: "yes", file_kinds: "undecided" }],
    ["critical_ops_kinds（配列）", { critical_ops: "yes", critical_ops_kinds: ["undecided"] }],
    ["file_kinds（配列）", { file_upload: "yes", file_kinds: ["undecided"] }],
  ])("#19 %s: undecided の回答は拒否される", (_name, doc) => {
    expect(() => parseAnswersYaml(stringify(doc))).toThrow(AnswersError);
  });
});

/** 架空の既存のアプリ（フォルダの名前は sample-app） */
function sampleApp(): string {
  const dir = path.join(newRoot(), "sample-app");
  cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}

function adoptDeps(dir: string, errs: string[] = []): AdoptDeps {
  return {
    prompter: new FakePrompter(),
    cwd: dir,
    interactive: false,
    stderr: (s) => errs.push(s),
    stdout: () => undefined,
    now: () => FIXED_NOW,
    secretScan: cleanScan,
  };
}

/** Skill が書く部分（YAML の文字列）に、端末で答える質問の回答を足した回答ファイル */
function writeAnswers(skillPart: string, terminal: Record<string, unknown> = TERMINAL_ANSWERS) {
  const file = path.join(newRoot(), "answers.yaml");
  writeFileSync(file, `${skillPart}\n${stringify(terminal)}`);
  return file;
}

describe("#19 AC-1: Skill が作った回答で harness adopt が通る", () => {
  it("#19 dry-run：終了コード 0 で、何も書かない", async () => {
    const dir = sampleApp();
    const errs: string[] = [];
    const out = await runAdopt(
      { answers: writeAnswers(readFileSync(ANSWERS, "utf8")), dryRun: true },
      adoptDeps(dir, errs),
    );
    expect(out.exitCode, errs.join("")).toBe(0);
    expect(existsSync(path.join(dir, ".harness"))).toBe(false);
  });

  it("#19 --yes：config.yaml の answers に値と undecided が記録され、コメントを消した版と同じ結果になる", async () => {
    const withComments = sampleApp();
    const errs: string[] = [];
    const a = await runAdopt(
      { answers: writeAnswers(readFileSync(ANSWERS, "utf8")), yes: true },
      adoptDeps(withComments, errs),
    );
    expect(a.exitCode, errs.join("")).toBe(0);
    const answers = readConfig(withComments).answers;
    expect(answers).toMatchObject({
      auth: "oidc",
      idp: "google",
      admin: "yes",
      org_separation: "no",
      collaborative: "undecided",
      realtime: "undecided",
      availability: "undecided",
      critical_ops_kinds: ["delete", "publish"],
      file_kinds: ["image"],
    });

    const stripped = readFileSync(ANSWERS, "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    const without = sampleApp();
    const b = await runAdopt({ answers: writeAnswers(stripped), yes: true }, adoptDeps(without));
    expect(b.exitCode).toBe(0);
    expect(readConfig(without).answers).toEqual(answers);
  });
});

describe("#19 補足を省略した回答（分からない補足は書かない）", () => {
  it.each([
    ["idp", "auth: oidc\n"],
    ["critical_ops_kinds", "auth: oidc\nidp: google\ncritical_ops: yes\n"],
    ["file_kinds", "auth: oidc\nidp: google\nfile_upload: yes\n"],
  ])(
    "#19 %s を省略：非端末の adopt（dry-run）が通り、config.yaml には補足がない",
    async (id, part) => {
      const errs: string[] = [];
      const file = writeAnswers(part);
      const dry = await runAdopt({ answers: file, dryRun: true }, adoptDeps(sampleApp(), errs));
      expect(dry.exitCode, errs.join("")).toBe(0);
      const dir = sampleApp();
      const out = await runAdopt({ answers: file, yes: true }, adoptDeps(dir, errs));
      expect(out.exitCode, errs.join("")).toBe(0);
      expect(readConfig(dir).answers).not.toHaveProperty(id);
    },
  );

  it("#19 後日 config.yaml の answers に補足を追記して harness update：値が残り、拒否されない", async () => {
    const errs: string[] = [];
    const dir = sampleApp();
    const out = await runAdopt(
      { answers: writeAnswers("auth: oidc\n"), yes: true },
      adoptDeps(dir, errs),
    );
    expect(out.exitCode, errs.join("")).toBe(0);
    expect(readConfig(dir).answers).not.toHaveProperty("idp");
    editConfig(dir, (doc) => {
      doc.answers["idp"] = "google";
    });
    const s = updateSetup(dir);
    const upd = await runUpdate({ yes: true }, s.deps);
    expect(upd.exitCode, s.err()).toBe(0);
    expect(readConfig(dir).answers["idp"]).toBe("google");
  });
});

describe("#19 AC-2: 導入物に入れない（ハーネス専用の Skill）", () => {
  it("#19 create の出力に adopt-existing がない", async () => {
    const paths = pathsOf(buildProject(await projectInput({ ais: ["claude", "codex"] })).files);
    expect(paths.some((p) => p.includes("adopt-existing"))).toBe(false);
    expect(paths).toContain(".claude/skills/review/SKILL.md");
  });

  it("#19 adopt の出力に adopt-existing がない（claude・codex の両方）", async () => {
    const dir = sampleApp();
    const errs: string[] = [];
    const file = writeAnswers("", {
      ...TERMINAL_ANSWERS,
      ais: ["claude", "codex"],
      auth: "oidc",
      idp: "google",
    });
    const out = await runAdopt({ answers: file, yes: true }, adoptDeps(dir, errs));
    expect(out.exitCode, errs.join("")).toBe(0);
    for (const base of [".claude/skills", ".agents/skills"]) {
      expect(existsSync(path.join(dir, base, "review", "SKILL.md")), base).toBe(true);
      expect(existsSync(path.join(dir, base, "adopt-existing")), base).toBe(false);
    }
  });
});

describe("#19 F-21 の表との対応（F-22）", () => {
  const functional = path.join(ROOT, "docs", "requirements", "functional.md");
  const templates = path.join(ROOT, "templates");

  it("#19 F-21 の Skill の表に「既存のプロジェクトへの導入」の行があり、C-05・C-76 を割り当てている", () => {
    const ids = readF21Assignments(functional).get("skills/adopt-existing/SKILL.md");
    expect([...(ids ?? [])].sort()).toEqual(["C-05", "C-76"]);
  });

  it("#19 表とテンプレートの冒頭の番号が一致する", () => {
    expect(findTableMismatches(functional, templates)).toEqual([]);
  });
});
