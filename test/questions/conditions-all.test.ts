// #40：質問の条件の all（並べた条件のすべてに合うときだけ合う）と、data_access の「Hono のときだけ聞く」条件、
// --answers で backend・infra を省いたときの互換
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { AnswersError, parseAnswersYaml } from "../../src/questions/answers.js";
import {
  conditionIds,
  matchesCondition,
  questionDefinitions as defs,
  unmetConditionIds,
  type QuestionDefinition,
} from "../../src/questions/definitions.js";
import { runQuestions, runQuestionsResolvingConflicts } from "../../src/questions/flow.js";
import { FakePrompter, baseAnswers } from "./helpers.js";

const both = {
  all: [
    { id: "database", notEquals: "none" },
    { id: "backend", equals: "hono" },
  ],
};

describe("#40: 質問の条件の all", () => {
  it("すべての条件に合うときだけ合う", () => {
    expect(matchesCondition(both, { database: "d1", backend: "hono" })).toBe(true);
    expect(matchesCondition(both, { database: "none", backend: "hono" })).toBe(false);
    expect(matchesCondition(both, { database: "d1", backend: "spring_boot" })).toBe(false);
  });

  it("対象の回答がまだなければ、合わない（今の意味と同じ）", () => {
    expect(matchesCondition(both, { database: "d1" })).toBe(false);
    expect(matchesCondition(both, {})).toBe(false);
  });

  it("1つの質問への条件は、今までどおり判定できる", () => {
    expect(matchesCondition({ id: "database", equals: "d1" }, { database: "d1" })).toBe(true);
    expect(matchesCondition({ id: "database", in: ["d1"] }, { database: "none" })).toBe(false);
  });

  it("conditionIds は条件が見る質問の id を書いた順に返す", () => {
    expect(conditionIds(both)).toEqual(["database", "backend"]);
    expect(conditionIds({ id: "auth", equals: "none" })).toEqual(["auth"]);
  });

  it("unmetConditionIds は合っていない条件の質問の id を返す（すべて合えば空）", () => {
    expect(unmetConditionIds(both, { database: "none", backend: "hono" })).toEqual(["database"]);
    expect(unmetConditionIds(both, { database: "none", backend: "spring_boot" })).toEqual([
      "database",
      "backend",
    ]);
    expect(unmetConditionIds(both, { database: "d1", backend: "hono" })).toEqual([]);
    expect(unmetConditionIds({ id: "auth", equals: "none" }, { auth: "app" })).toEqual(["auth"]);
  });
});

describe("#40: data_access は、backend が hono で DB があるときだけ聞く（決まる）", () => {
  const script = (database: string) => ({
    app_name: ["testapp-001"],
    ais: [["claude"]],
    repository: ["github"],
    visibility: ["private"],
    team_size: ["solo"],
    database: [database],
    postgres_provider: ["neon"],
    check_location: ["both"],
    version_policy: ["verified"],
  });

  it("hono で DB なしのとき、data_access は聞かれず、回答にも入らない", async () => {
    const p = new FakePrompter(script("none"));
    const answers = await runQuestions(defs, p, {});
    expect(answers).not.toHaveProperty("data_access");
    expect(p.askedIds).not.toContain("data_access");
  });

  it("hono で d1 のとき、data_access は drizzle に自動で決まる", async () => {
    const p = new FakePrompter(script("d1"));
    const answers = await runQuestions(defs, p, {});
    expect(answers.backend).toBe("hono");
    expect(answers.data_access).toBe("drizzle");
  });
});

describe("#40: all の条件で聞かなくなった質問に、先に回答が書かれていたとき（flow）", () => {
  const custom = [
    {
      id: "database",
      title: "DB",
      kind: "select",
      options: [
        { value: "d1", label: "D1" },
        { value: "none", label: "なし" },
      ],
    },
    {
      id: "backend",
      title: "バックエンドの技術",
      kind: "select",
      options: [
        { value: "hono", label: "Hono" },
        { value: "other", label: "その他" },
      ],
    },
    {
      id: "data_access",
      title: "データアクセス",
      kind: "select",
      options: [{ value: "drizzle", label: "Drizzle" }],
      when: both,
    },
  ] as unknown as QuestionDefinition[];

  it("合っていない最初の質問を原因にし、その題名を理由に出す", async () => {
    // database は合っている（d1）が、backend が合っていない（other）。原因は backend
    const p = new FakePrompter({
      database: ["d1"],
      backend: ["other"],
      fix_question: ["data_access"],
    });
    await runQuestionsResolvingConflicts(custom, p, { data_access: "drizzle" } as never);
    const note = p.notes.join("\n");
    expect(note).toContain("「バックエンドの技術」の回答により");
    expect(note).not.toContain("「DB」の回答により");
    // 直す質問の候補は、原因（backend）と矛盾している質問（data_access）
    const fix = p.inputs.find((e) => e.id === "fix_question");
    expect(fix?.opts.options.map((o: { value: string }) => o.value)).toEqual([
      "backend",
      "data_access",
    ]);
  });
});

describe("#40: --answers の読み込み（all の条件と、backend・infra を省いた互換）", () => {
  const yaml = (o: Record<string, unknown>) => stringify(o);
  const errorsOf = (text: string): string[] => {
    try {
      parseAnswersYaml(text);
    } catch (e) {
      expect(e).toBeInstanceOf(AnswersError);
      return (e as AnswersError).errors;
    }
    throw new Error("エラーになるはずが、成功しました");
  };

  it("backend・infra を省いた以前の回答ファイル（database: d1・data_access: drizzle）は、そのまま通る", () => {
    const parsed = parseAnswersYaml(
      yaml(baseAnswers({ backend: undefined, database: "d1", data_access: "drizzle" })),
    );
    expect(parsed.answers.data_access).toBe("drizzle");
    // 互換の既定値は、条件の判定にだけ使い、回答には入れない
    expect(parsed.answers).not.toHaveProperty("backend");
    expect(parsed.answers).not.toHaveProperty("infra");
  });

  it("hono・cloudflare を書いたファイルも通る", () => {
    const parsed = parseAnswersYaml(
      yaml(
        baseAnswers({
          backend: "hono",
          infra: "cloudflare",
          database: "d1",
          data_access: "drizzle",
        }),
      ),
    );
    expect(parsed.answers.backend).toBe("hono");
    expect(parsed.answers.infra).toBe("cloudflare");
  });

  it("database: none のとき data_access を書くと、database が原因で「回答を書けません」", () => {
    const errors = errorsOf(yaml(baseAnswers({ database: "none", data_access: "drizzle" })));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("data_access");
    expect(errors[0]).toContain("database の回答によって聞かない質問");
    expect(errors[0]).toContain("回答を書けません");
  });

  it("database を書かずに data_access だけ書いても、判断できないのでエラーにしない（今までと同じ）", () => {
    const parsed = parseAnswersYaml(yaml({ app_name: "testapp-001", data_access: "drizzle" }));
    expect(parsed.answers.data_access).toBe("drizzle");
  });
});

describe("#40: backend に別の値がある定義での --answers（all の原因の選び方）", () => {
  // 今の定義は backend の選択肢が hono だけなので、選択肢を足した定義で、all の条件の判定を確かめる
  const withSpring = defs.map((d) =>
    d.id === "backend"
      ? {
          ...d,
          options: [
            { value: "hono", label: "Hono" },
            { value: "spring_boot", label: "Spring Boot" },
          ],
        }
      : d,
  ) as QuestionDefinition[];
  const parse = (o: Record<string, unknown>) =>
    parseAnswersYaml(stringify(baseAnswers(o)), withSpring);

  it("backend が hono でなければ、data_access を書けない。原因は backend", () => {
    expect(() => parse({ backend: "spring_boot", database: "d1", data_access: "drizzle" })).toThrow(
      /data_access：この質問は、backend の回答によって聞かない質問のため、回答を書けません/,
    );
  });

  it("database が none で backend が hono でないときは、書かれている回答のある質問（database・backend）の最初を原因にする", () => {
    expect(() =>
      parse({ backend: "spring_boot", database: "none", data_access: "drizzle" }),
    ).toThrow(/data_access：この質問は、database の回答によって/);
  });

  it("backend が hono なら通る", () => {
    expect(parse({ backend: "hono", database: "d1", data_access: "drizzle" }).answers.backend).toBe(
      "hono",
    );
  });
});
