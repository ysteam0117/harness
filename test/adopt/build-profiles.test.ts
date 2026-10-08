// #18 PR-B：adopt で、当てたプロファイルの Skill だけを導入する（コード・設定のファイルは入れない）。
// 想定する型：src/adopt/build.ts の buildAdoptFiles({ answers, profiles?: AppliedProfile[], nodeApp?: boolean })、
// src/adopt/profiles.ts の usableProfiles(applied, templatesDir?) → { usable, missing }
import { rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDetectionRules, type AppliedProfile } from "../../src/adopt/detect.js";
import { buildAdoptFiles } from "../../src/adopt/build.js";
import { usableProfiles } from "../../src/adopt/profiles.js";
import { GenerateError } from "../../src/generate/errors.js";
import { loadProfile, selectProfileFiles } from "../../src/generate/profile.js";
import { findTemplatesDir } from "../../src/generate/templates-dir.js";
import {
  cleanupProjectTmp,
  completeAnswers,
  copyRealTemplates,
} from "../generate/project-helpers.js";
import { COMMANDS, DOCUMENTS, MUST_NOT_USE_PARTS } from "./forbidden-words.js";

afterEach(cleanupProjectTmp);

const BOTH = { ais: ["claude", "codex"] };

/** 検出で当たりうる、8つのプロファイル（requires を満たす組） */
const ALL: AppliedProfile[] = [
  { profile: "backend-framework/hono", apps: ["backend"] },
  { profile: "logger/structured-logger", apps: ["backend"] },
  { profile: "frontend-build/vite-react-router", apps: ["frontend"] },
  { profile: "frontend-state/tanstack-query-rhf-zod", apps: ["frontend"] },
  { profile: "http-client/axios", apps: ["frontend"] },
  { profile: "test-framework/vitest-playwright", apps: ["."] },
  { profile: "quality/typescript-standard", apps: ["."] },
  { profile: "data-access/drizzle", apps: ["backend"] },
];

const skillName = (key: string): string => loadProfile(findTemplatesDir(), key).skillName;

/** AGENTS.md の「必ず読むSkill」の表の行 */
function tableRows(agents: string): string[] {
  const start = agents.indexOf("## コードを書く前に、ルールを読んで従う（必須）");
  const end = agents.indexOf("## 実装の進め方");
  return agents
    .slice(start, end)
    .split("\n")
    .filter((l) => l.startsWith("| ") && !l.startsWith("| ---") && !l.startsWith("| 変更する部分"));
}

describe("#18-B：当てたプロファイルの Skill を導入する", () => {
  it("8つの Skill が、.claude/skills と .agents/skills の両方に入る。SKILL.md は本文を持つ", async () => {
    const files = buildAdoptFiles({ answers: await completeAnswers(BOTH), profiles: ALL });
    const byPath = new Map(files.map((f) => [f.path, f]));
    for (const a of ALL) {
      const name = skillName(a.profile);
      for (const root of [".claude/skills", ".agents/skills"]) {
        const file = byPath.get(`${root}/${name}/SKILL.md`);
        expect(file?.kind, `${root}/${name}`).toBe("file");
        expect(file?.content.length ?? 0).toBeGreaterThan(100);
      }
    }
  });

  it("プロファイルの files（コード・設定）は入らない。出力は AI 向けのファイルだけ", async () => {
    const answers = await completeAnswers(BOTH);
    const files = buildAdoptFiles({ answers, profiles: ALL });
    const paths = files.map((f) => f.path);
    for (const a of ALL) {
      const profile = loadProfile(findTemplatesDir(), a.profile);
      for (const f of selectProfileFiles(profile, answers)) {
        expect(paths, f.destination).not.toContain(f.destination);
      }
    }
    for (const p of ["backend/src/lib/app-error.ts", "tsconfig.json", "package.json"]) {
      expect(paths, p).not.toContain(p);
    }
    const allowed = (p: string): boolean =>
      p === "AGENTS.md" ||
      p === "CLAUDE.md" ||
      p.startsWith(".claude/skills/") ||
      p.startsWith(".agents/skills/") ||
      p.startsWith(".claude/agents/") ||
      p.startsWith(".codex/agents/") ||
      p === ".claude/settings.json" ||
      p === ".codex/rules/default.rules" ||
      p === ".github/workflows/harness-check.yml";
    expect(paths.filter((p) => !allowed(p))).toEqual([]);
  });

  it("Skill の外のファイル（SKILL.md 以外）は、プロファイルの Skill のフォルダにも出ない", async () => {
    const files = buildAdoptFiles({ answers: await completeAnswers(BOTH), profiles: ALL });
    for (const a of ALL) {
      const name = skillName(a.profile);
      const inFolder = files.filter((f) => f.path.startsWith(`.claude/skills/${name}/`));
      expect(inFolder.map((f) => f.path)).toEqual([`.claude/skills/${name}/SKILL.md`]);
    }
  });

  it("プロファイルを渡さない・空のときは、これまでの出力と同じ（共通のルールだけ）", async () => {
    const answers = await completeAnswers(BOTH);
    const none = buildAdoptFiles({ answers });
    expect(buildAdoptFiles({ answers, profiles: [] })).toEqual(none);
    const names = ALL.map((a) => skillName(a.profile));
    for (const f of none) {
      for (const name of names) expect(f.path.includes(`/skills/${name}/`), f.path).toBe(false);
    }
  });

  it("claude だけを選んだときは、.agents/skills に出ない", async () => {
    const files = buildAdoptFiles({
      answers: await completeAnswers({ ais: ["claude"] }),
      profiles: ALL,
    });
    expect(files.some((f) => f.path.startsWith(".agents/"))).toBe(false);
    expect(files.some((f) => f.path === ".claude/skills/backend-hono/SKILL.md")).toBe(true);
  });

  it("パスの順に並び、同じ入力なら同じ結果になる", async () => {
    const answers = await completeAnswers(BOTH);
    const a = buildAdoptFiles({ answers, profiles: ALL });
    const b = buildAdoptFiles({ answers, profiles: [...ALL].reverse() });
    expect(b).toEqual(a);
    const paths = a.map((f) => f.path);
    expect(paths).toEqual([...paths].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
  });

  it("本文に、プロファイルの Skill が差し込む良い例（{{example:...}}）が残らない・置き換えの名前が残らない", async () => {
    const files = buildAdoptFiles({ answers: await completeAnswers(BOTH), profiles: ALL });
    for (const f of files) {
      if (f.path.endsWith(".md")) {
        expect(f.content, f.path).not.toMatch(/\{\{[a-z][a-z0-9_:#-]*\}\}/);
      }
    }
  });
});

describe("#18-B：AGENTS.md の「必ず読むSkill」の表", () => {
  it("当てたプロファイルの Skill の行が出る。対象のフォルダが書かれる（ルート全体なら書かない）", async () => {
    const files = buildAdoptFiles({ answers: await completeAnswers(BOTH), profiles: ALL });
    const agents = files.find((f) => f.path === "AGENTS.md")?.content ?? "";
    const rows = tableRows(agents).join("\n");
    expect(rows).toContain("`backend-hono`（`backend/` のみ）");
    expect(rows).toContain("`frontend-build`（`frontend/` のみ）");
    expect(rows).toContain("`frontend-state`（`frontend/` のみ）");
    expect(rows).toContain("`http-client-axios`（`frontend/` のみ）");
    expect(rows).toContain("`data-access-drizzle`（`backend/` のみ）");
    expect(rows).toContain("`logger`（`backend/` のみ）");
    // ルート全体
    expect(rows).toContain("`test-tools`");
    expect(rows).not.toContain("`test-tools`（");
    expect(rows).toContain("`quality-tools`");
    expect(rows).not.toContain("`quality-tools`（");
  });

  it("入れた Skill はすべて表にある。表にある Skill はすべて出力にある（両 AI）", async () => {
    const files = buildAdoptFiles({ answers: await completeAnswers(BOTH), profiles: ALL });
    const agents = files.find((f) => f.path === "AGENTS.md")?.content ?? "";
    const named = new Set<string>();
    for (const row of tableRows(agents)) {
      const cell = row.split("|")[2] ?? "";
      for (const m of cell.matchAll(/`([a-z0-9_-]+)`/g)) named.add(m[1] as string);
    }
    for (const a of ALL) expect(named, a.profile).toContain(skillName(a.profile));
    for (const name of named) {
      expect(
        files.some((f) => f.path === `.claude/skills/${name}/SKILL.md`),
        name,
      ).toBe(true);
      expect(
        files.some((f) => f.path === `.agents/skills/${name}/SKILL.md`),
        name,
      ).toBe(true);
    }
  });

  it("一部のプロファイルだけのとき、当てていない Skill は表に書かない", async () => {
    const files = buildAdoptFiles({
      answers: await completeAnswers(BOTH),
      profiles: [
        { profile: "backend-framework/hono", apps: ["backend"] },
        { profile: "logger/structured-logger", apps: ["backend"] },
      ],
    });
    const agents = files.find((f) => f.path === "AGENTS.md")?.content ?? "";
    const rows = tableRows(agents).join("\n");
    expect(rows).toContain("`backend-hono`（`backend/` のみ）");
    for (const name of ["frontend-build", "http-client-axios", "test-tools", "quality-tools"]) {
      expect(rows, name).not.toContain(`\`${name}\``);
      expect(files.some((f) => f.path === `.claude/skills/${name}/SKILL.md`)).toBe(false);
    }
    // DB の行は、プロファイルがないので共通のまま
    expect(rows).toContain("DBの書き方は、既存のコードに合わせる");
    // 当てていない分類は、「該当する技術のSkillはない」のまま
    expect(rows).toContain("| Lint・型・書式などの品質チェックの設定 | 該当する技術のSkillはない");
  });

  it("複数のフォルダに当たるときは、すべて書く", async () => {
    const files = buildAdoptFiles({
      answers: await completeAnswers(BOTH),
      profiles: [
        { profile: "backend-framework/hono", apps: ["apps/api", "apps/worker"] },
        { profile: "logger/structured-logger", apps: ["apps/api", "apps/worker"] },
      ],
    });
    const agents = files.find((f) => f.path === "AGENTS.md")?.content ?? "";
    expect(agents).toContain("`backend-hono`（`apps/api/`・`apps/worker/` のみ）");
  });

  it("良い例・悪い例の Skill の案内が、入れた Skill と食い違わない", async () => {
    const withProfiles = buildAdoptFiles({ answers: await completeAnswers(BOTH), profiles: ALL });
    const backend = withProfiles.find((f) => f.path === ".claude/skills/backend/SKILL.md");
    expect(backend?.content).toContain("`backend-hono`");
    expect(backend?.content).not.toContain("このプロジェクトでは入れていない");
    const frontend = withProfiles.find((f) => f.path === ".claude/skills/frontend/SKILL.md");
    expect(frontend?.content).toContain("`frontend-state`");
    expect(frontend?.content).not.toContain("このプロジェクトでは入れていない");
    const without = buildAdoptFiles({ answers: await completeAnswers(BOTH) });
    const backend0 = without.find((f) => f.path === ".claude/skills/backend/SKILL.md");
    expect(backend0?.content).toContain("このプロジェクトでは入れていない");
  });
});

describe("#18-B：生成したアプリ専用のものを、プロファイルの Skill を含む出力全体に書かない", () => {
  for (const repository of ["github", "local"]) {
    for (const database of ["d1", "postgresql", "none"]) {
      it(`コマンド名・文書のパス・アプリのフォルダ構成が無い（${repository}・${database}）`, async () => {
        const answers = await completeAnswers({
          ...BOTH,
          repository,
          database,
          ...(database === "postgresql" ? { postgres_provider: "neon" } : {}),
        });
        const profiles = ALL.filter((a) => database !== "none" || !a.profile.includes("drizzle"));
        const files = buildAdoptFiles({ answers, profiles });
        expect(files.some((f) => f.path === ".agents/skills/backend-hono/SKILL.md")).toBe(true);
        for (const f of files) {
          for (const word of [...COMMANDS, ...DOCUMENTS]) {
            expect(f.content.includes(word), `${f.path} に「${word}」`).toBe(false);
          }
        }
      });
    }
  }
});

describe("#18-B R2：今のハーネスに無いプロファイルは、報告して飛ばす", () => {
  it("すべてあれば、そのまま使う", () => {
    const r = usableProfiles(ALL);
    expect(r.usable).toEqual(ALL);
    expect(r.missing).toEqual([]);
  });

  it("無いプロファイルを除く", () => {
    const r = usableProfiles([
      { profile: "quality/typescript-standard", apps: ["."] },
      { profile: "frontend-build/removed-in-future", apps: ["frontend"] },
    ]);
    expect(r.usable.map((u) => u.profile)).toEqual(["quality/typescript-standard"]);
    expect(r.missing.map((m) => m.profile)).toEqual(["frontend-build/removed-in-future"]);
  });

  it("ハーネスから消えたプロファイル（logger）を requires している hono も、連鎖して除く。両方を報告する", () => {
    const dir = copyRealTemplates();
    rmSync(path.join(dir, "profiles", "logger"), { recursive: true });
    const r = usableProfiles(
      [
        { profile: "logger/structured-logger", apps: ["backend"] },
        { profile: "backend-framework/hono", apps: ["backend"] },
        { profile: "quality/typescript-standard", apps: ["."] },
      ],
      dir,
    );
    expect(r.usable.map((u) => u.profile)).toEqual(["quality/typescript-standard"]);
    expect(r.missing.map((m) => m.profile).sort()).toEqual([
      "backend-framework/hono",
      "logger/structured-logger",
    ]);
  });

  it("記録に logger が無く hono がある（requires を満たさない）：hono も除く", () => {
    const r = usableProfiles([{ profile: "backend-framework/hono", apps: ["backend"] }]);
    expect(r.usable).toEqual([]);
    expect(r.missing.map((m) => m.profile)).toEqual(["backend-framework/hono"]);
  });

  it("同じプロファイルが2回あっても、1つにまとめる", () => {
    const r = usableProfiles([
      { profile: "quality/typescript-standard", apps: ["."] },
      { profile: "quality/typescript-standard", apps: ["frontend"] },
    ]);
    expect(r.usable).toEqual([{ profile: "quality/typescript-standard", apps: [".", "frontend"] }]);
  });

  it("buildAdoptFiles も、止まらずに残りの Skill を入れる", async () => {
    const files = buildAdoptFiles({
      answers: await completeAnswers(BOTH),
      profiles: [
        { profile: "quality/typescript-standard", apps: ["."] },
        { profile: "frontend-build/removed-in-future", apps: ["frontend"] },
        { profile: "backend-framework/hono", apps: ["backend"] },
      ],
    });
    const paths = files.map((f) => f.path);
    expect(paths).toContain(".claude/skills/quality-tools/SKILL.md");
    expect(paths).not.toContain(".claude/skills/backend-hono/SKILL.md");
    expect(paths).not.toContain(".claude/skills/frontend-build/SKILL.md");
  });
});

describe("#18-B：プロファイルの分類と AGENTS.md の表の対応", () => {
  it("検出で当たりうるすべてのプロファイルが、表に書ける（data/adopt-profile-skills.yaml にある）", async () => {
    const keys = loadDetectionRules().profiles.map((r) => r.profile);
    expect([...keys].sort()).toEqual(ALL.map((a) => a.profile).sort());
    const answers = await completeAnswers(BOTH);
    expect(() =>
      buildAdoptFiles({ answers, profiles: keys.map((profile) => ({ profile, apps: ["."] })) }),
    ).not.toThrow();
  });

  it("表に書けない分類（auth）のプロファイルは、Skill だけでも入れない（GenerateError）", async () => {
    const answers = await completeAnswers({ ...BOTH, auth: "app" });
    expect(() =>
      buildAdoptFiles({ answers, profiles: [{ profile: "auth/app-auth", apps: ["."] }] }),
    ).toThrow(GenerateError);
  });

  it("回答が database: none なのに drizzle が当たった：止まって、回答を確かめるよう案内する（値は出さない）", async () => {
    const answers = await completeAnswers({ ...BOTH, database: "none" });
    expect(() =>
      buildAdoptFiles({
        answers,
        profiles: [{ profile: "data-access/drizzle", apps: ["backend"] }],
      }),
    ).toThrow(/回答（database など）が、既存のアプリの技術と合っているか/);
  });
});

describe("#18-B：導入しない部品を、必須の指示として使わせない", () => {
  it("プロファイルの Skill の MUST・必ず の行に、導入しない部品（AppError・originCheck・console-guard など）が無い", async () => {
    const files = buildAdoptFiles({ answers: await completeAnswers(BOTH), profiles: ALL });
    const names = ALL.map((a) => skillName(a.profile));
    const skills = files.filter((f) =>
      names.some((n) => f.path === `.claude/skills/${n}/SKILL.md`),
    );
    expect(skills.length).toBe(ALL.length);
    for (const f of skills) {
      for (const line of f.content.split("\n")) {
        if (!/MUST|必ず|必須/.test(line)) continue;
        for (const part of MUST_NOT_USE_PARTS) {
          expect(line.includes(part), `${f.path} の「${line.slice(0, 40)}…」に ${part}`).toBe(
            false,
          );
        }
      }
    }
  });
});
