// 想定する型：src/questions/flow.ts
//   export async function runQuestions(
//     definitions: readonly QuestionDefinition[], prompter: Prompter, initial?: Partial<Answers>,
//   ): Promise<Answers>;
//     - 定義の順に、条件（when）に合う質問だけを聞く。合わない質問は飛ばし、回答に入れない
//     - 選択肢が1つ、または forced の条件に合う質問は、聞かずに決めて prompter.note で「<見出し>：<選択肢の表示>（自動で決定）」と表示する
//     - initial に値がある質問は聞かない。値は定義で確かめ、誤っていれば例外
//     - prompter が CancelledError を投げたら、そのまま投げる
//   export function findMissing(definitions, initial: Partial<Answers>): string[];
//     - initial で足りない（対話なら聞くことになる）質問の id を、定義の順に返す
import { describe, expect, it } from "vitest";
import { findMissing, runQuestions } from "../../src/questions/flow.js";
import {
  questionDefinitions as defs,
  type QuestionDefinition,
} from "../../src/questions/definitions.js";
import { CancelledError } from "../../src/questions/prompter.js";
import { AUTO_VALUES, FakePrompter, baseAnswers } from "./helpers.js";

/** 質問A〜G（対話では聞かない）の、聞かずに決まる値。critical_ops_kinds は回答に入らない */
const UNDECIDED_VALUES = {
  personal_data: "undecided",
  admin: "undecided",
  critical_ops: "undecided",
  collaborative: "undecided",
  org_separation: "undecided",
  realtime: "undecided",
  availability: "undecided",
};
const ASVS_IDS = [
  "personal_data",
  "admin",
  "critical_ops",
  "critical_ops_kinds",
  "collaborative",
  "org_separation",
  "realtime",
  "availability",
];

/** 条件の質問がすべて出る回答の列（質問A〜Gは含まない：対話で聞かないため） */
const fullScript = (): Record<string, unknown[]> => ({
  app_name: ["testapp-001"],
  ais: [["claude", "codex"]],
  visibility: ["public"],
  team_size: ["team"],
  database: ["postgresql"],
  postgres_provider: ["neon"],
  auth: ["oidc"],
  idp: ["google"],
  file_upload: ["yes"],
  file_kinds: [["image"]],
  check_location: ["both"],
  version_policy: ["verified"],
});

const label = (id: string, value: string) =>
  defs.find((d) => d.id === id)?.options?.find((o) => o.value === value)?.label;
const title = (id: string) => defs.find((d) => d.id === id)?.title;

describe("#32 AC-1: 質問の順番と回答", () => {
  it("#32 AC-1: 定義の順に聞かれる（自動で決まる質問は含まれない）", async () => {
    const p = new FakePrompter(fullScript());
    await runQuestions(defs, p, {});
    expect(p.askedIds).toEqual([
      "app_name",
      "ais",
      "visibility",
      "team_size",
      "database",
      "postgres_provider",
      "auth",
      "idp",
      "file_upload",
      "file_kinds",
      "check_location",
      "version_policy",
    ]);
  });

  it("#32 AC-1: 回答が、聞いた値と自動で決めた値だけで作られる", async () => {
    const answers = await runQuestions(defs, new FakePrompter(fullScript()), {});
    expect(answers).toEqual({
      app_name: "testapp-001",
      ais: ["claude", "codex"],
      visibility: "public",
      team_size: "team",
      database: "postgresql",
      postgres_provider: "neon",
      auth: "oidc",
      idp: "google",
      ...UNDECIDED_VALUES, // 質問A〜Gは聞かず「未定」
      file_upload: "yes",
      file_kinds: ["image"],
      check_location: "both",
      version_policy: "verified",
      ...AUTO_VALUES,
    });
  });

  for (const id of [
    "project_type",
    "layers",
    "frontend",
    "backend",
    "infra",
    "data_access",
  ] as const) {
    it(`#32 AC-1: ${id} は聞かれず、「見出し：選択肢（自動で決定）」と表示される`, async () => {
      const p = new FakePrompter(fullScript());
      const answers = await runQuestions(defs, p, {});
      expect(p.askedIds).not.toContain(id);
      expect(answers[id]).toBe(AUTO_VALUES[id]);
      const expected = `${title(id)}：${label(id, AUTO_VALUES[id])}（自動で決定）`;
      expect(p.notes.some((n) => n.includes(expected))).toBe(true);
    });
  }

  it("#32 AC-1: 自動で決まる質問ではない質問は「自動で決定」と表示されない", async () => {
    const p = new FakePrompter(fullScript());
    await runQuestions(defs, p, {});
    expect(p.notes.filter((n) => n.includes("（自動で決定）")).length).toBe(6);
  });

  it("#32 AC-1: 表示（note）は入力のメソッドとして記録されない", async () => {
    const p = new FakePrompter(fullScript());
    await runQuestions(defs, p, {});
    expect(p.inputs.every((e) => e.method !== undefined)).toBe(true);
    expect(p.notes.length).toBeGreaterThan(0);
  });
});

describe("#32 AC-1: 条件の質問", () => {
  it("#32 AC-1: database = d1 のとき postgres_provider は聞かれず、回答にない。data_access は決まる", async () => {
    const script = fullScript();
    delete script.postgres_provider;
    const p = new FakePrompter({ ...script, database: ["d1"] });
    const answers = await runQuestions(defs, p, {});
    expect(p.askedIds).not.toContain("postgres_provider");
    expect(answers).not.toHaveProperty("postgres_provider");
    expect(answers.data_access).toBe("drizzle");
  });

  it("#32 AC-1: database = none のとき postgres_provider は回答になく、data_access も決まらず表示されない", async () => {
    const script = fullScript();
    delete script.postgres_provider;
    const p = new FakePrompter({ ...script, database: ["none"] });
    const answers = await runQuestions(defs, p, {});
    expect(answers).not.toHaveProperty("postgres_provider");
    expect(answers).not.toHaveProperty("data_access");
    expect(p.notes.some((n) => n.includes(title("data_access") ?? "未定義"))).toBe(false);
  });

  it("#32 AC-1: auth が oidc・both のときだけ idp を聞く（none・app では聞かない）", async () => {
    for (const [auth, asked] of [
      ["oidc", true],
      ["both", true],
      ["app", false],
      ["none", false],
    ] as const) {
      const script: Record<string, unknown[]> = { ...fullScript(), auth: [auth] };
      if (!asked) delete script.idp;
      if (auth === "none") {
        delete script.admin;
        delete script.collaborative;
      }
      const p = new FakePrompter(script);
      const answers = await runQuestions(defs, p, {});
      expect(p.askedIds.includes("idp")).toBe(asked);
      expect(answers.idp !== undefined).toBe(asked);
    }
  });

  it("#32 AC-2: 質問A〜G（critical_ops_kinds を含む）は、どの回答でも一度も聞かれない", async () => {
    const p = new FakePrompter(fullScript());
    await runQuestions(defs, p, {});
    for (const id of ASVS_IDS) expect(p.askedIds).not.toContain(id);
    expect(p.inputs.every((e) => !ASVS_IDS.includes(e.id ?? ""))).toBe(true);
  });

  it("#32 AC-1: file_upload = yes のときだけ file_kinds を聞く", async () => {
    const script: Record<string, unknown[]> = { ...fullScript(), file_upload: ["no"] };
    delete script.file_kinds;
    const p = new FakePrompter(script);
    const answers = await runQuestions(defs, p, {});
    expect(p.askedIds).not.toContain("file_kinds");
    expect(answers).not.toHaveProperty("file_kinds");
  });
});

describe("#32 AC-1: 聞き方（Prompter に渡す内容）", () => {
  it("#32 AC-1: app_name は text で、入力の確かめを渡す。誤った名前は拒否され、入力し直しになる", async () => {
    const p = new FakePrompter({ ...fullScript(), app_name: ["Bad_Name", "-abc", "testapp-001"] });
    const answers = await runQuestions(defs, p, {});
    expect(p.inputs[0]?.method).toBe("text");
    expect(p.rejections.map((r) => r.value)).toEqual(["Bad_Name", "-abc"]);
    expect(answers.app_name).toBe("testapp-001");
  });

  it("#32 AC-1: auth の初期値は oidc", async () => {
    const p = new FakePrompter(fullScript());
    await runQuestions(defs, p, {});
    const call = p.inputs.find((e) => e.id === "auth");
    expect(call?.method).toBe("select");
    expect(call?.opts.initialValue).toBe("oidc");
  });

  it("#32 AC-1: select には定義の選択肢（値と日本語の表示）をそのまま渡す", async () => {
    const p = new FakePrompter(fullScript());
    await runQuestions(defs, p, {});
    const call = p.inputs.find((e) => e.id === "database");
    expect(call?.opts.options.map((o: { value: string }) => o.value)).toEqual([
      "d1",
      "postgresql",
      "none",
    ]);
    expect(call?.opts.options[0].label).toContain("（標準）");
  });

  it("#32 AC-1: multiselect（ais・file_kinds）は1つ以上を必須にして渡す（R6）", async () => {
    const p = new FakePrompter(fullScript());
    await runQuestions(defs, p, {});
    for (const id of ["ais", "file_kinds"]) {
      const call = p.inputs.find((e) => e.id === id);
      expect(call?.method).toBe("multiselect");
      expect(call?.opts.required).toBe(true);
    }
  });

  it("#32 AC-1: 質問の見出しを message に使う", async () => {
    const p = new FakePrompter(fullScript());
    await runQuestions(defs, p, {});
    for (const e of p.inputs) {
      expect(e.message).toContain(title(e.id ?? "") ?? "未定義");
    }
  });
});

describe("#32 AC-2: 質問A〜G は聞かずに「未定」とする（利用者の判断で仕様変更）", () => {
  it("#32 AC-2: 質問A〜G は聞かれず、回答は「undecided」になる（critical_ops_kinds は回答に入らない）", async () => {
    const p = new FakePrompter(fullScript());
    const answers = await runQuestions(defs, p, {});
    for (const id of ASVS_IDS) expect(p.askedIds).not.toContain(id);
    expect(answers).toMatchObject(UNDECIDED_VALUES);
    expect(answers).not.toHaveProperty("critical_ops_kinds");
  });

  it("#32 AC-2: 「未定（要件定義で決める）」と表示される（1行でまとめてよい）", async () => {
    const p = new FakePrompter(fullScript());
    await runQuestions(defs, p, {});
    expect(p.notes.some((n) => n.includes("未定（要件定義で決める）"))).toBe(true);
  });

  it("#32 AC-2: auth = none のとき admin・collaborative は「no」になり、「（自動で決定）」と表示される。ほかは「undecided」", async () => {
    const script: Record<string, unknown[]> = { ...fullScript(), auth: ["none"] };
    delete script.idp;
    const p = new FakePrompter(script);
    const answers = await runQuestions(defs, p, {});
    expect(answers.admin).toBe("no");
    expect(answers.collaborative).toBe("no");
    expect(answers).toMatchObject({
      personal_data: "undecided",
      critical_ops: "undecided",
      org_separation: "undecided",
      realtime: "undecided",
      availability: "undecided",
    });
    for (const id of ["admin", "collaborative"]) {
      expect(
        p.notes.some((n) => n.includes(`${title(id)}：${label(id, "no")}（自動で決定）`)),
      ).toBe(true);
    }
    for (const id of ASVS_IDS) expect(p.askedIds).not.toContain(id);
  });

  it("#32 AC-2: auth = app のとき admin・collaborative は「undecided」（聞かない）", async () => {
    const script: Record<string, unknown[]> = { ...fullScript(), auth: ["app"] };
    delete script.idp;
    const p = new FakePrompter(script);
    const answers = await runQuestions(defs, p, {});
    expect(answers.admin).toBe("undecided");
    expect(answers.collaborative).toBe("undecided");
  });
});

describe("#32 AC-4: 回答が渡されている質問（--answers）", () => {
  it("#32 AC-4: すべての回答が渡されると、入力のメソッドは一度も呼ばれず、自動の値が補われる", async () => {
    const p = new FakePrompter({});
    const answers = await runQuestions(defs, p, baseAnswers());
    expect(p.inputs).toHaveLength(0);
    expect(answers).toEqual({ ...baseAnswers(), ...AUTO_VALUES });
  });

  it("#32 AC-4: A〜G を書かない YAML では、聞かずに「undecided」になる（auth = none なら admin・collaborative は no）", async () => {
    const initial = baseAnswers() as Record<string, unknown>;
    for (const id of ASVS_IDS) delete initial[id];
    const p = new FakePrompter({});
    const answers = await runQuestions(defs, p, initial as never);
    expect(p.inputs).toHaveLength(0);
    expect(answers).toMatchObject(UNDECIDED_VALUES);
    const none = await runQuestions(defs, new FakePrompter({}), {
      ...initial,
      auth: "none",
      idp: undefined,
    } as never);
    expect(none).toMatchObject({ admin: "no", collaborative: "no", personal_data: "undecided" });
  });

  it("#32 AC-4: A〜G を書いた YAML は、検証して使う（critical_ops_kinds も入る）", async () => {
    const initial = baseAnswers({
      personal_data: "basic",
      admin: "yes",
      critical_ops: "yes",
      critical_ops_kinds: ["publish"],
      collaborative: "no",
      org_separation: "yes",
      realtime: "no",
      availability: "critical",
    });
    const p = new FakePrompter({});
    const answers = await runQuestions(defs, p, initial);
    expect(p.inputs).toHaveLength(0);
    expect(answers).toMatchObject(initial);
  });

  it("#32 AC-4: 足りない質問だけ聞く", async () => {
    const initial = baseAnswers();
    delete (initial as Record<string, unknown>).team_size;
    const p = new FakePrompter({ team_size: ["team"] });
    const answers = await runQuestions(defs, p, initial);
    expect(p.askedIds).toEqual(["team_size"]);
    expect(answers.team_size).toBe("team");
  });

  it("#32 AC-4: 同じ回答なら同じ結果になる", async () => {
    const a = await runQuestions(defs, new FakePrompter({}), baseAnswers());
    const b = await runQuestions(defs, new FakePrompter({}), baseAnswers());
    expect(a).toEqual(b);
  });

  it("#32 AC-4: 渡された回答が定義の選択肢にないと、例外になる", async () => {
    await expect(
      runQuestions(defs, new FakePrompter({}), baseAnswers({ database: "mysql" })),
    ).rejects.toThrow();
  });

  it("#32 AC-4: findMissing は足りない質問の id を定義の順に返す", () => {
    expect(findMissing(defs, baseAnswers())).toEqual([]);
    const noTeam = baseAnswers();
    delete (noTeam as Record<string, unknown>).team_size;
    expect(findMissing(defs, noTeam)).toEqual(["team_size"]);
    expect(findMissing(defs, baseAnswers({ database: "postgresql" }))).toEqual([
      "postgres_provider",
    ]);
    const authNone = baseAnswers({ auth: "none" });
    delete (authNone as Record<string, unknown>).idp;
    delete (authNone as Record<string, unknown>).admin; // auth = none なら聞かない（足りなくない）
    expect(findMissing(defs, authNone)).toEqual([]);
    // A〜G（critical_ops = yes で critical_ops_kinds がない場合を含む）は、足りない回答として扱わない
    const noAsvs = baseAnswers({ critical_ops: "yes" }) as Record<string, unknown>;
    for (const id of [
      "personal_data",
      "admin",
      "collaborative",
      "org_separation",
      "realtime",
      "availability",
    ])
      delete noAsvs[id];
    expect(findMissing(defs, noAsvs as never)).toEqual([]);
  });
});

describe("#32 AC-5: 中断", () => {
  it("#32 AC-5: 途中で CancelledError になると、そのまま投げられ、それ以降の質問は聞かれない", async () => {
    const p = new FakePrompter({
      app_name: ["testapp-001"],
      ais: [["claude"]],
      visibility: [new CancelledError()],
    });
    await expect(runQuestions(defs, p, {})).rejects.toBeInstanceOf(CancelledError);
    expect(p.askedIds).toEqual(["app_name", "ais", "visibility"]);
  });
});

describe("#32 AC-1: 質問の追加は定義の追加だけで済む（C-38）", () => {
  const custom = [
    {
      id: "color",
      title: "色",
      kind: "select",
      options: [
        { value: "red", label: "赤" },
        { value: "blue", label: "青" },
      ],
    },
    {
      id: "shade",
      title: "濃さ",
      kind: "select",
      options: [
        { value: "dark", label: "濃い" },
        { value: "light", label: "薄い" },
      ],
      when: { id: "color", equals: "red" },
    },
    {
      id: "size",
      title: "大きさ",
      kind: "select",
      options: [{ value: "m", label: "中" }],
    },
  ] as unknown as QuestionDefinition[];

  it("#32 AC-1: 独自の定義の配列でも、条件・自動決定が同じように働く", async () => {
    const p = new FakePrompter({ color: ["red"], shade: ["dark"] });
    const answers = (await runQuestions(custom, p, {})) as unknown as Record<string, string>;
    expect(answers).toEqual({ color: "red", shade: "dark", size: "m" });
    expect(p.notes.some((n) => n.includes("大きさ：中（自動で決定）"))).toBe(true);

    const p2 = new FakePrompter({ color: ["blue"] });
    const answers2 = (await runQuestions(custom, p2, {})) as unknown as Record<string, string>;
    expect(answers2).toEqual({ color: "blue", size: "m" });
  });
});
