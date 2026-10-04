// 想定する型（実装は src/generate/project.ts・config.ts をこれに合わせる）。生成するファイルの一覧の組み立て（計画 2・6・R5・R6・R8）
//
//   export type ProjectFile = {
//     path: string;       // "/" 区切りの相対パス
//     content: string;    // 改行は LF
//     managed: boolean;   // ハーネスが管理するファイル（F-27）か。false はプロジェクトのもの（R5）
//   };
//   export interface BuildProjectInput {
//     answers: Answers;                    // 完全な回答（自動で決まる値・未定を含む）
//     acceptedWarnings: AcceptedWarning[]; // 承知した警告（{ id, message, reason }）
//     versions: VersionResult;             // #33 で選んだ版
//     now: Date;                           // 生成した日（generated_on・ADR の承知した日）。ローカルの日付 YYYY-MM-DD
//     templatesDir?: string;               // 既定は findTemplatesDir()
//     knowledgeDir?: string;               // 既定は実際の knowledge/
//   }
//   export function buildProject(input: BuildProjectInput): { files: ProjectFile[] };   // ディスクに書かない。誤りは GenerateError
//
//   // src/generate/config.ts
//   export function fingerprint(content: string): string;   // 改行を LF にそろえた中身の sha256（16進小文字）
//
// 出力に含まれるもの（計画 2）
//   buildOutputs（AI 向けの出力・プロファイルの files）＋ docs/secrets.md・docs/project-rules.md・docs/testing/pentest-plan.md・
//   scripts/env-check.mjs・.github/ISSUE_TEMPLATE/harness-feedback.md・docs/tech-stack.md・
//   docs/adr/0001-accepted-warnings.md（承知した警告があるときだけ）・package.json・.node-version・知見の写し・.harness/config.yaml
//   知見の写し：<AI の Skill のフォルダ>/knowledge/references/<分野>/<ファイル名>（.claude/skills/・.agents/skills/）
//   .harness/config.yaml：計画 6 の形（harness_version・generated_on・mode・answers・accepted_warnings・judgment・versions・roles・managed_files）
//     judgment：{ asvs_level, pentest_required, undecided, enabled_rules }
//     versions：{ name, version, reason, surveyed_on, latest_stable, verified } の一覧（VersionEntry を YAML のキーの形にしたもの）
//     roles：{ <役割>: { claude?: { model }, codex?: { model, effort } } }（選んだ AI の分だけ）
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { fingerprint } from "../../src/generate/config.js";
import { GenerateError } from "../../src/generate/errors.js";
import { judge } from "../../src/generate/judgment.js";
import { buildPackageJson } from "../../src/generate/package-json.js";
import { resolveProfiles } from "../../src/generate/profile.js";
import { buildProject, type ProjectFile } from "../../src/generate/project.js";
import { buildValues } from "../../src/generate/values.js";
import { selectProfiles } from "../../src/versions/profile-selection.js";
import { renderTechStack } from "../../src/versions/tech-stack.js";
import { FIXED_DAY } from "../versions/helpers.js";
import { AGENT_ROLES, LEFTOVER_NAME, realTemplatesDir } from "./helpers.js";
import {
  SAMPLE_WARNINGS,
  cleanupProjectTmp,
  completeAnswers,
  contentOf,
  copyRealTemplates,
  expectedManaged,
  pathsOf,
  projectInput,
  surveyVersions,
} from "./project-helpers.js";

afterEach(cleanupProjectTmp);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const harnessVersion = (
  JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version: string }
).version;

const sha256 = (text: string) =>
  createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");

type Config = {
  harness_version: string;
  generated_on: string;
  mode: string;
  answers: Record<string, unknown>;
  accepted_warnings: { id: string; message: string; reason: string }[];
  judgment: {
    asvs_level: number;
    pentest_required: boolean;
    undecided: string[];
    enabled_rules: string[];
  };
  versions: Record<string, unknown>[];
  roles: Record<string, { claude?: { model: string }; codex?: { model: string; effort: string } }>;
  managed_files: Record<string, string>;
};

const configOf = (files: ProjectFile[]): Config =>
  parse(contentOf(files, ".harness/config.yaml")) as Config;

const BOTH = { ais: ["claude", "codex"] };

describe("#34 AC-3: 生成するファイルの一覧", () => {
  it("#34 AC-3: AI 向けの出力・プロファイルのコード・文書・スクリプト・Issue のテンプレート・記録のファイルがそろう", async () => {
    const input = await projectInput({ ...BOTH, database: "d1" });
    const { files } = buildProject(input);
    const paths = pathsOf(files);
    for (const p of [
      "AGENTS.md",
      "CLAUDE.md",
      ".claude/settings.json",
      ".claude/skills/backend/SKILL.md",
      ".claude/skills/knowledge/SKILL.md",
      ".claude/agents/planner.md",
      ".codex/rules/default.rules",
      ".agents/skills/backend/SKILL.md",
      ".codex/agents/planner.toml",
      "backend/src/lib/app-error.ts",
      "docs/secrets.md",
      "docs/project-rules.md",
      "docs/testing/pentest-plan.md",
      "docs/tech-stack.md",
      "scripts/env-check.mjs",
      ".github/ISSUE_TEMPLATE/harness-feedback.md",
      "package.json",
      ".node-version",
      ".harness/config.yaml",
    ]) {
      expect(paths, p).toContain(p);
    }
  });

  it("#34 AC-3: 出力先が重ならない（大文字・小文字を区別せず、同じパスが2つない）", async () => {
    const { files } = buildProject(await projectInput({ ...BOTH }));
    const lower = pathsOf(files).map((p) => p.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it("#34 AC-3: ひな形の共通仕様の印（もとになった共通仕様）・差し込み前の {{名前}} が、どの出力にも残らない", async () => {
    const { files } = buildProject(await projectInput({ ...BOTH }));
    for (const f of files) {
      expect(f.content, f.path).not.toContain("もとになった共通仕様");
      expect(f.content, f.path).not.toMatch(LEFTOVER_NAME);
      expect(f.content, f.path).not.toContain("\r");
    }
  });

  it("#34 AC-3: docs/tech-stack.md は、#33 の renderTechStack の結果そのもの", async () => {
    const input = await projectInput({ database: "d1" });
    const { files } = buildProject(input);
    const profiles = resolveProfiles(realTemplatesDir, selectProfiles(input.answers));
    expect(contentOf(files, "docs/tech-stack.md")).toBe(renderTechStack(input.versions, profiles));
  });

  it("#34 AC-3: .node-version は、選んだ Node.js の版（末尾に改行）", async () => {
    const input = await projectInput();
    const node = input.versions.entries.find((e) => e.name === "node");
    expect(contentOf(buildProject(input).files, ".node-version")).toBe(`${node?.version}\n`);
  });

  it("#34 AC-3: package.json は、buildPackageJson の結果を2字下げの JSON にしたもの（末尾に改行）", async () => {
    const input = await projectInput({ database: "d1" });
    const text = contentOf(buildProject(input).files, "package.json");
    const profiles = resolveProfiles(realTemplatesDir, selectProfiles(input.answers));
    const expected = buildPackageJson({
      appName: input.answers.app_name,
      answers: input.answers,
      profiles,
      versions: input.versions,
    });
    expect(JSON.parse(text)).toEqual(expected);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.startsWith('{\n  "name": "testapp-001"')).toBe(true);
  });

  it("#34 AC-3: 文書に、決まった値が入る（secrets.md の表・pentest-plan.md の必須か・ASVS のレベル）", async () => {
    const input = await projectInput({ database: "d1", personal_data: "basic" });
    const { files } = buildProject(input);
    const values = buildValues({ answers: input.answers });
    expect(contentOf(files, "docs/secrets.md")).toContain(values["secrets_table"] ?? "未定義");
    const plan = contentOf(files, "docs/testing/pentest-plan.md");
    expect(plan).toContain(values["pentest_requirement"] ?? "未定義");
    expect(plan).toContain("初回のリリースの前に必須");
    expect(plan).toContain(`ASVSのレベル：${values["asvs_level"]}`);
  });

  it("#34 AC-3: 値が未定義の {{名前}} がひな形にあると、GenerateError（名前を示す。値の漏れは生成の前に分かる）", async () => {
    const dir = copyRealTemplates();
    const agents = path.join(dir, "AGENTS.md");
    appendFileSync(agents, "\n値の漏れのテスト：{{no_such_value_xyz}}\n");
    const input = await projectInput();
    expect(() => buildProject({ ...input, templatesDir: dir })).toThrow(GenerateError);
    expect(() => buildProject({ ...input, templatesDir: dir })).toThrow(/no_such_value_xyz/);
  });

  it("#34 AC-3: 文書のひな形（templates/docs/secrets.md）がなければ、GenerateError（足りないファイルを示す）", async () => {
    const dir = copyRealTemplates();
    rmSync(path.join(dir, "docs", "secrets.md"));
    const input = await projectInput();
    expect(() => buildProject({ ...input, templatesDir: dir })).toThrow(GenerateError);
    expect(() => buildProject({ ...input, templatesDir: dir })).toThrow(/secrets\.md/);
  });
});

describe("#34 AC-3: .harness/config.yaml", () => {
  it("#34 AC-3: YAML として読め、harness_version・generated_on・mode・answers・accepted_warnings・judgment・versions・roles・managed_files がある", async () => {
    const input = await projectInput({ ...BOTH }, { acceptedWarnings: SAMPLE_WARNINGS });
    const cfg = configOf(buildProject(input).files);
    for (const key of [
      "harness_version",
      "generated_on",
      "mode",
      "answers",
      "accepted_warnings",
      "judgment",
      "versions",
      "roles",
      "managed_files",
    ]) {
      expect(cfg, key).toHaveProperty([key]);
    }
    expect(cfg.harness_version).toBe(harnessVersion);
    expect(cfg.generated_on).toBe(FIXED_DAY);
    expect(cfg.mode).toBe("create");
  });

  it("#34 AC-3: answers は、回答（自動で決まる値・未定を含む）そのもの", async () => {
    const input = await projectInput({
      ...BOTH,
      database: "postgresql",
      postgres_provider: "neon",
    });
    const cfg = configOf(buildProject(input).files);
    expect(cfg.answers).toEqual(JSON.parse(JSON.stringify(input.answers)));
    expect(cfg.answers).toMatchObject({
      app_name: "testapp-001",
      project_type: "web",
      infra: "cloudflare",
      personal_data: "none",
    });
  });

  it("#34 AC-3: 未定の回答（undecided）もそのまま記録される", async () => {
    const input = await projectInput({ personal_data: undefined, realtime: undefined });
    const cfg = configOf(buildProject(input).files);
    expect(cfg.answers["personal_data"]).toBe("undecided");
    expect(cfg.answers["realtime"]).toBe("undecided");
  });

  it("#34 AC-3: accepted_warnings は、承知した警告の id・message・reason", async () => {
    const input = await projectInput({}, { acceptedWarnings: SAMPLE_WARNINGS });
    expect(configOf(buildProject(input).files).accepted_warnings).toEqual(SAMPLE_WARNINGS);
    const none = await projectInput();
    expect(configOf(buildProject(none).files).accepted_warnings).toEqual([]);
  });

  it("#34 AC-3: judgment は、判定の結果（ASVS のレベル・ペネトレーションテストの要否・未定の一覧・有効にするルール）", async () => {
    for (const over of [
      { personal_data: "basic", admin: "yes", realtime: undefined },
      { personal_data: "none", admin: "no", critical_ops: "no" },
    ]) {
      const input = await projectInput(over);
      const j = judge(input.answers);
      expect(configOf(buildProject(input).files).judgment).toEqual({
        asvs_level: j.asvsLevel,
        pentest_required: j.pentestRequired,
        undecided: j.undecided,
        enabled_rules: j.enabledRules,
      });
    }
  });

  it("#34 AC-3: versions は、調べた結果（名前・版・理由・調べた日・最新の安定版・検証済み）の一覧。Node.js も入る", async () => {
    const input = await projectInput({ database: "d1" });
    const cfg = configOf(buildProject(input).files);
    expect(cfg.versions).toHaveLength(input.versions.entries.length);
    expect(cfg.versions.map((v) => v["name"])).toEqual(input.versions.entries.map((e) => e.name));
    input.versions.entries.forEach((e, i) => {
      expect(cfg.versions[i]).toMatchObject({
        name: e.name,
        version: e.version,
        reason: e.reason,
        surveyed_on: e.surveyedOn,
        latest_stable: e.latestStable,
        verified: e.verified,
      });
    });
    expect(cfg.versions[0]?.["name"]).toBe("node");
  });

  it("#34 AC-3: roles は、選んだ AI の分だけ（Claude だけなら codex は無い）", async () => {
    const claudeOnly = configOf(buildProject(await projectInput({ ais: ["claude"] })).files);
    for (const role of AGENT_ROLES) {
      expect(claudeOnly.roles[role]?.claude?.model, role).toMatch(/^(opus|sonnet|haiku)$/);
      expect(claudeOnly.roles[role], role).not.toHaveProperty(["codex"]);
    }
    expect(claudeOnly.roles["orchestrator"]?.claude?.model).toMatch(/^(opus|sonnet|haiku)$/);
  });

  it("#34 AC-3: roles：Codex だけなら claude は無く、モデルと effort がある", async () => {
    const codexOnly = configOf(buildProject(await projectInput({ ais: ["codex"] })).files);
    for (const role of AGENT_ROLES) {
      expect(codexOnly.roles[role]?.codex?.model, role).toBeTruthy();
      expect(codexOnly.roles[role]?.codex?.effort, role).toMatch(
        /^(minimal|low|medium|high|xhigh)$/,
      );
      expect(codexOnly.roles[role], role).not.toHaveProperty(["claude"]);
    }
  });

  it("#34 AC-3: roles：両方なら、役割ごとに claude と codex の両方がある", async () => {
    const both = configOf(buildProject(await projectInput({ ...BOTH })).files);
    for (const role of AGENT_ROLES) {
      expect(both.roles[role]?.claude?.model, role).toBeTruthy();
      expect(both.roles[role]?.codex?.model, role).toBeTruthy();
    }
  });

  it("#34 AC-3: roles のモデルは、生成したエージェントの定義に書かれたモデルと同じ", async () => {
    const { files } = buildProject(await projectInput({ ...BOTH }));
    const cfg = configOf(files);
    expect(contentOf(files, ".claude/agents/planner.md")).toContain(
      `model: ${cfg.roles["planner"]?.claude?.model}`,
    );
    const toml = contentOf(files, ".codex/agents/planner.toml");
    expect(toml).toContain(cfg.roles["planner"]?.codex?.model ?? "未定義");
    expect(toml).toContain(cfg.roles["planner"]?.codex?.effort ?? "未定義");
  });

  it("#34 AC-3: managed_files の指紋は、実際の中身の sha256（改行を LF にそろえる）と一致する", async () => {
    const { files } = buildProject(await projectInput({ ...BOTH, database: "d1" }));
    const cfg = configOf(files);
    const entries = Object.entries(cfg.managed_files);
    expect(entries.length).toBeGreaterThan(20);
    for (const [p, hash] of entries) {
      expect(hash, p).toMatch(/^[0-9a-f]{64}$/);
      expect(hash, p).toBe(sha256(contentOf(files, p)));
    }
  });

  it("#34 AC-3: fingerprint は sha256（16進）で、改行の違い（CRLF・LF）に影響されない", () => {
    expect(fingerprint("abc\n")).toBe(sha256("abc\n"));
    expect(fingerprint("a\r\nb\r\n")).toBe(fingerprint("a\nb\n"));
    expect(fingerprint("a")).not.toBe(fingerprint("b"));
    expect(fingerprint("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("#34 AC-3: プロジェクトのもの（tech-stack.md・project-rules.md・adr・testing・package.json・アプリのコード）と config.yaml 自身は、managed_files に含まれない", async () => {
    const { files } = buildProject(
      await projectInput({ ...BOTH, database: "d1" }, { acceptedWarnings: SAMPLE_WARNINGS }),
    );
    const managed = Object.keys(configOf(files).managed_files);
    for (const p of [
      "docs/tech-stack.md",
      "docs/project-rules.md",
      "docs/testing/pentest-plan.md",
      "docs/adr/0001-accepted-warnings.md",
      "package.json",
      ".node-version",
      ".harness/config.yaml",
      "backend/src/lib/app-error.ts",
      "wrangler.jsonc",
      "vitest.config.ts",
      "eslint.config.mjs",
    ]) {
      expect(managed, p).not.toContain(p);
    }
  });
});

describe("#34 R5: 管理するファイルの分類", () => {
  const combos: [string, Record<string, unknown>][] = [
    ["両方の AI・D1", { ...BOTH, database: "d1" }],
    ["Claude だけ・DB なし", { ais: ["claude"], database: "none" }],
    [
      "Codex だけ・PostgreSQL",
      { ais: ["codex"], database: "postgresql", postgres_provider: "neon" },
    ],
  ];

  for (const [name, over] of combos) {
    it(`#34 R5: ${name}：managed_files のパスの集合が、管理するものの一覧と完全に一致する（足りない・余分の両方を検出）`, async () => {
      const { files } = buildProject(
        await projectInput(over, { acceptedWarnings: SAMPLE_WARNINGS }),
      );
      const expected = pathsOf(files)
        .filter((p) => expectedManaged(p))
        .sort();
      expect(Object.keys(configOf(files).managed_files).sort()).toEqual(expected);
      // 管理するものが何もない、という見かけ上の一致を防ぐ
      for (const p of ["AGENTS.md", "docs/secrets.md", "scripts/env-check.mjs"]) {
        expect(expected, p).toContain(p);
      }
      expect(expected.some((p) => p.startsWith(".github/ISSUE_TEMPLATE/"))).toBe(true);
      expect(expected.some((p) => p.includes("/skills/knowledge/references/"))).toBe(true);
    });

    it(`#34 R5: ${name}：buildProject の結果の managed の印が、管理するものの一覧と一致する`, async () => {
      const { files } = buildProject(await projectInput(over));
      for (const f of files) expect(f.managed, f.path).toBe(expectedManaged(f.path));
    });
  }
});

describe("#34 R8: 承知した警告の ADR（C-35）", () => {
  const ADR = "docs/adr/0001-accepted-warnings.md";

  it("#34 R8: 承知した警告がないときは、ADR を出さない", async () => {
    const { files } = buildProject(await projectInput());
    expect(pathsOf(files)).not.toContain(ADR);
    // ADR の README とひな形（#63）だけがあり、承知した警告の ADR はない
    expect(pathsOf(files).filter((p) => p.startsWith("docs/adr/"))).toEqual([
      "docs/adr/0000-template.md",
      "docs/adr/README.md",
    ]);
  });

  it("#34 R8: 承知した警告があるときは出る。背景・選択肢・決定・理由・影響の項目と、警告の id・内容・理由・承知した日が記録される", async () => {
    const { files } = buildProject(await projectInput({}, { acceptedWarnings: SAMPLE_WARNINGS }));
    const adr = contentOf(files, ADR);
    for (const heading of ["背景", "選択肢", "決定", "理由", "影響"]) {
      expect(adr, heading).toMatch(new RegExp(`^#{1,4} .*${heading}`, "m"));
    }
    expect(adr).toContain("回答を変える");
    expect(adr).toContain("承知して続ける");
    const w = SAMPLE_WARNINGS[0];
    expect(adr).toContain(w?.id);
    expect(adr).toContain(w?.message);
    expect(adr).toContain(w?.reason);
    expect(adr).toContain(FIXED_DAY);
  });

  it("#34 R8: 警告が複数あるときは、すべての id が記録される", async () => {
    const more = [
      ...SAMPLE_WARNINGS,
      {
        id: "missing-tools",
        message: "必要なツールがありません（テスト）",
        reason: "テスト用の理由",
      },
    ];
    const { files } = buildProject(await projectInput({}, { acceptedWarnings: more }));
    const adr = contentOf(files, ADR);
    for (const w of more) {
      expect(adr).toContain(w.id);
      expect(adr).toContain(w.message);
    }
  });

  it("#34 R8: ADR はプロジェクトのもの（管理しない）。ひな形の印や {{名前}} は残らない", async () => {
    const { files } = buildProject(await projectInput({}, { acceptedWarnings: SAMPLE_WARNINGS }));
    expect(files.find((f) => f.path === ADR)?.managed).toBe(false);
    expect(contentOf(files, ADR)).not.toMatch(LEFTOVER_NAME);
  });
});

describe("#34 R4: 知見の写し", () => {
  it("#34 R4: DB ありでは、knowledge の README 以外が、Skill「知見」の references/ に写る（Claude・Codex の両方）。中身は元のファイルと同じ", async () => {
    const { files } = buildProject(await projectInput({ ...BOTH, database: "d1" }));
    const original = readFileSync(
      path.join(rootDir, "knowledge", "db", "index-design.md"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(contentOf(files, ".claude/skills/knowledge/references/db/index-design.md")).toBe(
      original,
    );
    expect(contentOf(files, ".agents/skills/knowledge/references/db/index-design.md")).toBe(
      original,
    );
    expect(pathsOf(files).some((p) => p.endsWith("README.md") && p.includes("knowledge/"))).toBe(
      false,
    );
  });

  it("#34 R4: DB なしでは、db の知見が写らず、索引（Skill「知見」の表）にも行がない", async () => {
    const { files } = buildProject(await projectInput({ ...BOTH, database: "none" }));
    const refs = pathsOf(files).filter((p) => p.includes("/skills/knowledge/references/"));
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((p) => p.includes("/references/db/"))).toEqual([]);
    for (const skill of [
      ".claude/skills/knowledge/SKILL.md",
      ".agents/skills/knowledge/SKILL.md",
    ]) {
      expect(contentOf(files, skill), skill).not.toContain("index-design");
      expect(contentOf(files, skill), skill).toContain("api-response-time");
    }
  });

  it("#34 R4: 索引の行数は、写したファイル数と同じ（同じ一覧から作る）。写したすべてのファイルが索引にある", async () => {
    const { files } = buildProject(await projectInput({ ais: ["claude"], database: "d1" }));
    const refs = pathsOf(files).filter((p) => p.startsWith(".claude/skills/knowledge/references/"));
    const index = buildValues({
      answers: (await projectInput({ ais: ["claude"], database: "d1" })).answers,
    })["knowledge_index"];
    expect((index ?? "").split("\n")).toHaveLength(refs.length);
    const skill = contentOf(files, ".claude/skills/knowledge/SKILL.md");
    expect(skill).toContain(index ?? "未定義");
    for (const p of refs) {
      expect(skill, p).toContain(path.posix.basename(p).replace(/\.md$/, ""));
    }
  });
});

describe("#34 R6: DB なしのときの案内（AI × DB の9通り）", () => {
  const ais: [string, string[]][] = [
    ["Claude だけ", ["claude"]],
    ["Codex だけ", ["codex"]],
    ["両方", ["claude", "codex"]],
  ];
  const dbs: [string, Record<string, unknown>][] = [
    ["DB なし", { database: "none" }],
    ["D1", { database: "d1" }],
    ["PostgreSQL", { database: "postgresql", postgres_provider: "neon" }],
  ];

  for (const [aiName, list] of ais) {
    for (const [dbName, db] of dbs) {
      it(`#34 R6: ${aiName}・${dbName}：実際のひな形から生成でき、未定義の値がなく、Skill の案内の参照先が出力に存在する`, async () => {
        const { files } = buildProject(await projectInput({ ais: list, ...db }));
        const paths = pathsOf(files);
        for (const f of files) {
          expect(f.content, f.path).not.toMatch(LEFTOVER_NAME);
        }
        const skillRoots = [
          ...(list.includes("claude") ? [".claude/skills"] : []),
          ...(list.includes("codex") ? [".agents/skills"] : []),
        ];
        // AI を選ばなかった側のフォルダは作られない
        if (!list.includes("claude"))
          expect(paths.some((p) => p.startsWith(".claude/"))).toBe(false);
        if (!list.includes("codex")) {
          expect(paths.some((p) => p.startsWith(".agents/") || p.startsWith(".codex/"))).toBe(
            false,
          );
        }
        for (const root of skillRoots) {
          const backend = contentOf(files, `${root}/backend/SKILL.md`);
          if (dbName === "DB なし") {
            expect(backend, root).not.toContain("data-access");
            expect(backend, root).toMatch(/DB.*使わない|使わない.*DB/);
            expect(paths.some((p) => p.includes("/data-access"))).toBe(false);
          } else {
            // 案内（Skill「data-access-drizzle」）の参照先の Skill が、出力にある
            expect(backend, root).toContain("data-access-drizzle");
            expect(paths, root).toContain(`${root}/data-access-drizzle/SKILL.md`);
          }
        }
      });
    }
  }
});

describe("#34 AC-4: 同じ入力から、同じ結果になる", () => {
  it("#34 AC-4: 同じ入力で2回組み立てると、ファイルの一覧と中身が同じ（順序も同じ）", async () => {
    const input = await projectInput(
      { ...BOTH, database: "d1" },
      { acceptedWarnings: SAMPLE_WARNINGS },
    );
    const a = buildProject(input).files;
    const b = buildProject(input).files;
    expect(b).toEqual(a);
    expect(pathsOf(b)).toEqual(pathsOf(a));
  });

  it("#34 AC-4: 別々に作った同じ内容の入力（回答・調べた版）でも、同じ結果になる", async () => {
    const a = buildProject(
      await projectInput({ ...BOTH, database: "postgresql", postgres_provider: "neon" }),
    ).files;
    const b = buildProject(
      await projectInput({ ...BOTH, database: "postgresql", postgres_provider: "neon" }),
    ).files;
    expect(b).toEqual(a);
  });

  it("#34 AC-4: 生成した日（now）だけが変わるとき、違うのは config.yaml の generated_on だけ（ほかに時刻・乱数の揺れがない）", async () => {
    const base = await projectInput({ ...BOTH });
    const a = buildProject({ ...base, now: new Date("2026-10-03T12:00:00Z") }).files;
    const b = buildProject({ ...base, now: new Date("2026-10-04T12:00:00Z") }).files;
    expect(pathsOf(b)).toEqual(pathsOf(a));
    const differing = a.filter((f, i) => f.content !== b[i]?.content).map((f) => f.path);
    expect(differing).toEqual([".harness/config.yaml"]);
  });

  it("#34 AC-4: スナップショット：ファイルの一覧（管理する・しないの別）と指紋", async () => {
    const { files } = buildProject(
      await projectInput({ ...BOTH, database: "d1" }, { acceptedWarnings: SAMPLE_WARNINGS }),
    );
    const listing = files.map(
      (f) => `${f.managed ? "M" : "P"} ${f.path} ${fingerprint(f.content)}`,
    );
    expect(listing).toMatchSnapshot();
  });
});

describe("#34 AC-3: 環境変数・取得の失敗の理由を、生成したファイルに書かない", () => {
  const MARKER = "HARNESS_TEST_SECRET_MARKER_001";

  it("#34 AC-3: process.env の項目と、取得の失敗の理由（fetch の偽物のエラーの文言）に目印を入れて生成しても、どのファイルにも目印が含まれない", async () => {
    const names = ["HARNESS_TEST_ENV_MARKER_001", "HARNESS_TEST_TOKEN_001", "DATABASE_URL"];
    const saved = names.map((n) => process.env[n]);
    for (const n of names) process.env[n] = MARKER;
    try {
      const answers = await completeAnswers({
        ...BOTH,
        database: "postgresql",
        postgres_provider: "neon",
      });
      const failing = (async () => {
        throw new Error(`ECONNREFUSED ${MARKER}`);
      }) as typeof fetch;
      const versions = await surveyVersions(answers, failing);
      // 前提：目印は、取得の失敗の理由として versions に入っている
      expect(versions.entries.some((e) => e.fetchFailure?.includes(MARKER))).toBe(true);
      const { files } = buildProject({
        answers,
        acceptedWarnings: SAMPLE_WARNINGS,
        versions,
        now: new Date("2026-10-03T12:00:00Z"),
      });
      expect(files.length).toBeGreaterThan(40);
      for (const f of files) {
        expect(f.path, f.path).not.toContain(MARKER);
        expect(f.content, f.path).not.toContain(MARKER);
      }
    } finally {
      names.forEach((n, i) => {
        const v = saved[i];
        if (v === undefined) delete process.env[n];
        else process.env[n] = v;
      });
    }
  });
});
