// #61 AC-1：リポジトリの置き場所の質問（C-83）。「使わない」を選ぶと、公開範囲と品質チェックの実行場所を聞かずに決める
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { evaluateRules, loadRules, type Facts } from "../../src/checks/rules.js";
import { AnswersError, parseAnswersYaml } from "../../src/questions/answers.js";
import { questionDefinitions as defs } from "../../src/questions/definitions.js";
import { findMissing, runQuestions } from "../../src/questions/flow.js";
import { FakePrompter, baseAnswers } from "./helpers.js";

const NO_FACTS: Facts = {
  versions_newer_than_verified: false,
  missing_tools: [],
  target_dir_not_empty: false,
  invalid_app_name: false,
};
const rules = loadRules();
const hitIds = (answers: Record<string, unknown>) => {
  const r = evaluateRules(rules, baseAnswers(answers), NO_FACTS);
  return [...r.errors, ...r.warnings, ...r.infos].map((h) => h.id);
};

function errorsOf(text: string): string[] {
  try {
    parseAnswersYaml(text);
  } catch (e) {
    expect(e).toBeInstanceOf(AnswersError);
    return (e as AnswersError).errors;
  }
  throw new Error("エラーになるはずが、成功しました");
}

describe("#61 AC-1: 質問 repository", () => {
  it("#61 AC-1: layers の後・visibility の前にあり、GitHub と「使わない」を選べる。初期値は GitHub", () => {
    const ids = defs.map((d) => d.id);
    expect(ids.indexOf("repository")).toBe(ids.indexOf("layers") + 1);
    expect(ids.indexOf("repository")).toBe(ids.indexOf("visibility") - 1);
    const def = defs.find((d) => d.id === "repository");
    expect(def?.options?.map((o) => o.value)).toEqual(["github", "local"]);
    expect(def?.initialValue).toBe("github");
  });

  it("#61 AC-1: local を選ぶと、visibility・check_location を聞かずに private・local にする", async () => {
    const p = new FakePrompter({
      app_name: ["testapp-001"],
      ais: [["claude"]],
      repository: ["local"],
      team_size: ["solo"],
      database: ["d1"],
      auth: ["oidc"],
      idp: ["google"],
      file_upload: ["no"],
      version_policy: ["verified"],
    });
    const answers = await runQuestions(defs, p, {});
    expect(p.askedIds).not.toContain("visibility");
    expect(p.askedIds).not.toContain("check_location");
    expect(answers.repository).toBe("local");
    expect(answers.visibility).toBe("private");
    expect(answers.check_location).toBe("local");
    expect(p.notes.some((n) => n.includes("自動で決定") && n.includes("非公開"))).toBe(true);
  });

  it("#61 AC-1: github を選ぶと、visibility・check_location を聞く", async () => {
    const p = new FakePrompter({
      app_name: ["testapp-001"],
      ais: [["claude"]],
      repository: ["github"],
      visibility: ["public"],
      team_size: ["solo"],
      database: ["d1"],
      auth: ["oidc"],
      idp: ["google"],
      file_upload: ["no"],
      check_location: ["both"],
      version_policy: ["verified"],
    });
    await runQuestions(defs, p, {});
    expect(p.askedIds).toContain("visibility");
    expect(p.askedIds).toContain("check_location");
  });

  it("#61 AC-1: --answers で local と書き、visibility を省くと、足りない質問に出ない", () => {
    const answers = baseAnswers({ repository: "local" }) as Record<string, unknown>;
    delete answers["visibility"];
    delete answers["check_location"];
    expect(findMissing(defs, answers)).toEqual([]);
  });

  it("#61 AC-1: --answers で local と public（または both）を書くとエラー", () => {
    const publicErrors = errorsOf(
      stringify(
        baseAnswers({ repository: "local", visibility: "public", check_location: "local" }),
      ),
    );
    expect(publicErrors.some((e) => e.includes("visibility"))).toBe(true);
    const bothErrors = errorsOf(
      stringify(
        baseAnswers({ repository: "local", visibility: "private", check_location: "both" }),
      ),
    );
    expect(bothErrors.some((e) => e.includes("check_location"))).toBe(true);
  });

  it("#61 AC-1: --answers で local と private・local を書くと読める", () => {
    const parsed = parseAnswersYaml(
      stringify(
        baseAnswers({ repository: "local", visibility: "private", check_location: "local" }),
      ),
    );
    expect(parsed.answers.repository).toBe("local");
  });

  it("#61 AC-1: --answers で repository を省くと、GitHub とみなす（以前の回答ファイルとの互換）", () => {
    const answers = baseAnswers() as Record<string, unknown>;
    delete answers["repository"];
    expect(parseAnswersYaml(stringify(answers)).answers.repository).toBe("github");
  });

  it("#61 AC-1: repository に誤った値を書くとエラー", () => {
    const errors = errorsOf(stringify(baseAnswers({ repository: "gitlab" })));
    expect(errors.some((e) => e.includes("repository"))).toBe(true);
  });
});

describe("#61 AC-1: 整合性チェックのルール", () => {
  it("#61 AC-1: team-without-remote は、複数人で、リポジトリが local のときだけ当たる", () => {
    const local = { repository: "local", visibility: "private", check_location: "local" };
    expect(hitIds({ ...local, team_size: "team" })).toEqual(["team-without-remote"]);
    expect(hitIds({ ...local, team_size: "solo" })).toEqual([]);
    expect(hitIds({ repository: "github", team_size: "team" })).toEqual([]);
  });

  it("#61 AC-1: team-needs-ci・public-needs-ci は、GitHub のときだけ当たる（local は check_location が local に決まるため）", () => {
    const local = { repository: "local", visibility: "private", check_location: "local" };
    expect(hitIds({ ...local, team_size: "team" })).not.toContain("team-needs-ci");
    expect(hitIds({ repository: "github", team_size: "team", check_location: "local" })).toEqual([
      "team-needs-ci",
    ]);
    expect(hitIds({ repository: "github", visibility: "public", check_location: "local" })).toEqual(
      ["public-needs-ci"],
    );
  });

  it("#61 AC-1: team-without-remote は、直す質問に team_size・repository を示す", () => {
    const rule = rules.find((r) => r.id === "team-without-remote");
    expect(rule?.level).toBe("warning");
    expect(rule?.fix).toEqual(["team_size", "repository"]);
    expect(rule?.reason).toContain("共有のリモートがなく");
  });
});
