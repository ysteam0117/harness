// 想定する型：src/checks/review.ts（チェック → 警告の承知 → エラーの聞き直し。R1・R3）
//   export interface AcceptedWarning { id: string; message: string; reason: string }   // #34 が ADR に書く
//   export interface ReviewOptions {
//     definitions?: readonly QuestionDefinition[];           // 既定は questionDefinitions
//     rules: Rule[];
//     prompter: Prompter;
//     answers: Answers;                                      // runQuestions の結果
//     collectFacts: (answers: Answers) => Promise<Facts>;    // 聞き直すたびに呼び直す（生成先はアプリ名から決め直す）
//     interactive: boolean;                                  // false のときは prompter を一度も使わない
//     acceptedWarningIds?: string[];                         // --answers の accepted_warnings
//   }
//   export type ReviewOutcome =
//     | { status: "ok"; answers: Answers; result: CheckResult; acceptedWarnings: AcceptedWarning[] }
//     | { status: "errors"; answers: Answers; result: CheckResult }                 // 対話しないときに、エラーがある
//     | { status: "warnings_not_accepted"; answers: Answers; result: CheckResult }  // 対話しないときに、承知していない警告がある
//     | { status: "declined"; answers: Answers; result: CheckResult };              // 対話で、警告の承知を断った
//   export async function reviewAnswers(opts: ReviewOptions): Promise<ReviewOutcome>;
//
// 対話のときの入力の id：
//   エラー：select "fix_question"（選択肢の値は、当たったエラーの fix の質問の id）→ その質問と依存する質問の回答を消す →
//           runQuestions をもう一度走らせる → collectFacts → 判定し直す。依存は定義の条件（when・forced）から自動で求める
//   警告：confirm "accept_warning:<ルールの id>"（警告ごと。承知した順でなく、ルールの並びの順）。偽なら declined
//   情報：入力なし
import { describe, expect, it, vi } from "vitest";
import { reviewAnswers } from "../../src/checks/review.js";
import { loadRules, type Facts } from "../../src/checks/rules.js";
import type { Answers } from "../../src/questions/answers.js";
import { AUTO_VALUES, FakePrompter, baseAnswers } from "../questions/helpers.js";

const rules = loadRules();
const NO_FACTS: Facts = {
  versions_newer_than_verified: false,
  missing_tools: [],
  target_dir_not_empty: false,
  invalid_app_name: false,
};

const full = (over: Record<string, unknown> = {}): Answers =>
  ({ ...baseAnswers(over), ...AUTO_VALUES }) as unknown as Answers;

/** database を none にしたときは data_access を持たない */
const fullNoDb = (over: Record<string, unknown> = {}): Answers => {
  const a = full({ database: "none", ...over }) as unknown as Record<string, unknown>;
  delete a.data_access;
  return a as unknown as Answers;
};

const noFacts = async () => NO_FACTS;

describe("#32 AC-3: 警告・情報の扱い（対話しない）", () => {
  it("#32 AC-3: 問題がなければ ok で、承知した警告は空。入力は使わない", async () => {
    const p = new FakePrompter({});
    const out = await reviewAnswers({
      rules,
      prompter: p,
      answers: full(),
      collectFacts: noFacts,
      interactive: false,
    });
    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(out.acceptedWarnings).toEqual([]);
      expect(out.result.errors).toEqual([]);
    }
    expect(p.inputs).toHaveLength(0);
  });

  it("#32 AC-3: 情報だけなら ok で、結果の infos に入る", async () => {
    const out = await reviewAnswers({
      rules,
      prompter: new FakePrompter({}),
      answers: full({ database: "postgresql", postgres_provider: "neon" }),
      collectFacts: noFacts,
      interactive: false,
    });
    expect(out.status).toBe("ok");
    expect(out.result.infos.map((h) => h.id)).toEqual(["postgresql-needs-service"]);
  });

  it("#32 AC-3: 警告があり、accepted_warnings で承知していなければ warnings_not_accepted（R1）", async () => {
    const p = new FakePrompter({});
    const out = await reviewAnswers({
      rules,
      prompter: p,
      answers: full({ team_size: "team", check_location: "local" }),
      collectFacts: noFacts,
      interactive: false,
    });
    expect(out.status).toBe("warnings_not_accepted");
    expect(out.result.warnings.map((h) => h.id)).toEqual(["team-needs-ci"]);
    expect(p.inputs).toHaveLength(0);
  });

  it("#32 AC-3: accepted_warnings に書いた id の警告は承知したものとなり、acceptedWarnings に id・メッセージ・理由が入る", async () => {
    const out = await reviewAnswers({
      rules,
      prompter: new FakePrompter({}),
      answers: full({ team_size: "team", check_location: "local" }),
      collectFacts: noFacts,
      interactive: false,
      acceptedWarningIds: ["team-needs-ci"],
    });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    const rule = rules.find((r) => r.id === "team-needs-ci");
    expect(out.acceptedWarnings).toEqual([
      { id: "team-needs-ci", message: rule?.message, reason: rule?.reason },
    ]);
  });

  it("#32 AC-3: 警告が2件あり、片方だけ承知していると warnings_not_accepted。両方なら ok で、ルールの並びの順に記録される", async () => {
    const answers = full({ team_size: "team", visibility: "public", check_location: "local" });
    const partial = await reviewAnswers({
      rules,
      prompter: new FakePrompter({}),
      answers,
      collectFacts: noFacts,
      interactive: false,
      acceptedWarningIds: ["public-needs-ci"],
    });
    expect(partial.status).toBe("warnings_not_accepted");

    const both = await reviewAnswers({
      rules,
      prompter: new FakePrompter({}),
      answers,
      collectFacts: noFacts,
      interactive: false,
      acceptedWarningIds: ["public-needs-ci", "team-needs-ci"],
    });
    expect(both.status).toBe("ok");
    if (both.status === "ok") {
      expect(both.acceptedWarnings.map((w) => w.id)).toEqual(["team-needs-ci", "public-needs-ci"]);
    }
  });

  it("#32 AC-3: 承知を書いていても、当たらなかった警告は記録しない", async () => {
    const out = await reviewAnswers({
      rules,
      prompter: new FakePrompter({}),
      answers: full(),
      collectFacts: noFacts,
      interactive: false,
      acceptedWarningIds: ["team-needs-ci"],
    });
    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.acceptedWarnings).toEqual([]);
  });

  it("#32 AC-3: 事実から来る警告（ルール8・手元の道具）も同じように扱われる", async () => {
    const facts: Facts = { ...NO_FACTS, missing_tools: ["docker：見つかりません"] };
    const out = await reviewAnswers({
      rules,
      prompter: new FakePrompter({}),
      answers: full(),
      collectFacts: async () => facts,
      interactive: false,
    });
    expect(out.status).toBe("warnings_not_accepted");
    expect(out.result.warnings.map((h) => h.id)).toEqual(["missing-tools"]);
  });
});

describe("#32 AC-3: エラー（対話しない）", () => {
  it("#32 AC-3: エラーがあれば errors で、結果にエラーが入る。入力は使わない", async () => {
    const p = new FakePrompter({});
    const out = await reviewAnswers({
      rules,
      prompter: p,
      answers: fullNoDb({ auth: "app", idp: undefined }),
      collectFacts: noFacts,
      interactive: false,
      acceptedWarningIds: ["team-needs-ci"],
    });
    expect(out.status).toBe("errors");
    expect(out.result.errors.map((h) => h.id)).toEqual(["auth-needs-db"]);
    expect(p.inputs).toHaveLength(0);
  });
});

describe("#32 AC-3: 警告の承知（対話）", () => {
  const warnAnswers = () => full({ team_size: "team", check_location: "local" });

  it("#32 AC-3: 警告ごとに確かめ、承知すると acceptedWarnings に入る", async () => {
    const p = new FakePrompter({ "accept_warning:team-needs-ci": [true] });
    const out = await reviewAnswers({
      rules,
      prompter: p,
      answers: warnAnswers(),
      collectFacts: noFacts,
      interactive: true,
    });
    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(out.acceptedWarnings.map((w) => w.id)).toEqual(["team-needs-ci"]);
      expect(out.acceptedWarnings[0]?.reason).toBeTruthy();
    }
    expect(p.inputs.map((e) => [e.method, e.id])).toEqual([
      ["confirm", "accept_warning:team-needs-ci"],
    ]);
    expect(p.inputs[0]?.message).toContain("承知");
  });

  it("#32 AC-3: 承知しないと declined（終了）で、acceptedWarnings は返らない", async () => {
    const p = new FakePrompter({ "accept_warning:team-needs-ci": [false] });
    const out = await reviewAnswers({
      rules,
      prompter: p,
      answers: warnAnswers(),
      collectFacts: noFacts,
      interactive: true,
    });
    expect(out.status).toBe("declined");
    expect(out).not.toHaveProperty("acceptedWarnings");
  });

  it("#32 AC-3: 警告が2件のとき、1件目を承知して2件目を断ると declined", async () => {
    const p = new FakePrompter({
      "accept_warning:team-needs-ci": [true],
      "accept_warning:public-needs-ci": [false],
    });
    const out = await reviewAnswers({
      rules,
      prompter: p,
      answers: full({ team_size: "team", visibility: "public", check_location: "local" }),
      collectFacts: noFacts,
      interactive: true,
    });
    expect(out.status).toBe("declined");
    expect(p.askedIds).toEqual(["accept_warning:team-needs-ci", "accept_warning:public-needs-ci"]);
  });

  it("#32 AC-3: 情報は入力を求めない", async () => {
    const p = new FakePrompter({});
    const out = await reviewAnswers({
      rules,
      prompter: p,
      answers: full({ database: "postgresql", postgres_provider: "neon" }),
      collectFacts: noFacts,
      interactive: true,
    });
    expect(out.status).toBe("ok");
    expect(p.inputs).toHaveLength(0);
  });
});

describe("#32 AC-3: エラーの聞き直し（対話。R3）", () => {
  it("#32 AC-3: fix の質問から選ぶ。選択肢は当たったエラーの fix と同じ", async () => {
    const p = new FakePrompter({
      fix_question: ["database"],
      database: ["d1"],
    });
    await reviewAnswers({
      rules,
      prompter: p,
      answers: fullNoDb({ auth: "app", idp: undefined }),
      collectFacts: noFacts,
      interactive: true,
    });
    const call = p.inputs.find((e) => e.id === "fix_question");
    expect(call?.method).toBe("select");
    const expected = rules.find((r) => r.id === "auth-needs-db")?.fix;
    expect(call?.opts.options.map((o: { value: string }) => o.value)).toEqual(expected);
  });

  it("#32 AC-3: DB を none → postgresql に直すと postgres_provider を聞き、ほかの質問は聞き直さない。エラーが消えて ok になる", async () => {
    const p = new FakePrompter({
      fix_question: ["database"],
      database: ["postgresql"],
      postgres_provider: ["neon"],
    });
    const out = await reviewAnswers({
      rules,
      prompter: p,
      answers: fullNoDb({ auth: "app", idp: undefined }),
      collectFacts: noFacts,
      interactive: true,
    });
    expect(out.status).toBe("ok");
    expect(out.answers.database).toBe("postgresql");
    expect(out.answers.postgres_provider).toBe("neon");
    expect(out.answers.data_access).toBe("drizzle");
    expect(out.answers.app_name).toBe("testapp-001");
    expect(p.askedIds).toEqual(["fix_question", "database", "postgres_provider"]);
    expect(out.result.errors).toEqual([]);
    expect(out.result.infos.map((h) => h.id)).toEqual(["postgresql-needs-service"]);
  });

  it("#79 AC-3: auth を直すと（auth は対話で聞かない）、auth は「未定」に戻り、idp が消え、admin・collaborative も未定（要件定義で決める）に戻る。エラーが消えて ok になる", async () => {
    // auth = both（idp あり）・admin・collaborative = yes・database = none → ルール1のエラー
    const p = new FakePrompter({ fix_question: ["auth"] });
    const out = await reviewAnswers({
      rules,
      prompter: p,
      answers: fullNoDb({ auth: "both", idp: "google", admin: "yes", collaborative: "yes" }),
      collectFacts: noFacts,
      interactive: true,
    });
    expect(out.status).toBe("ok");
    expect(out.answers.auth).toBe("undecided");
    expect(out.answers).not.toHaveProperty("idp");
    expect(out.answers.admin).toBe("undecided");
    expect(out.answers.collaborative).toBe("undecided");
    expect(p.askedIds).toEqual(["fix_question"]);
  });

  it("#32 AC-3: app_name を直すと、事実を集め直して生成先の判定が変わる（invalid → 既存 → 解消）", async () => {
    const collect = vi.fn(async (a: Answers): Promise<Facts> => ({
      ...NO_FACTS,
      invalid_app_name: a.app_name === "Bad_Name",
      target_dir_not_empty: a.app_name === "testapp-exists",
    }));
    const p = new FakePrompter({
      fix_question: ["app_name", "app_name"],
      app_name: ["testapp-exists", "testapp-001"],
    });
    const out = await reviewAnswers({
      rules,
      prompter: p,
      answers: full({ app_name: "Bad_Name" }),
      collectFacts: collect,
      interactive: true,
    });
    expect(out.status).toBe("ok");
    expect(out.answers.app_name).toBe("testapp-001");
    expect(collect.mock.calls.map((c) => c[0].app_name)).toEqual([
      "Bad_Name",
      "testapp-exists",
      "testapp-001",
    ]);
    expect(p.askedIds).toEqual(["fix_question", "app_name", "fix_question", "app_name"]);
  });

  it("#32 AC-3: エラーが残っている間は、聞き直しを繰り返す。途中で CancelledError なら投げる", async () => {
    const { CancelledError } = await import("../../src/questions/prompter.js");
    const p = new FakePrompter({ fix_question: [new CancelledError()] });
    await expect(
      reviewAnswers({
        rules,
        prompter: p,
        answers: fullNoDb({ auth: "app", idp: undefined }),
        collectFacts: noFacts,
        interactive: true,
      }),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it("#32 AC-3: 聞き直しの後に警告が残っていれば、続けて承知を確かめる", async () => {
    const p = new FakePrompter({
      fix_question: ["database"],
      database: ["d1"],
      "accept_warning:team-needs-ci": [true],
    });
    const out = await reviewAnswers({
      rules,
      prompter: p,
      answers: fullNoDb({
        auth: "app",
        idp: undefined,
        team_size: "team",
        check_location: "local",
      }),
      collectFacts: noFacts,
      interactive: true,
    });
    expect(out.status).toBe("ok");
    if (out.status === "ok")
      expect(out.acceptedWarnings.map((w) => w.id)).toEqual(["team-needs-ci"]);
    expect(p.askedIds).toEqual(["fix_question", "database", "accept_warning:team-needs-ci"]);
  });
});

describe("#32 AC-1: 依存する質問は定義から自動で求める（C-38）", () => {
  it("#32 AC-1: 独自の定義でも、直した質問に依存する質問（when）の回答が消えて聞き直される", async () => {
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
    ];
    const customRules = (await import("../../src/checks/rules.js")).parseRules(
      `
- id: red-dark
  level: error
  when:
    all:
      - { answer: color, equals: red }
      - { answer: shade, equals: dark }
  message: 赤で濃いのは不可です
  reason: テストの理由です
  fix: [color, shade]
`,
      custom as never,
    );
    const p = new FakePrompter({ fix_question: ["color"], color: ["red"], shade: ["light"] });
    const out = await reviewAnswers({
      definitions: custom as never,
      rules: customRules,
      prompter: p,
      answers: { color: "red", shade: "dark" } as unknown as Answers,
      collectFacts: noFacts,
      interactive: true,
    });
    expect(out.status).toBe("ok");
    expect((out.answers as unknown as Record<string, string>).shade).toBe("light");
    expect(p.askedIds).toEqual(["fix_question", "color", "shade"]);
  });
});
