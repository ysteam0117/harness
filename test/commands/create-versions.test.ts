// #33 harness create へのバージョンの調査の組み込み（計画の8・R3・R4・R6・R7・R8）
//
// 想定する型：src/commands/create.ts
//   CreateDeps に追加：fetch?: typeof fetch（既定は globalThis.fetch。テストでは必ず偽を渡す）、now?: () => Date（既定は new Date()）
//   CreateOutcome に追加：versions?: VersionResult と techStack?: string（docs/tech-stack.md の中身。保存は #34）
//   流れ：質問 → バージョンの調査と選択（chooseVersions）→ 事実の収集（versions_newer_than_verified を結果から作る）→ 整合性チェック → 確認
//   - 確認の一覧（note）に、採用するバージョンの表を加える
//   - 取得できず進めない場合・--answers の versions に対象にない名前がある場合は、stderr に示して exitCode 1
//   - ルール7（version-newer-than-verified）の警告は、承知を求める前に、該当するパッケージと、大きな版が違うものを note で示す。
//     承知していない場合の stderr にも、該当するパッケージを示す
//   - 整合性チェックの聞き直しで回答が変わったら、プロファイル・対象を計算し直し、増えた対象だけを調べる（既に選んだものはそのまま）
// 実際の templates/profiles は、実装の役割が profile.yaml に version_ranges などを足す前提（test/generate/profile.test.ts の冒頭）
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { runCreate, type CreateDeps } from "../../src/commands/create.js";
import type { ToolStatus } from "../../src/checks/tools.js";
import { targetsFor } from "../../src/versions/targets.js";
import { FakePrompter, baseAnswers, cleanupTmp, makeTmp } from "../questions/helpers.js";
import {
  FIXED_DAY,
  FIXED_NOW,
  offlineFetch,
  registryForReal,
  type FakeFetch,
} from "../versions/helpers.js";

afterEach(cleanupTmp);

/** 生成先（<cwd>/testapp-001）に、記録のファイルまでできているか（#34） */
const generated = (cwd: string) =>
  existsSync(path.join(cwd, "testapp-001", ".harness", "config.yaml"));
const RULE7 = "version-newer-than-verified";

const okTools = async (): Promise<ToolStatus[]> => [
  { name: "node", state: "ok", version: "24.0.0" },
  { name: "git", state: "ok", version: "2.45.0" },
  { name: "docker", state: "ok", version: "27.0.1" },
];

function setup(
  fetcher: FakeFetch,
  script: Record<string, unknown[]> = {},
  over: Partial<CreateDeps> = {},
) {
  const tmp = makeTmp();
  const prompter = new FakePrompter(script);
  const errs: string[] = [];
  const deps = {
    prompter,
    cwd: tmp.cwd,
    interactive: false,
    stderr: (s: string) => errs.push(s),
    checkTools: okTools,
    fetch: fetcher.fn,
    now: () => FIXED_NOW,
    ...over,
  } as CreateDeps;
  const writeAnswers = (obj: Record<string, unknown>) => {
    const file = path.join(tmp.inputDir, "answers.yaml");
    writeFileSync(file, stringify(obj));
    return file;
  };
  return { prompter, deps, cwd: tmp.cwd, err: () => errs.join(""), writeAnswers, fetcher };
}

const row = (md: string, name: string) =>
  md.split("\n").find(
    (l) =>
      l.trimStart().startsWith("|") &&
      l
        .split("|")
        .slice(1)
        .some((c) => c.trim().replaceAll("`", "") === name),
  ) ?? "";

/** vitest は 4 系と 5 系、typescript は 6.0 系・6.1・7 系があり、axios は大きな版が違う 2 系がある登録情報 */
const newerRegistry = () =>
  registryForReal({
    vitest: ["4.1.11", "4.2.0", "5.0.0", "5.1.0-rc.1"],
    typescript: ["6.0.3", "6.0.9", "6.1.0", "7.0.0"],
  });

describe("#33 R6・R8: 方針 verified（既定）でも調べて記録し、つながらなくても止めない", () => {
  it("#33 R6: 方針 verified：すべて検証済みを採用。fetch は呼ばれ、最新の安定版と調べた日が記録される。生成まで進む（#34）", async () => {
    const s = setup(newerRegistry());
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>), yes: true },
      s.deps,
    );
    expect(out.exitCode).toBe(0);
    expect(generated(s.cwd)).toBe(true); // 生成した（#34）
    expect(s.fetcher.calls.length).toBeGreaterThan(0);
    expect(s.prompter.inputs).toHaveLength(0);
    const entries = out.versions?.entries ?? [];
    expect(entries.length).toBeGreaterThan(10);
    for (const e of entries) {
      expect(e.version).toBe(e.verified);
      expect(e.surveyedOn).toBe(FIXED_DAY);
    }
    const vitest = entries.find((e) => e.name === "vitest");
    expect(vitest).toMatchObject({ version: "4.1.11", latestStable: "4.2.0" });
    expect(out.versions?.newerThanVerified).toBe(false);
    expect(out.result?.warnings.map((w) => w.id)).not.toContain(RULE7);
  });

  it("#33 R8: 実際のプロファイルで、すべての取得が失敗しても、確認の後に検証済みで最後まで進む（質問は確認だけ）", async () => {
    const s = setup(offlineFetch(), { confirm_generate: [true] }, { interactive: true });
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>) },
      s.deps,
    );
    expect(out.exitCode).toBe(0);
    expect(generated(s.cwd)).toBe(true); // 生成した（#34）
    expect(s.prompter.askedIds).toEqual(["confirm_generate"]);
    for (const e of out.versions?.entries ?? []) {
      expect(e.version).toBe(e.verified);
      expect(e.latestStable).toBeNull();
    }
    expect(
      out.versions?.entries.find((e) => e.name === "@testing-library/user-event")?.version,
    ).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("#33 R6: すべて失敗したとき、tech-stack.md の中身は「未確認」と書き、調べたと誤解させない", async () => {
    const s = setup(offlineFetch());
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>), yes: true },
      s.deps,
    );
    expect(out.techStack).toBeDefined();
    expect(row(out.techStack ?? "", "vitest")).toContain("未確認");
    expect(row(out.techStack ?? "", "vitest")).toContain("4.1.11");
  });
});

describe("#33 AC-1・AC-2・AC-3・AC-5: 方針 latest（--answers・対話しない）", () => {
  const latestYaml = (extra: Record<string, unknown> = {}) =>
    baseAnswers({ version_policy: "latest", ...extra }) as Record<string, unknown>;

  it("#33 AC-2: 範囲内の最新の安定版（vitest は 4 系、typescript は 6.0 系）を採用し、承知した警告が結果に入る", async () => {
    const s = setup(newerRegistry());
    const file = s.writeAnswers({ ...latestYaml(), accepted_warnings: [RULE7] });
    const out = await runCreate({ answers: file, yes: true }, s.deps);
    expect(out.exitCode).toBe(0);
    expect(generated(s.cwd)).toBe(true); // 生成した（#34）
    const get = (n: string) => out.versions?.entries.find((e) => e.name === n);
    expect(get("vitest")?.version).toBe("4.2.0");
    expect(get("typescript")?.version).toBe("6.0.9");
    expect(out.acceptedWarnings?.map((w) => w.id)).toContain(RULE7);
    expect(out.versions?.newerThanVerified).toBe(true);
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#33 AC-3: 検証済みより新しい版を採用すると、ルール7の警告になる。承知がなければ、該当するパッケージを示して終了コード1", async () => {
    const s = setup(newerRegistry());
    const out = await runCreate({ answers: s.writeAnswers(latestYaml()), yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain(RULE7);
    expect(s.err()).toContain("accepted_warnings");
    expect(s.err()).toContain("vitest");
    expect(generated(s.cwd)).toBe(false); // 生成しない
  });

  it("#33 AC-3: 大きな版が違うもの（axios 1 → 2）は、警告の理由に、パッケージ名と大きな版が違う旨が添えられる", async () => {
    const s = setup(registryForReal({ axios: ["1.20.0", "2.0.0"] }));
    const out = await runCreate({ answers: s.writeAnswers(latestYaml()), yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("axios");
    expect(s.err()).toMatch(/大きな版|メジャー/);
  });

  it("#33 AC-3: 小さな版の違いだけ（検証済みより少し新しい）でも、ルール7は事実で判定され警告になる（大きな版の注意は添えない）", async () => {
    const s = setup(registryForReal({ axios: ["1.20.0", "1.21.0"] }));
    const out = await runCreate(
      { answers: s.writeAnswers({ ...latestYaml(), accepted_warnings: [RULE7] }), yes: true },
      s.deps,
    );
    expect(out.acceptedWarnings?.map((w) => w.id)).toContain(RULE7);
    const axios = out.versions?.entries.find((e) => e.name === "axios");
    expect(axios).toMatchObject({
      version: "1.21.0",
      majorDiffers: false,
      newerThanVerified: true,
    });
  });

  it("#33 AC-3: 最新の安定版が検証済みと同じなら、警告は出ない（ルール7が当たらない）", async () => {
    const s = setup(registryForReal());
    const out = await runCreate({ answers: s.writeAnswers(latestYaml()), yes: true }, s.deps);
    expect(out.exitCode).toBe(0);
    expect(generated(s.cwd)).toBe(true); // 生成した（#34）
    expect(out.result?.warnings.map((w) => w.id)).not.toContain(RULE7);
    expect(out.versions?.newerThanVerified).toBe(false);
  });

  it("#33 AC-1: 試験版（99.0.0-rc.1 など）しか新しいものがないときは、検証済みのままで警告にならない", async () => {
    const s = setup(registryForReal({}, { distTags: { latest: "99.0.0-rc.1" } }));
    const out = await runCreate({ answers: s.writeAnswers(latestYaml()), yes: true }, s.deps);
    expect(out.exitCode).toBe(0);
    expect(generated(s.cwd)).toBe(true); // 生成した（#34）
    expect(out.versions?.entries.every((e) => e.version === e.verified)).toBe(true);
  });

  it("#33 R4: versions の一部だけを指定すると、その技術は指定のとおり、ほかは範囲内の最新の安定版（質問16の答えに従う）", async () => {
    const s = setup(newerRegistry());
    const file = s.writeAnswers({
      ...latestYaml({ versions: { vitest: "verified" } }),
      accepted_warnings: [RULE7],
    });
    const out = await runCreate({ answers: file, yes: true }, s.deps);
    const get = (n: string) => out.versions?.entries.find((e) => e.name === n);
    expect(get("vitest")?.version).toBe("4.1.11");
    expect(get("typescript")?.version).toBe("6.0.9");
  });

  it("#33 R4: versions を書かない（未指定）と、すべて範囲内の最新の安定版", async () => {
    const s = setup(newerRegistry());
    const out = await runCreate(
      { answers: s.writeAnswers({ ...latestYaml(), accepted_warnings: [RULE7] }), yes: true },
      s.deps,
    );
    expect(out.versions?.entries.find((e) => e.name === "vitest")?.version).toBe("4.2.0");
  });

  it("#33 R4: 対象にないパッケージ名を versions に書くと、名前を示して終了コード1（回答の読み込みの後・生成の案内は出さない）", async () => {
    const s = setup(newerRegistry());
    const out = await runCreate(
      {
        answers: s.writeAnswers(latestYaml({ versions: { "no-such-package": "verified" } })),
        yes: true,
      },
      s.deps,
    );
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("no-such-package");
    expect(generated(s.cwd)).toBe(false); // 生成しない
  });

  it("#33 R4: DB なしのとき drizzle-orm は対象にない。versions に書くとエラー（対象は回答で決まる）", async () => {
    const s = setup(newerRegistry());
    const out = await runCreate(
      {
        answers: s.writeAnswers(
          latestYaml({
            database: "none",
            auth: "none",
            idp: undefined,
            versions: { "drizzle-orm": "verified" },
          }),
        ),
        yes: true,
      },
      s.deps,
    );
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("drizzle-orm");
  });

  it("#33 R4: 不正な値・矛盾（version_policy: verified で versions に latest）は、終了コード1で、取得も質問もしない", async () => {
    for (const yamlObj of [
      latestYaml({ versions: { vitest: "newest" } }),
      baseAnswers({ version_policy: "verified", versions: { vitest: "latest" } }) as Record<
        string,
        unknown
      >,
      latestYaml({ versions_offline: "latest" }),
    ]) {
      const s = setup(newerRegistry());
      const out = await runCreate({ answers: s.writeAnswers(yamlObj), yes: true }, s.deps);
      expect(out.exitCode).toBe(1);
      expect(generated(s.cwd)).toBe(false); // 生成しない
      expect(s.fetcher.calls).toHaveLength(0);
      expect(s.prompter.inputs).toHaveLength(0);
    }
  });
});

describe("#33 AC-4: ネットワークにつながらない場合（方針 latest）", () => {
  const latestYaml = (extra: Record<string, unknown> = {}) =>
    baseAnswers({ version_policy: "latest", ...extra }) as Record<string, unknown>;

  it("#33 AC-4: 対話しない：取得できないパッケージと理由・versions_offline の案内を示して終了コード1", async () => {
    const s = setup(
      registryForReal({ vitest: new Error("connect ECONNREFUSED (fake)"), hono: 500 }),
    );
    const out = await runCreate({ answers: s.writeAnswers(latestYaml()), yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("vitest");
    expect(s.err()).toContain("ECONNREFUSED");
    expect(s.err()).toContain("hono");
    expect(s.err()).toContain("500");
    expect(s.err()).toContain("versions_offline");
    expect(generated(s.cwd)).toBe(false); // 生成しない
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#33 AC-4: 対話しない・versions_offline: verified：検証済みで最後まで進む", async () => {
    const s = setup(offlineFetch());
    const out = await runCreate(
      { answers: s.writeAnswers(latestYaml({ versions_offline: "verified" })), yes: true },
      s.deps,
    );
    expect(out.exitCode).toBe(0);
    expect(generated(s.cwd)).toBe(true); // 生成した（#34）
    expect(out.versions?.entries.every((e) => e.version === e.verified)).toBe(true);
    expect(out.versions?.newerThanVerified).toBe(false);
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#33 AC-4: 対話：「検証済みのバージョンで進めますか」に「いいえ」なら終了コード1。確認（confirm_generate）は聞かない", async () => {
    const s = setup(offlineFetch(), { versions_offline_confirm: [false] }, { interactive: true });
    const out = await runCreate({ answers: s.writeAnswers(latestYaml()) }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.prompter.askedIds).toEqual(["versions_offline_confirm"]);
    expect(generated(s.cwd)).toBe(false); // 生成しない
  });

  it("#33 AC-4: 対話：「はい」なら検証済みで進み、最後の確認まで行く", async () => {
    const s = setup(
      offlineFetch(),
      { versions_offline_confirm: [true], confirm_generate: [true] },
      { interactive: true },
    );
    const out = await runCreate({ answers: s.writeAnswers(latestYaml()) }, s.deps);
    expect(s.prompter.askedIds).toEqual(["versions_offline_confirm", "confirm_generate"]);
    expect(out.exitCode).toBe(0);
    expect(generated(s.cwd)).toBe(true); // 生成した（#34）
    expect(out.versions?.entries.every((e) => e.version === e.verified)).toBe(true);
  });
});

describe("#33 計画8：質問 → バージョンの調査と選択 → 事実の収集 → 整合性チェック → 確認の順", () => {
  it("#33 計画8: 対話で技術ごとに選ぶ（versions_mode = each）。選択の後で警告の承知、最後に確認。表は、警告の承知より前に表示される", async () => {
    const answers = baseAnswers({ version_policy: "latest" }) as Record<string, unknown>;
    const names = targetsFor(answers as never).map((t) => t.name);
    const script: Record<string, unknown[]> = {
      versions_mode: ["each"],
      [`accept_warning:${RULE7}`]: [true],
      confirm_generate: [true],
    };
    for (const n of names) script[`version_pick:${n}`] = [n === "vitest" ? "verified" : "latest"];
    const s = setup(newerRegistry(), script, { interactive: true });
    const out = await runCreate({ answers: s.writeAnswers(answers) }, s.deps);

    const ids = s.prompter.askedIds;
    expect(ids[0]).toBe("versions_mode");
    expect(ids.indexOf("versions_mode")).toBeLessThan(ids.indexOf(`accept_warning:${RULE7}`));
    expect(ids.at(-1)).toBe("confirm_generate");
    // 表（調べた結果）は、最初の入力より前に表示されている
    const firstInput = s.prompter.events.findIndex((e) => e.type === "input");
    const tableAt = s.prompter.events.findIndex(
      (e) => e.type === "note" && e.message.includes("vitest"),
    );
    expect(tableAt).toBeGreaterThanOrEqual(0);
    expect(tableAt).toBeLessThan(firstInput);
    // R7：最終の選択が、返す結果と tech-stack.md の中身に反映される
    const get = (n: string) => out.versions?.entries.find((e) => e.name === n);
    expect(get("vitest")?.version).toBe("4.1.11");
    expect(get("typescript")?.version).toBe("6.0.9");
    expect(row(out.techStack ?? "", "vitest")).toContain("4.1.11");
    expect(row(out.techStack ?? "", "typescript")).toContain("6.0.9");
  });

  it("#33 計画6: 警告（ルール7）の承知を求める前に、該当するパッケージと、大きな版が違うものを表示する", async () => {
    const answers = baseAnswers({ version_policy: "latest" }) as Record<string, unknown>;
    const s = setup(
      registryForReal({ axios: ["1.20.0", "2.0.0"] }),
      { versions_mode: ["latest"], [`accept_warning:${RULE7}`]: [false] },
      { interactive: true },
    );
    const out = await runCreate({ answers: s.writeAnswers(answers) }, s.deps);
    expect(out.exitCode).toBe(0); // 承知しないと、何もせず終了
    const at = s.prompter.events.findIndex(
      (e) => e.type === "input" && e.id === `accept_warning:${RULE7}`,
    );
    expect(at).toBeGreaterThanOrEqual(0);
    const before = s.prompter.events
      .slice(0, at)
      .filter((e) => e.type === "note")
      .map((e) => e.message)
      .join("\n");
    expect(before).toContain("axios");
    expect(before).toMatch(/大きな版|メジャー/);
  });

  it("#33 計画8：最後の確認の一覧（note）に、採用するバージョンの表が加わる", async () => {
    const s = setup(registryForReal(), { confirm_generate: [true] }, { interactive: true });
    await runCreate({ answers: s.writeAnswers(baseAnswers() as Record<string, unknown>) }, s.deps);
    const confirmAt = s.prompter.events.findIndex(
      (e) => e.type === "input" && e.id === "confirm_generate",
    );
    const before = s.prompter.events
      .slice(0, confirmAt)
      .filter((e) => e.type === "note")
      .map((e) => e.message)
      .join("\n");
    expect(before).toContain("vitest");
    expect(before).toContain("4.1.11");
    expect(before).toContain("hono");
  });

  it("#33 計画8：調査は整合性チェックより前（回答のエラーで終わる場合は、調査の結果があってもエラーを示す）", async () => {
    const s = setup(registryForReal());
    const file = s.writeAnswers(
      baseAnswers({ auth: "app", idp: undefined, database: "none" }) as Record<string, unknown>,
    );
    const out = await runCreate({ answers: file, yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("auth-needs-db");
    expect(s.fetcher.calls.length).toBeGreaterThan(0); // 調査は事実の収集の前に済んでいる
  });
});

describe("#33 R3: 整合性チェックの聞き直しで回答が変わったら、対象を計算し直す", () => {
  it("#33 R3: DB なし → PostgreSQL に直すと、drizzle・pg の対象が加わる。増えた対象だけを調べ、既に調べたものは調べ直さない", async () => {
    const f = registryForReal();
    const s = setup(
      f,
      {
        fix_question: ["database"],
        database: ["postgresql"],
        postgres_provider: ["neon"],
        confirm_generate: [true],
      },
      { interactive: true },
    );
    const file = s.writeAnswers(
      baseAnswers({ auth: "app", idp: undefined, database: "none" }) as Record<string, unknown>,
    );
    const out = await runCreate({ answers: file }, s.deps);
    expect(out.exitCode).toBe(0);
    expect(generated(s.cwd)).toBe(true); // 生成した（#34）
    expect(s.prompter.askedIds).toEqual([
      "fix_question",
      "database",
      "postgres_provider",
      "confirm_generate",
    ]);

    const names = out.versions?.entries.map((e) => e.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(["drizzle-orm", "drizzle-kit", "pg"]));
    // 調べ直さない：hono・vitest は1回だけ。増えた drizzle-orm・pg も1回
    const asked = f.npmNames();
    for (const n of ["hono", "vitest", "drizzle-orm", "drizzle-kit", "pg"]) {
      expect(
        asked.filter((x) => x === n),
        n,
      ).toHaveLength(1);
    }
    expect(f.urls().filter((u) => u.endsWith("index.json"))).toHaveLength(1);

    // 確認の表・返す結果・tech-stack.md の中身が一致する
    const fixAt = s.prompter.events.findIndex((e) => e.type === "input" && e.id === "fix_question");
    const lastTable = s.prompter.events
      .slice(fixAt)
      .filter((e) => e.type === "note" && e.message.includes("drizzle-orm"));
    expect(lastTable.length).toBeGreaterThan(0);
    const md = out.techStack ?? "";
    for (const n of names) expect(row(md, n), n).not.toBe("");
    expect(row(md, "pg")).not.toBe("");
    expect(row(md, "drizzle-orm")).toContain("0.45.3");
  });

  it("#33 R3: 回答が変わっても対象が変わらない（auth の直しなど）なら、調べ直さない", async () => {
    const f = registryForReal();
    const s = setup(f, { fix_question: ["auth"], confirm_generate: [true] }, { interactive: true });
    // database = none・auth = app はエラー。auth を直すと（#79：聞かずに「未定」に戻る）、対象は変わらない
    const file = s.writeAnswers(
      baseAnswers({ auth: "app", idp: undefined, database: "none" }) as Record<string, unknown>,
    );
    const out = await runCreate({ answers: file }, s.deps);
    expect(out.answers?.auth).toBe("undecided");
    const asked = f.npmNames();
    expect(asked.filter((x) => x === "hono")).toHaveLength(1);
    expect(out.versions?.entries.map((e) => e.name)).not.toContain("drizzle-orm");
  });
});

describe("#33 R7・AC-5：結果と tech-stack.md の中身を返す（保存は #34）", () => {
  it("#33 AC-5: 確認の後の create の結果に、採用した版・選定理由・調べた日・最新の安定版・検証済み、tech-stack.md の中身がある。ファイルは作らない", async () => {
    const s = setup(newerRegistry());
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>), yes: true },
      s.deps,
    );
    const md = out.techStack ?? "";
    expect(md).not.toBe("");
    const vitest = row(md, "vitest");
    expect(vitest).toContain("4.1.11"); // 採用した版・検証済み
    expect(vitest).toContain("4.2.0"); // 確認した最新の安定版
    expect(vitest).toContain(FIXED_DAY);
    expect(vitest).toContain("検証済み"); // 選定理由
    const e = out.versions?.entries.find((x) => x.name === "vitest");
    expect(e?.reason).toContain("検証済み");
  });

  it("#33 AC-5: 確認で「いいえ」でも、結果は返る（tech-stack.md の中身は作られ、ファイルは作られない）", async () => {
    const s = setup(registryForReal(), { confirm_generate: [false] }, { interactive: true });
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>) },
      s.deps,
    );
    expect(out.exitCode).toBe(0);
    expect(out.techStack).toBeDefined();
    expect(out.versions).toBeDefined();
  });
});

describe("#33 レビュー指摘1：version_policy を対話で選び、YAML の versions と矛盾する場合", () => {
  const yamlWithoutPolicy = () => {
    const a = baseAnswers({ versions: { vitest: "latest" } }) as Record<string, unknown>;
    delete a.version_policy;
    return a;
  };

  it("#33 レビュー指摘1：対話で version_policy に verified を選ぶと、調べ始める前（fetch を呼ぶ前）に、矛盾を示すエラーで終了コード1", async () => {
    const s = setup(registryForReal(), { version_policy: ["verified"] }, { interactive: true });
    const out = await runCreate({ answers: s.writeAnswers(yamlWithoutPolicy()) }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.fetcher.calls).toHaveLength(0);
    expect(s.err()).toContain("version_policy");
    expect(s.err()).toContain("versions");
    expect(generated(s.cwd)).toBe(false); // 生成しない
    expect(s.prompter.askedIds).toEqual(["version_policy"]);
  });

  it("#33 レビュー指摘1：端末でないときは、既存のとおり version_policy が足りない回答として示す（入力・取得なし）", async () => {
    const s = setup(registryForReal());
    const out = await runCreate(
      { answers: s.writeAnswers(yamlWithoutPolicy()), yes: true },
      s.deps,
    );
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("version_policy");
    expect(s.prompter.inputs).toHaveLength(0);
    expect(s.fetcher.calls).toHaveLength(0);
  });
});

describe("#33 レビュー指摘4：create の調べた日は、利用者のPCのローカルの日付", () => {
  it("#33 レビュー指摘4：now がローカルの 2026-10-03 0 時 30 分なら、結果と tech-stack.md の調べた日は 2026-10-03", async () => {
    const s = setup(registryForReal(), {}, { now: () => new Date(2026, 9, 3, 0, 30) });
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>), yes: true },
      s.deps,
    );
    expect(out.versions?.entries.every((e) => e.surveyedOn === "2026-10-03")).toBe(true);
    expect(row(out.techStack ?? "", "vitest")).toContain("2026-10-03");
  });
});
