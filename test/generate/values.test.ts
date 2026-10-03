// 想定する型（実装は src/generate/values.ts をこれに合わせる）。テンプレートの値の決定
//
//   export interface BuildValuesInput {
//     answers: Answers;                  // 完全な回答（自動で決まる値・未定を含む）
//     judgment?: Judgment;               // 既定は judge(answers)
//     knowledge?: KnowledgeEntry[];      // 既定は selectKnowledge(answers)
//   }
//   export function buildValues(input: BuildValuesInput): Record<string, string>;
//     名前 → 値。ひな形（templates/）の {{...}} すべてに値を持つ（未定義の値は #31 の差し込みがエラーにする）。
//     値は data/template-values.yaml（回答の条件で選ぶ）・data/env-items.yaml・data/role-models.yaml・
//     data/runtimes.yaml（compatibility_date）に置き、データに書けないものだけを計算する。
//     選んだ AI の分だけ役割とモデルの値を持つ（Codex だけなら claude_model_* を持たない。Claude だけなら codex_* を持たない）
//     data_access_guide（R6）：Skill「バックエンド」の、データアクセスの案内の行全体
//   data/role-models.yaml：C-66 の表の初期値。Claude Code が主・Codex が主の2つの列。Claude のモデルは別名（opus・sonnet 等）
import { describe, expect, it } from "vitest";
import { judge } from "../../src/generate/judgment.js";
import { buildValues } from "../../src/generate/values.js";
import { questionDefinitions } from "../../src/questions/definitions.js";
import { AGENT_ROLES, fakeValues } from "./helpers.js";
import { completeAnswers } from "./project-helpers.js";

const vals = async (over: Record<string, unknown> = {}) =>
  buildValues({ answers: await completeAnswers(over) });

const DB = {
  none: { database: "none" },
  d1: { database: "d1" },
  postgresql: { database: "postgresql", postgres_provider: "neon" },
} as const;

const labelOf = (id: string, value: string) =>
  questionDefinitions.find((d) => d.id === id)?.options?.find((o) => o.value === value)?.label;

describe("#34 AC-3: ひな形の値の決定（値の漏れがない）", () => {
  it("#34 AC-3: ひな形に出てくるすべての名前（fakeValues の名前）に、空でない値がある（両方の AI）", async () => {
    const v = await vals({ ais: ["claude", "codex"] });
    for (const name of Object.keys(fakeValues())) {
      expect(v[name], name).toBeTypeOf("string");
      expect(v[name], name).not.toBe("");
    }
  });

  it("#34 R6: データアクセスの案内の行（data_access_guide）にも値がある", async () => {
    for (const db of Object.values(DB)) {
      const v = await vals(db);
      expect(v["data_access_guide"], JSON.stringify(db)).toBeTypeOf("string");
      expect(v["data_access_guide"]).not.toBe("");
    }
  });

  it("#34 AC-3: 値の中に、差し込み前の {{名前}} が残らない", async () => {
    for (const db of Object.values(DB)) {
      for (const [name, value] of Object.entries(await vals(db))) {
        expect(value, name).not.toMatch(/\{\{[a-z][a-z0-9_]*\}\}/);
      }
    }
  });

  it("#34 AC-3: app_name は回答のアプリ名", async () => {
    expect((await vals({ app_name: "testapp-777" }))["app_name"]).toBe("testapp-777");
  });

  it("#34 AC-3: データで決まる値（check_command・e2e_port・compatibility_date）の形", async () => {
    const v = await vals();
    expect(v["check_command"]).toBe("npm run check");
    expect(Number(v["e2e_port"])).toBeGreaterThan(1023);
    expect(Number(v["e2e_port"])).toBeLessThanOrEqual(65535);
    expect(v["compatibility_date"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v["error_handler"]).not.toBe("");
    expect(v["allowed_origins"]).not.toBe("");
    expect(v["mutation_targets"]).not.toBe("");
  });
});

describe("#34 AC-3: 回答の表示の名前・判定の結果", () => {
  it("#34 AC-3: auth_method・database は、回答の選択肢の表示の名前", async () => {
    const v = await vals({ auth: "oidc", database: "d1" });
    expect(v["auth_method"]).toBe(labelOf("auth", "oidc"));
    expect(v["database"]).toBe(labelOf("database", "d1"));
    const w = await vals({ auth: "none", idp: undefined, database: "none" });
    expect(w["auth_method"]).toBe(labelOf("auth", "none"));
    expect(w["database"]).toBe(labelOf("database", "none"));
  });

  it("#34 AC-3: asvs_level は判定の結果（レベル1・2・3）", async () => {
    const lowAnswers = {
      personal_data: "none",
      admin: "no",
      critical_ops: "no",
      collaborative: "no",
      org_separation: "no",
      realtime: "no",
      availability: "tolerant",
    };
    expect((await vals(lowAnswers))["asvs_level"]).toBe("1");
    expect((await vals({ ...lowAnswers, personal_data: "basic" }))["asvs_level"]).toBe("2");
    expect((await vals({ ...lowAnswers, personal_data: "sensitive" }))["asvs_level"]).toMatch(/^3/);
  });

  it("#34 AC-3: pentest_requirement：必須なら「初回のリリースの前に必須（理由）」、必須でなければ「任意（推奨）」", async () => {
    const lowAnswers = {
      personal_data: "none",
      admin: "no",
      critical_ops: "no",
      collaborative: "no",
      org_separation: "no",
      realtime: "no",
      availability: "tolerant",
    };
    expect((await vals(lowAnswers))["pentest_requirement"]).toBe("任意（推奨）");
    const required = (await vals({ ...lowAnswers, personal_data: "basic" }))["pentest_requirement"];
    expect(required).toMatch(/^初回のリリースの前に必須（.+）$/);
    // すべて未定（安全側）でも必須
    const undecided = (
      await vals({
        personal_data: undefined,
        admin: undefined,
        critical_ops: undefined,
        collaborative: undefined,
        org_separation: undefined,
        realtime: undefined,
        availability: undefined,
      })
    )["pentest_requirement"];
    expect(undecided).toMatch(/^初回のリリースの前に必須（.+）$/);
  });

  it("#34 AC-3: 判定を渡したときは、渡した判定を使う（回答から求め直さない）", async () => {
    const answers = await completeAnswers({ personal_data: "none" });
    const forced = { ...judge(answers), asvsLevel: 3 as const, pentestRequired: true };
    const v = buildValues({ answers, judgment: { ...forced, pentestReasons: ["テスト用の理由"] } });
    expect(v["asvs_level"]).toMatch(/^3/);
    expect(v["pentest_requirement"]).toContain("テスト用の理由");
  });
});

describe("#34 AC-3: DB の回答で変わる値", () => {
  const NOTES = [
    "dev_env_notes",
    "backup_notes",
    "transaction_notes",
    "batch_notes",
    "postgres_migration_notes",
  ];

  it("#34 AC-3: DB なし・D1・PostgreSQL の3通りで、notes の値が変わる（どれも空でない）", async () => {
    const none = await vals(DB.none);
    const d1 = await vals(DB.d1);
    const pg = await vals(DB.postgresql);
    for (const name of NOTES) {
      for (const v of [none, d1, pg]) expect(v[name], name).not.toBe("");
      expect(new Set([none[name], d1[name], pg[name]]).size, name).toBeGreaterThanOrEqual(2);
    }
    expect(
      new Set([none["transaction_notes"], d1["transaction_notes"], pg["transaction_notes"]]).size,
    ).toBe(3);
    expect(d1["postgres_migration_notes"]).not.toBe(pg["postgres_migration_notes"]);
  });

  it("#34 AC-3: D1 では db.batch()、PostgreSQL では db.transaction() の説明になる（transaction_notes）", async () => {
    expect((await vals(DB.d1))["transaction_notes"]).toContain("batch");
    expect((await vals(DB.postgresql))["transaction_notes"]).toContain("transaction");
  });

  it("#34 AC-3: データアクセス：DB ありは Drizzle ORM と Skill「data-access-drizzle」、DB なしは「使わない」", async () => {
    for (const db of [DB.d1, DB.postgresql]) {
      const v = await vals(db);
      expect(v["data_access_library"]).toContain("Drizzle");
      expect(v["data_access_skill"]).toBe("data-access-drizzle");
      expect(v["data_access_guide"]).toContain("data-access-drizzle");
    }
    const none = await vals(DB.none);
    expect(none["data_access_library"]).toBe("使わない");
    expect(none["data_access_skill"]).toBe("使わない");
  });

  it("#34 R6: DB なしの案内の行は、DB を使わないことを書き、データアクセスの Skill を指さない", async () => {
    const guide = (await vals(DB.none))["data_access_guide"] ?? "";
    expect(guide).toMatch(/DB.*使わない|使わない.*DB/);
    expect(guide).not.toContain("data-access");
    expect(guide).not.toContain("Drizzle");
    expect(guide).not.toContain("{{");
  });

  it("#34 AC-3: secrets_table は表の行（| ... |）で、PostgreSQL・認証ありの回答で項目が増える", async () => {
    const lines = (v: Record<string, string>) => (v["secrets_table"] ?? "").split("\n");
    const base = await vals({ ...DB.none, auth: "none", idp: undefined });
    expect(base["secrets_table"]).not.toBe("");
    for (const line of lines(base)) expect(line).toMatch(/^\| .+ \|$/);
    const pg = await vals({ ...DB.postgresql, auth: "none", idp: undefined });
    expect(lines(pg).length).toBeGreaterThan(lines(base).length);
    const oidc = await vals({ ...DB.none, auth: "oidc" });
    expect(lines(oidc).length).toBeGreaterThan(lines(base).length);
  });

  it("#34 AC-3: knowledge_index：DB ありは db の知見の行があり、DB なしはない", async () => {
    expect((await vals(DB.d1))["knowledge_index"]).toContain("index-design");
    const none = (await vals(DB.none))["knowledge_index"] ?? "";
    expect(none).not.toContain("index-design");
    expect(none).toContain("api-response-time");
  });
});

describe("#34 AC-3: 役割とモデル（選んだ AI の分だけ）", () => {
  it("#34 AC-3: Claude だけ：claude_model_*（orchestrator と全役割）がある。Claude のモデルは別名", async () => {
    const v = await vals({ ais: ["claude"] });
    for (const role of ["orchestrator", ...AGENT_ROLES]) {
      expect(v[`claude_model_${role}`], role).toMatch(/^(opus|sonnet|haiku)$/);
    }
  });

  it("#34 AC-3: Codex だけ：codex_model_*・codex_effort_* があり、Claude の値（claude_model_*）は求めない", async () => {
    const v = await vals({ ais: ["codex"] });
    for (const role of AGENT_ROLES) {
      expect(v[`codex_model_${role}`], role).toBeTypeOf("string");
      expect(v[`codex_model_${role}`], role).not.toBe("");
      expect(v[`codex_effort_${role}`], role).toMatch(/^(minimal|low|medium|high|xhigh)$/);
    }
    expect(Object.keys(v).filter((k) => k.startsWith("claude_model_"))).toEqual([]);
  });

  it("#34 AC-3: 両方：Claude の値と Codex の値の両方がある", async () => {
    const v = await vals({ ais: ["claude", "codex"] });
    expect(v["claude_model_planner"]).toBeTruthy();
    expect(v["codex_model_planner"]).toBeTruthy();
    expect(v["codex_effort_planner"]).toBeTruthy();
  });

  it("#34 AC-3: 同じ入力なら同じ値になる", async () => {
    expect(await vals({ ais: ["claude", "codex"] })).toEqual(
      await vals({ ais: ["claude", "codex"] }),
    );
  });
});
