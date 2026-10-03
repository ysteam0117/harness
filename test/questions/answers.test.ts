// 想定する型：src/questions/answers.ts
//   export interface Answers { ... }（test/questions/helpers.ts の冒頭を参照）
//   export class AnswersError extends Error { errors: string[] }   // 問題を1件ずつの日本語の文にして、まとめて持つ
//   export interface ParsedAnswers { answers: Partial<Answers>; acceptedWarnings: string[] }   // accepted_warnings: ルールの id の一覧
//   export function parseAnswersYaml(text: string, definitions?: readonly QuestionDefinition[]): ParsedAnswers;
//     - キーは質問の id と accepted_warnings。書いた回答だけを返す（自動で決まる値は補わない）
//     - 次はエラーとして、すべてまとめて AnswersError にする（それぞれの errors の文にキー名を含める）
//       知らないキー／選択肢にない値／型の誤り（multiselect が配列でない等）／multiselect が空／
//       条件に合わない質問への回答／自動で決まる値と違う値（forced・選択肢が1つ）／YAML の構文エラー／トップが連想配列でない
//     - app_name の形はここでは確かめない（整合性チェックのルール9で示す。R2）
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { AnswersError, parseAnswersYaml } from "../../src/questions/answers.js";
import { baseAnswers } from "./helpers.js";

const yaml = (o: Record<string, unknown>) => stringify(o);

function errorsOf(text: string): string[] {
  try {
    parseAnswersYaml(text);
  } catch (e) {
    expect(e).toBeInstanceOf(AnswersError);
    return (e as InstanceType<typeof AnswersError>).errors;
  }
  throw new Error("エラーになるはずが、成功しました");
}

describe("#32 AC-4: --answers の読み込み", () => {
  it("#32 AC-4: 完全な YAML を、書いた回答のとおりに読む。承知した警告は空", () => {
    const parsed = parseAnswersYaml(yaml(baseAnswers()));
    expect(parsed.answers).toEqual(baseAnswers());
    expect(parsed.acceptedWarnings).toEqual([]);
  });

  it("#32 AC-4: 同じ YAML なら、同じ回答になる", () => {
    const text = yaml(baseAnswers({ database: "postgresql", postgres_provider: "neon" }));
    expect(parseAnswersYaml(text)).toEqual(parseAnswersYaml(text));
  });

  it("#32 AC-4: 足りない回答があっても読める（足りない分は対話で聞く）", () => {
    const parsed = parseAnswersYaml(yaml({ app_name: "testapp-001", ais: ["claude"] }));
    expect(parsed.answers).toEqual({ app_name: "testapp-001", ais: ["claude"] });
  });

  it("#32 AC-4: 自動で決まる質問は省略してよい。書いた値が決まる値と同じなら読める", () => {
    const parsed = parseAnswersYaml(yaml(baseAnswers({ project_type: "web", frontend: "react" })));
    expect(parsed.answers).toMatchObject({ project_type: "web", frontend: "react" });
  });

  it("#32 AC-4: auth = none のとき admin: no と書いてもよい（決まる値と同じ）", () => {
    const parsed = parseAnswersYaml(
      yaml(baseAnswers({ auth: "none", idp: undefined, admin: "no" })),
    );
    expect(parsed.answers.admin).toBe("no");
  });

  it("#32 AC-4: accepted_warnings に書いたルールの id を、承知した警告として返す（R1）", () => {
    const parsed = parseAnswersYaml(
      yaml({ ...baseAnswers(), accepted_warnings: ["team-needs-ci", "public-needs-ci"] }),
    );
    expect(parsed.acceptedWarnings).toEqual(["team-needs-ci", "public-needs-ci"]);
    expect(parsed.answers).not.toHaveProperty("accepted_warnings");
  });

  it("#32 AC-4: accepted_warnings が文字列の配列でなければエラー", () => {
    const errors = errorsOf(yaml({ ...baseAnswers(), accepted_warnings: "team-needs-ci" }));
    expect(errors.join("\n")).toContain("accepted_warnings");
  });
});

describe("#32 AC-4: --answers のエラー（まとめて示す）", () => {
  it("#32 AC-4: 知らないキーはエラーで、キー名を含む", () => {
    const errors = errorsOf(yaml({ ...baseAnswers(), colour: "red" }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("colour");
  });

  it("#32 AC-4: 選択肢にない値はエラーで、キー名を含む", () => {
    const errors = errorsOf(yaml(baseAnswers({ visibility: "secret" })));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("visibility");
  });

  it("#32 AC-4: 型の誤り（multiselect に文字列、select に数値）はエラー", () => {
    const errors = errorsOf(yaml(baseAnswers({ ais: "claude", team_size: 3 })));
    expect(errors.some((e) => e.includes("ais"))).toBe(true);
    expect(errors.some((e) => e.includes("team_size"))).toBe(true);
  });

  it("#32 AC-4: multiselect が空配列だとエラー（1つ以上が必須。R6）", () => {
    const errors = errorsOf(yaml(baseAnswers({ ais: [] })));
    expect(errors.some((e) => e.includes("ais"))).toBe(true);
  });

  it("#32 AC-4: 条件に合わない質問への回答はエラー（database = none の postgres_provider）", () => {
    const errors = errorsOf(yaml(baseAnswers({ database: "none", postgres_provider: "neon" })));
    expect(errors.some((e) => e.includes("postgres_provider"))).toBe(true);
  });

  it("#32 AC-4: auth = none のとき、idp を書くとエラー", () => {
    const errors = errorsOf(yaml(baseAnswers({ auth: "none", idp: "google" })));
    expect(errors.some((e) => e.includes("idp"))).toBe(true);
  });

  it("#32 AC-2: auth = none のとき admin: yes は、決まる値（no）と違うのでエラー", () => {
    const errors = errorsOf(yaml(baseAnswers({ auth: "none", idp: undefined, admin: "yes" })));
    expect(errors.some((e) => e.includes("admin"))).toBe(true);
  });

  it("#32 AC-4: 自動で決まる質問に、決まる値と違う値を書くとエラー", () => {
    const errors = errorsOf(yaml(baseAnswers({ infra: "aws" })));
    expect(errors.some((e) => e.includes("infra"))).toBe(true);
  });

  it("#32 AC-4: 複数の誤りは1回の AnswersError にまとめて入る", () => {
    const errors = errorsOf(
      yaml(
        baseAnswers({
          colour: "red",
          visibility: "secret",
          ais: [],
          database: "none",
          postgres_provider: "neon",
          infra: "aws",
        }),
      ),
    );
    expect(errors.length).toBeGreaterThanOrEqual(5);
    for (const key of ["colour", "visibility", "ais", "postgres_provider", "infra"]) {
      expect(errors.some((e) => e.includes(key))).toBe(true);
    }
  });

  it("#32 AC-4: YAML の構文エラーは AnswersError", () => {
    expect(errorsOf("app_name: [unclosed").length).toBeGreaterThan(0);
  });

  it("#32 AC-4: トップが連想配列でない（配列・文字列）YAML は AnswersError", () => {
    expect(errorsOf("- a\n- b\n").length).toBeGreaterThan(0);
    expect(errorsOf("just text\n").length).toBeGreaterThan(0);
  });

  it("#32 AC-4: エラーの文は日本語", () => {
    const errors = errorsOf(yaml({ ...baseAnswers(), colour: "red" }));
    expect(errors[0]).toMatch(/[ぁ-んァ-ヶ一-龠]/);
  });
});

describe("#32 AC-1: app_name の形は読み込みでは確かめない（R2）", () => {
  it("#32 AC-1: 誤ったアプリ名でも読み込みは成功し、整合性チェックのルール9で示す", () => {
    const parsed = parseAnswersYaml(yaml(baseAnswers({ app_name: "Bad_Name" })));
    expect(parsed.answers.app_name).toBe("Bad_Name");
  });
});

describe("#32 AC-2・AC-4: 質問A〜G は --answers に書かれていれば検証して使う", () => {
  it("#32 AC-2: A〜G を書かなくても読める（足りないとは扱わない。値は補わない）", () => {
    const a = baseAnswers() as Record<string, unknown>;
    for (const id of [
      "personal_data",
      "admin",
      "critical_ops",
      "collaborative",
      "org_separation",
      "realtime",
      "availability",
    ])
      delete a[id];
    const parsed = parseAnswersYaml(yaml(a));
    expect(parsed.answers).toEqual(a);
  });

  it("#32 AC-4: A〜G と critical_ops_kinds を書くと、そのまま読める", () => {
    const a = baseAnswers({
      critical_ops: "yes",
      critical_ops_kinds: ["payment", "publish"],
      personal_data: "sensitive",
      availability: "critical",
    });
    expect(parseAnswersYaml(yaml(a as Record<string, unknown>)).answers).toEqual(a);
  });

  it("#32 AC-4: A〜G に選択肢にない値を書くとエラー", () => {
    for (const [id, v] of [
      ["personal_data", "all"],
      ["admin", "maybe"],
      ["availability", "high"],
    ]) {
      expect(
        errorsOf(yaml(baseAnswers({ [id as string]: v }) as Record<string, unknown>)).some((e) =>
          e.includes(id as string),
        ),
      ).toBe(true);
    }
  });

  it("#32 AC-4: critical_ops = yes のとき、critical_ops_kinds を書くなら1つ以上（空配列はエラー）", () => {
    const errors = errorsOf(
      yaml(baseAnswers({ critical_ops: "yes", critical_ops_kinds: [] }) as Record<string, unknown>),
    );
    expect(errors.some((e) => e.includes("critical_ops_kinds"))).toBe(true);
  });

  it("#32 AC-4: critical_ops が yes でないのに critical_ops_kinds を書くとエラー（条件に合わない回答）", () => {
    const errors = errorsOf(
      yaml(
        baseAnswers({ critical_ops: "no", critical_ops_kinds: ["payment"] }) as Record<
          string,
          unknown
        >,
      ),
    );
    expect(errors.some((e) => e.includes("critical_ops_kinds"))).toBe(true);
  });

  it("#32 AC-2: auth = none のとき collaborative: yes はエラー、collaborative: no は読める（B・D は「ない」に決まる）", () => {
    expect(
      errorsOf(
        yaml(
          baseAnswers({ auth: "none", idp: undefined, collaborative: "yes" }) as Record<
            string,
            unknown
          >,
        ),
      ).some((e) => e.includes("collaborative")),
    ).toBe(true);
    expect(
      parseAnswersYaml(
        yaml(
          baseAnswers({ auth: "none", idp: undefined, collaborative: "no" }) as Record<
            string,
            unknown
          >,
        ),
      ).answers.collaborative,
    ).toBe("no");
  });

  // 対話しない質問（質問A〜G）は、書かれていなければ既定値（undecided）として条件を確かめる。
  // critical_ops_kinds を書くなら critical_ops: yes も必要（読み込みの時点でエラー。メッセージに2つの id を含む）
  const kindsCases: [string, Record<string, unknown>][] = [
    ["critical_ops を省く", {}],
    ["critical_ops: undecided", { critical_ops: "undecided" }],
    ["critical_ops: no", { critical_ops: "no" }],
  ];
  for (const [label, extra] of kindsCases) {
    it(`#32 AC-4: ${label}と critical_ops_kinds: [publish] はエラー（critical_ops と critical_ops_kinds を含む日本語のメッセージ）`, () => {
      const a = baseAnswers({ ...extra, critical_ops_kinds: ["publish"] }) as Record<
        string,
        unknown
      >;
      if (Object.keys(extra).length === 0) delete a.critical_ops;
      const errors = errorsOf(yaml(a));
      const hit = errors.find(
        (e) => e.includes("critical_ops_kinds") && e.includes("critical_ops"),
      );
      expect(hit).toBeDefined();
      expect(hit).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    });
  }

  it("#32 AC-4: critical_ops: yes と critical_ops_kinds: [publish] は読める", () => {
    const a = baseAnswers({ critical_ops: "yes", critical_ops_kinds: ["publish"] });
    expect(parseAnswersYaml(yaml(a as Record<string, unknown>)).answers).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// #33 R4：--answers の versions・versions_offline
//
// 想定する型：ParsedAnswers に項目を足す
//   export interface ParsedAnswers {
//     answers: Partial<Answers>; acceptedWarnings: string[];
//     versions?: Record<string, "verified" | "latest">;   // versions: を書いたときだけ（書いてなければ undefined）
//     versionsOffline?: "verified";                        // versions_offline: を書いたときだけ
//   }
//   - versions は「パッケージ名 → verified | latest」。回答（answers）には入れない。accepted_warnings と同じ並びのキー
//   - versions_offline は verified だけ（ネットワークにつながらないとき、検証済みで進めることを承知する）
//   - 次は AnswersError：versions が連想配列でない／値が verified・latest 以外／versions_offline が verified 以外
//     version_policy: verified なのに versions に latest がある（矛盾）
//   - 対象にないパッケージ名の確かめは、対象が回答で決まるため、ここではなく create で行う（create.test の versions の describe）
// ---------------------------------------------------------------------------

describe("#33 R4: versions・versions_offline の読み込みと検証", () => {
  it("#33 R4: versions（一部のパッケージだけ）と versions_offline を読む。回答（answers）には混ぜない", () => {
    const parsed = parseAnswersYaml(
      yaml(
        baseAnswers({
          version_policy: "latest",
          versions: { vitest: "verified", typescript: "latest" },
          versions_offline: "verified",
        }),
      ),
    );
    expect(parsed.versions).toEqual({ vitest: "verified", typescript: "latest" });
    expect(parsed.versionsOffline).toBe("verified");
    expect(parsed.answers).not.toHaveProperty("versions");
    expect(parsed.answers).not.toHaveProperty("versions_offline");
    expect(parsed.answers.version_policy).toBe("latest");
  });

  it("#33 R4: 書いていなければ、versions・versionsOffline は undefined", () => {
    const parsed = parseAnswersYaml(yaml(baseAnswers()));
    expect(parsed.versions).toBeUndefined();
    expect(parsed.versionsOffline).toBeUndefined();
  });

  it("#33 R4: スコープ付きのパッケージ名（@scope/name）をキーにできる", () => {
    const parsed = parseAnswersYaml(
      yaml(
        baseAnswers({
          version_policy: "latest",
          versions: { "@testing-library/user-event": "latest" },
        }),
      ),
    );
    expect(parsed.versions).toEqual({ "@testing-library/user-event": "latest" });
  });

  it("#33 R4: version_policy: verified で versions に verified だけを書くのは矛盾しない", () => {
    const parsed = parseAnswersYaml(
      yaml(baseAnswers({ version_policy: "verified", versions: { vitest: "verified" } })),
    );
    expect(parsed.versions).toEqual({ vitest: "verified" });
  });

  it("#33 R4: 不正な値（verified・latest 以外）はエラー（パッケージ名を示す）", () => {
    const errors = errorsOf(
      yaml(baseAnswers({ version_policy: "latest", versions: { vitest: "newest" } })),
    );
    expect(errors.some((m) => m.includes("versions") && m.includes("vitest"))).toBe(true);
  });

  it("#33 R4: versions が連想配列でない（配列・文字列）とエラー", () => {
    expect(
      errorsOf(yaml(baseAnswers({ versions: ["vitest"] }))).some((m) => m.includes("versions")),
    ).toBe(true);
    expect(
      errorsOf(yaml(baseAnswers({ versions: "latest" }))).some((m) => m.includes("versions")),
    ).toBe(true);
  });

  it("#33 R4: versions_offline が verified 以外（latest・真偽値）だとエラー", () => {
    for (const value of ["latest", true, "yes"]) {
      const errors = errorsOf(yaml(baseAnswers({ versions_offline: value })));
      expect(
        errors.some((m) => m.includes("versions_offline")),
        String(value),
      ).toBe(true);
    }
  });

  it("#33 R4: version_policy: verified なのに、versions に latest を書くと矛盾でエラー（両方のキー名を示す）", () => {
    const errors = errorsOf(
      yaml(baseAnswers({ version_policy: "verified", versions: { vitest: "latest" } })),
    );
    const hit = errors.find((m) => m.includes("version_policy"));
    expect(hit).toBeDefined();
    expect(hit).toContain("versions");
  });

  it("#33 R4: ほかの問題と一緒に、まとめて示される（知らないキーと versions の不正な値）", () => {
    const errors = errorsOf(yaml(baseAnswers({ colour: "red", versions: { vitest: "newest" } })));
    expect(errors.some((m) => m.includes("colour"))).toBe(true);
    expect(errors.some((m) => m.includes("vitest"))).toBe(true);
  });
});
