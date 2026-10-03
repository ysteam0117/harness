// 想定する型：src/commands/create.ts
//   export interface CreateDeps {
//     prompter: Prompter;                       // 入力と表示（note）の窓口。回答の一覧・チェックの結果は prompter.note で表示する
//     cwd: string;                              // 生成先の基準（./<app_name>）。process.cwd() が既定
//     interactive: boolean;                     // 標準入力・出力が端末か。既定は process.stdin.isTTY && process.stdout.isTTY
//     stderr: (text: string) => void;           // エラー・終了時のメッセージ。既定は process.stderr.write
//     checkTools?: () => Promise<ToolStatus[]>; // 手元の道具の確かめの差し替え（テスト用）。既定は tools.ts
//   }
//   export interface CreateOptions { answers?: string /* --answers のファイル */; yes?: boolean /* --yes */ }
//   export interface CreateOutcome { exitCode: number; answers?: Answers; acceptedWarnings?: AcceptedWarning[]; result?: CheckResult }
//   export async function runCreate(options: CreateOptions, deps: CreateDeps): Promise<CreateOutcome>;
//     - 質問 → チェック → 回答の一覧とチェックの結果の表示 → 確認（confirm "confirm_generate"。--yes なら省く）
//     - 確認の後：stderr に「生成は Issue #34 で実装予定です」を出し、exitCode 1（ファイルは作らない）。確認で「いいえ」なら何もせず exitCode 0
//     - CancelledError：stderr に「中断しました。ファイルは作成していません。」を出し、exitCode 130
//     - 対話しない（interactive = false）：足りない回答・承知していない警告・--yes なしの確認のいずれかがあれば、
//       その一覧を stderr に示して exitCode 1（prompter の入力は使わない）
//     - --answers のエラー（ファイルがない・AnswersError）：日本語で stderr に示して exitCode 1
//     - チェックのエラー（対話しない）：エラーの一覧（ルールの id とメッセージ）を stderr に示して exitCode 1
//   createCommand(deps?: Partial<CreateDeps>)・createProgram(deps?: Partial<CreateDeps>) も同じ deps を受け取れる
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { runCreate, type CreateDeps } from "../../src/commands/create.js";
import type { ToolStatus } from "../../src/checks/tools.js";
import { questionDefinitions as defs } from "../../src/questions/definitions.js";
import { CancelledError } from "../../src/questions/prompter.js";
import { FakePrompter, baseAnswers, cleanupTmp, makeTmp } from "../questions/helpers.js";
import { offlineFetch } from "../versions/helpers.js";

afterEach(cleanupTmp);

const STUB_MESSAGE = "生成は Issue #34 で実装予定です";
const CANCEL_MESSAGE = "中断しました。ファイルは作成していません。";

const okTools = async (): Promise<ToolStatus[]> => [
  { name: "node", state: "ok", version: "24.0.0" },
  { name: "git", state: "ok", version: "2.45.0" },
  { name: "docker", state: "ok", version: "27.0.1" },
];

function setup(script: Record<string, unknown[]> = {}, over: Partial<CreateDeps> = {}) {
  const tmp = makeTmp();
  const prompter = new FakePrompter(script);
  const errs: string[] = [];
  const deps: CreateDeps = {
    prompter,
    cwd: tmp.cwd,
    interactive: false,
    stderr: (s) => errs.push(s),
    checkTools: okTools,
    // #33：本物のネットワークにはつながない。つながらない状態にしておく（方針 verified なら、検証済みで止まらず進む。R6）
    fetch: offlineFetch().fn,
    ...over,
  };
  const writeAnswers = (obj: Record<string, unknown>, name = "answers.yaml") => {
    const file = path.join(tmp.inputDir, name);
    writeFileSync(file, stringify(obj));
    return file;
  };
  return { tmp, prompter, deps, errs, err: () => errs.join(""), writeAnswers };
}

const title = (id: string) => defs.find((d) => d.id === id)?.title ?? "";
const listing = (dir: string) => readdirSync(dir);

describe("#32 AC-4: --answers で質問に答えずに同じ回答を渡す", () => {
  it("#32 AC-4: 完全な YAML と --yes で、入力のメソッドを一度も呼ばずに確認まで進み、「生成は #34 で実装予定」で終了コード1", async () => {
    const s = setup();
    const file = s.writeAnswers(baseAnswers() as Record<string, unknown>);
    const out = await runCreate({ answers: file, yes: true }, s.deps);
    expect(s.prompter.inputs).toHaveLength(0);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain(STUB_MESSAGE);
    expect(listing(s.tmp.cwd)).toEqual([]); // ファイルは作らない
  });

  it("#32 AC-4: 同じ YAML なら、同じ回答になる", async () => {
    const s1 = setup();
    const s2 = setup();
    const a = await runCreate(
      { answers: s1.writeAnswers(baseAnswers() as Record<string, unknown>), yes: true },
      s1.deps,
    );
    const b = await runCreate(
      { answers: s2.writeAnswers(baseAnswers() as Record<string, unknown>), yes: true },
      s2.deps,
    );
    expect(a.answers).toBeDefined();
    expect(a.answers).toEqual(b.answers);
    expect(a.answers).toMatchObject({ project_type: "web", infra: "cloudflare" }); // 自動の値も入る
  });

  it("#32 AC-4: 回答の一覧（日本語の見出しと値）とチェックの結果を表示する", async () => {
    const s = setup();
    await runCreate(
      {
        answers: s.writeAnswers(
          baseAnswers({ database: "postgresql", postgres_provider: "neon" }) as Record<
            string,
            unknown
          >,
        ),
        yes: true,
      },
      s.deps,
    );
    const shown = s.prompter.notes.join("\n");
    expect(shown).toContain(title("app_name"));
    expect(shown).toContain("testapp-001");
    expect(shown).toContain(title("database"));
    expect(shown).toMatch(/PostgreSQL/); // 値の日本語の表示（選択肢の label）
    expect(shown).toContain("外部のDBサービスの契約が必要"); // 情報のルール6の結果
  });

  it("#32 AC-4: 知らないキー・誤った値は、まとめて日本語で示して終了コード1。生成の案内は出さない", async () => {
    const s = setup();
    const file = s.writeAnswers({ ...baseAnswers(), colour: "red", visibility: "secret" });
    const out = await runCreate({ answers: file, yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("colour");
    expect(s.err()).toContain("visibility");
    expect(s.err()).not.toContain(STUB_MESSAGE);
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#32 AC-4: --answers のファイルがないと、パスを含む日本語のエラーで終了コード1", async () => {
    const s = setup();
    const missing = path.join(s.tmp.inputDir, "nothing.yaml");
    const out = await runCreate({ answers: missing, yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("nothing.yaml");
    expect(s.err()).toMatch(/[ぁ-んァ-ヶ一-龠]/);
  });
});

describe("#32 AC-4: 足りない回答", () => {
  it("#32 AC-4: 端末でないときは、足りない質問の一覧を示して終了コード1（入力は使わない）", async () => {
    const s = setup();
    const answers = baseAnswers() as Record<string, unknown>;
    delete answers.team_size;
    delete answers.version_policy;
    const out = await runCreate({ answers: s.writeAnswers(answers), yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("team_size");
    expect(s.err()).toContain("version_policy");
    expect(s.err()).not.toContain(STUB_MESSAGE);
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#32 AC-4: --answers がなく端末でもないときは、質問できないので終了コード1（質問の一覧を示す）", async () => {
    const s = setup();
    const out = await runCreate({}, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("app_name");
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#32 AC-4: 端末のときは、足りない回答だけ対話で聞く", async () => {
    const s = setup(
      { team_size: ["team"], check_location: ["both"], confirm_generate: [true] },
      { interactive: true },
    );
    const answers = baseAnswers() as Record<string, unknown>;
    delete answers.team_size;
    delete answers.check_location;
    const out = await runCreate({ answers: s.writeAnswers(answers) }, s.deps);
    expect(s.prompter.askedIds).toEqual(["team_size", "check_location", "confirm_generate"]);
    expect(out.answers?.team_size).toBe("team");
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain(STUB_MESSAGE);
  });
});

describe("#32 AC-1: 確認（--yes と対話）", () => {
  it("#32 AC-1: 端末でなく --yes もないと、確認ができないので終了コード1。--yes の案内を出し、生成の案内は出さない（R1）", async () => {
    const s = setup();
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>) },
      s.deps,
    );
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("--yes");
    expect(s.err()).not.toContain(STUB_MESSAGE);
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#32 AC-1: 端末で「この内容で生成しますか」に「はい」なら、「生成は #34 で実装予定」で終了コード1", async () => {
    const s = setup({ confirm_generate: [true] }, { interactive: true });
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>) },
      s.deps,
    );
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain(STUB_MESSAGE);
    expect(s.prompter.inputs[0]?.method).toBe("confirm");
    expect(s.prompter.inputs[0]?.message).toContain("この内容で生成しますか");
  });

  it("#32 AC-1: 「いいえ」なら何もせず終了コード0（生成の案内も出さない）", async () => {
    const s = setup({ confirm_generate: [false] }, { interactive: true });
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>) },
      s.deps,
    );
    expect(out.exitCode).toBe(0);
    expect(s.err()).not.toContain(STUB_MESSAGE);
    expect(listing(s.tmp.cwd)).toEqual([]);
  });

  it("#32 AC-1: --yes なら、端末でも確認を聞かない", async () => {
    const s = setup({}, { interactive: true });
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>), yes: true },
      s.deps,
    );
    expect(s.prompter.inputs).toHaveLength(0);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain(STUB_MESSAGE);
  });

  it("#32 AC-1: --answers なしの端末では、質問から始まり、最後に確認を聞く", async () => {
    const s = setup(
      {
        app_name: ["testapp-001"],
        ais: [["claude"]],
        visibility: ["private"],
        team_size: ["solo"],
        database: ["d1"],
        auth: ["oidc"],
        idp: ["google"],
        file_upload: ["no"],
        check_location: ["both"],
        version_policy: ["verified"],
        confirm_generate: [true],
      },
      { interactive: true },
    );
    const out = await runCreate({}, s.deps);
    expect(s.prompter.askedIds[0]).toBe("app_name");
    expect(s.prompter.askedIds.at(-1)).toBe("confirm_generate");
    // 質問A〜Gは聞かず「未定」にする
    for (const id of [
      "personal_data",
      "admin",
      "critical_ops",
      "critical_ops_kinds",
      "collaborative",
      "org_separation",
      "realtime",
      "availability",
    ]) {
      expect(s.prompter.askedIds).not.toContain(id);
    }
    expect(out.answers).toMatchObject({
      personal_data: "undecided",
      admin: "undecided",
      availability: "undecided",
    });
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain(STUB_MESSAGE);
  });
});

describe("#32 AC-3: 警告・エラー（--answers）", () => {
  const warnYaml = () => ({ ...baseAnswers({ team_size: "team", check_location: "local" }) });

  it("#32 AC-3: 警告なし → 警告を承知する必要なく確認まで進む", async () => {
    const s = setup();
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>), yes: true },
      s.deps,
    );
    expect(out.acceptedWarnings).toEqual([]);
    expect(s.err()).toContain(STUB_MESSAGE);
  });

  it("#32 AC-3: 警告あり＋accepted_warnings に承知あり → 確認まで進み、承知した内容が結果に入る", async () => {
    const s = setup();
    const file = s.writeAnswers({ ...warnYaml(), accepted_warnings: ["team-needs-ci"] });
    const out = await runCreate({ answers: file, yes: true }, s.deps);
    expect(s.err()).toContain(STUB_MESSAGE);
    expect(out.acceptedWarnings?.map((w) => w.id)).toEqual(["team-needs-ci"]);
    expect(out.acceptedWarnings?.[0]?.message).toBeTruthy();
    expect(out.acceptedWarnings?.[0]?.reason).toBeTruthy();
    // 承知した警告も、チェックの結果として表示される
    expect(s.prompter.notes.join("\n")).toContain(out.acceptedWarnings?.[0]?.message ?? "未定義");
  });

  it("#32 AC-3: 警告あり＋承知なし（端末でない）→ 警告の一覧と accepted_warnings の案内を示して終了コード1。生成の案内は出さない", async () => {
    const s = setup();
    const out = await runCreate({ answers: s.writeAnswers(warnYaml()), yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("team-needs-ci");
    expect(s.err()).toContain("accepted_warnings");
    expect(s.err()).not.toContain(STUB_MESSAGE);
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#32 AC-3: 端末で警告を承知しないと、終了コード0で何もせず終わる（生成の案内も出さない）", async () => {
    const s = setup({ "accept_warning:team-needs-ci": [false] }, { interactive: true });
    const out = await runCreate({ answers: s.writeAnswers(warnYaml()), yes: true }, s.deps);
    expect(out.exitCode).toBe(0);
    expect(s.err()).not.toContain(STUB_MESSAGE);
  });

  it("#32 AC-3: 端末で警告を承知すると、承知した内容が結果に入り、確認まで進む", async () => {
    const s = setup(
      { "accept_warning:team-needs-ci": [true], confirm_generate: [true] },
      { interactive: true },
    );
    const out = await runCreate({ answers: s.writeAnswers(warnYaml()) }, s.deps);
    expect(out.acceptedWarnings?.map((w) => w.id)).toEqual(["team-needs-ci"]);
    expect(s.err()).toContain(STUB_MESSAGE);
  });

  it("#32 AC-3: エラー（ルール1）→ エラーの一覧（id とメッセージ）を示して終了コード1（端末でない）", async () => {
    const s = setup();
    const file = s.writeAnswers(
      baseAnswers({ auth: "app", idp: undefined, database: "none" }) as Record<string, unknown>,
    );
    const out = await runCreate({ answers: file, yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("auth-needs-db");
    expect(s.err()).toContain("認証が「アプリ独自認証」または「併用」で、DBが「なし」です");
    expect(s.err()).not.toContain(STUB_MESSAGE);
  });

  it("#32 AC-3: 手元の道具がない（ルール8）ときは、導入の案内を含む警告になる", async () => {
    const s = setup(
      {},
      {
        checkTools: async () => [
          { name: "node", state: "ok", version: "24.0.0" },
          { name: "git", state: "ok", version: "2.45.0" },
          { name: "docker", state: "missing", guide: "Docker Desktop を入れてください" },
        ],
      },
    );
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>), yes: true },
      s.deps,
    );
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("missing-tools");
    expect(s.err()).toContain("docker");
    expect(s.err()).not.toContain(STUB_MESSAGE);
  });

  it("#32 AC-3: 手元の道具の警告も、accepted_warnings で承知すれば進める", async () => {
    const s = setup(
      {},
      {
        checkTools: async () => [
          { name: "docker", state: "missing", guide: "Docker を入れてください" },
        ],
      },
    );
    const file = s.writeAnswers({ ...baseAnswers(), accepted_warnings: ["missing-tools"] });
    const out = await runCreate({ answers: file, yes: true }, s.deps);
    expect(out.acceptedWarnings?.map((w) => w.id)).toEqual(["missing-tools"]);
    expect(s.err()).toContain(STUB_MESSAGE);
  });

  it("#32 AC-3: 生成先に中身がある（ルール10）と、フォルダを変えずにエラーで終了コード1", async () => {
    const s = setup();
    mkdirSync(path.join(s.tmp.cwd, "testapp-001"));
    const keep = path.join(s.tmp.cwd, "testapp-001", "keep.txt");
    writeFileSync(keep, "既存のファイル");
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>), yes: true },
      s.deps,
    );
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("target-dir-not-empty");
    expect(readFileSync(keep, "utf8")).toBe("既存のファイル");
    expect(listing(path.join(s.tmp.cwd, "testapp-001"))).toEqual(["keep.txt"]);
  });

  it("#32 AC-1: --answers の誤ったアプリ名は、読み込みでなくルール9のエラーで示される（R2）", async () => {
    const s = setup();
    const out = await runCreate(
      {
        answers: s.writeAnswers(baseAnswers({ app_name: "../x" }) as Record<string, unknown>),
        yes: true,
      },
      s.deps,
    );
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("invalid-app-name");
    expect(s.err()).not.toContain("target-dir-not-empty");
    expect(s.err()).not.toContain(STUB_MESSAGE);
  });

  it("#32 AC-3: 端末でエラーが出ると、聞き直せる（fix_question）", async () => {
    const s = setup(
      {
        fix_question: ["database"],
        database: ["d1"],
        confirm_generate: [true],
      },
      { interactive: true },
    );
    const file = s.writeAnswers(
      baseAnswers({ auth: "app", idp: undefined, database: "none" }) as Record<string, unknown>,
    );
    const out = await runCreate({ answers: file }, s.deps);
    expect(s.prompter.askedIds).toEqual(["fix_question", "database", "confirm_generate"]);
    expect(out.answers?.database).toBe("d1");
    expect(s.err()).toContain(STUB_MESSAGE);
  });
});

describe("#32 AC-5: 質問の途中でやめる（Ctrl+C）", () => {
  it("#32 AC-5: 最初の質問で中断すると、「中断しました。ファイルは作成していません。」と表示して終了コード130。ファイルは作られない", async () => {
    const s = setup({ app_name: [new CancelledError()] }, { interactive: true });
    const out = await runCreate({}, s.deps);
    expect(out.exitCode).toBe(130);
    expect(s.err()).toContain(CANCEL_MESSAGE);
    expect(s.err()).not.toContain(STUB_MESSAGE);
    expect(listing(s.tmp.cwd)).toEqual([]); // 生成先（一時フォルダ）が空のまま
  });

  it("#32 AC-5: 質問の途中（3問目）で中断しても、同じ結果になり、それ以降の質問は聞かれない", async () => {
    const s = setup(
      { app_name: ["testapp-001"], ais: [["claude"]], visibility: [new CancelledError()] },
      { interactive: true },
    );
    const out = await runCreate({}, s.deps);
    expect(out.exitCode).toBe(130);
    expect(s.err()).toContain(CANCEL_MESSAGE);
    expect(s.prompter.askedIds).toEqual(["app_name", "ais", "visibility"]);
    expect(listing(s.tmp.cwd)).toEqual([]);
  });

  it("#32 AC-5: 最後の確認（confirm）で中断しても、終了コード130でファイルは作られない", async () => {
    const s = setup({ confirm_generate: [new CancelledError()] }, { interactive: true });
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>) },
      s.deps,
    );
    expect(out.exitCode).toBe(130);
    expect(s.err()).toContain(CANCEL_MESSAGE);
    expect(listing(s.tmp.cwd)).toEqual([]);
  });

  it("#32 AC-5: 警告の承知の確認で中断しても、終了コード130でファイルは作られない", async () => {
    const s = setup(
      { "accept_warning:team-needs-ci": [new CancelledError()] },
      { interactive: true },
    );
    const out = await runCreate(
      {
        answers: s.writeAnswers(
          baseAnswers({ team_size: "team", check_location: "local" }) as Record<string, unknown>,
        ),
      },
      s.deps,
    );
    expect(out.exitCode).toBe(130);
    expect(s.err()).toContain(CANCEL_MESSAGE);
    expect(listing(s.tmp.cwd)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// コードレビュー1回目の指摘の反映
//
// 指摘1：手元の道具の警告（missing-tools）は、承知を確かめる（confirm "accept_warning:missing-tools"）より前に、
//   足りない道具の名前・確かめられない理由・導入の案内を prompter.note で表示する。断った場合も同じ。
//
// 指摘2：YAML の回答と、対話で答えた回答の矛盾を、黙って消さない。
//   矛盾の種類は2つ：
//     (a) 条件に合わなくなった質問への YAML の回答（例：対話で auth = none → YAML の idp: google）
//     (b) 条件で決まる値と違う YAML の回答（例：対話で auth = none → YAML の admin: yes・collaborative: yes は「no」に決まる）
//   流れ（対話のとき）：
//     1. 質問を進める。YAML の回答があり、対話の回答と矛盾する質問が出たら、その時点で止めて prompter.note に
//        「<矛盾する質問の見出し>：<理由。原因の質問の見出しを含む>」を矛盾ごとに表示する（黙って上書き・破棄しない）
//     2. select "fix_question" で「どれを直すか」を聞く。選択肢は、原因の質問（auth）と、矛盾している質問（idp・admin・collaborative）
//     3. 選んだ質問の回答だけを消し（YAML の値も対話の値も。依存する質問の回答は消さない）、ほかの回答はそのまま使って
//        質問の進め方をもう一度走らせる。選んだ質問が原因の質問なら聞き直し、矛盾している質問なら「その YAML の回答を捨てる」ことになる
//     4. 矛盾がなくなるまで 2〜3 を繰り返す。そのあと整合性チェックなどへ進む
//   端末でないとき：質問できないので、auth が足りない回答として一覧に出て、終了コード1（矛盾を抱えたまま進まない）
// ---------------------------------------------------------------------------

describe("#32 AC-3: 手元の道具の警告は、承知を確かめる前に詳細を表示する（レビュー指摘1）", () => {
  const toolsWithProblems = async (): Promise<ToolStatus[]> => [
    {
      name: "node",
      state: "outdated",
      version: "23.0.0",
      guide: "Node.js 24 以上を入れてください",
    },
    { name: "git", state: "unknown", detail: "permission denied" },
    { name: "docker", state: "missing", guide: "Docker Desktop を入れてください" },
  ];

  /** accept_warning の確認より前に表示された note を、まとめて返す */
  const notesBeforeConfirm = (p: FakePrompter): string => {
    const at = p.events.findIndex(
      (e) => e.type === "input" && e.id === "accept_warning:missing-tools",
    );
    expect(at).toBeGreaterThanOrEqual(0);
    return p.events
      .slice(0, at)
      .filter((e) => e.type === "note")
      .map((e) => e.message)
      .join("\n");
  };

  for (const [label, accept] of [
    ["承知する", true],
    ["断る", false],
  ] as const) {
    it(`#32 AC-3: ${label}場合も、確認の前に、道具の名前・確かめられない理由・導入の案内が表示されている`, async () => {
      const s = setup(
        { "accept_warning:missing-tools": [accept], confirm_generate: [true] },
        { interactive: true, checkTools: toolsWithProblems },
      );
      await runCreate(
        { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>) },
        s.deps,
      );
      const shown = notesBeforeConfirm(s.prompter);
      expect(shown).toContain("node");
      expect(shown).toContain("git");
      expect(shown).toContain("docker");
      expect(shown).toContain("permission denied");
      expect(shown).toContain("Node.js 24 以上を入れてください");
      expect(shown).toContain("Docker Desktop を入れてください");
    });
  }
});

describe("#32 AC-4: YAML の回答と対話の回答の矛盾は、黙って消さない（レビュー指摘2）", () => {
  /** auth を省き、auth = none と矛盾する回答（idp・admin・collaborative）を YAML に書く */
  const conflictYaml = () => {
    const a = baseAnswers({ admin: "yes", collaborative: "yes", idp: "google" }) as Record<
      string,
      unknown
    >;
    delete a.auth;
    return a;
  };

  it("#32 AC-4: 対話で auth = none を選ぶと、矛盾を理由付きで表示し、直す質問を聞く（idp・admin・collaborative の全部）", async () => {
    const s = setup(
      { auth: ["none"], fix_question: [new CancelledError()] },
      { interactive: true },
    );
    await runCreate({ answers: s.writeAnswers(conflictYaml()) }, s.deps);
    const notes = s.prompter.notes.join("\n");
    for (const id of ["idp", "admin", "collaborative"]) {
      expect(notes).toContain(title(id));
    }
    expect(notes).toContain(title("auth")); // 理由に原因の質問の見出しが入る
    const fix = s.prompter.inputs.find((e) => e.id === "fix_question");
    expect(fix?.method).toBe("select");
    expect(fix?.opts.options.map((o: { value: string }) => o.value).sort()).toEqual(
      ["admin", "auth", "collaborative", "idp"].sort(),
    );
    // 矛盾を示した後でなければ、聞き直しの選択は出ない
    const noteAt = s.prompter.events.findIndex(
      (e) => e.type === "note" && e.message.includes(title("idp")),
    );
    const fixAt = s.prompter.events.findIndex((e) => e.type === "input" && e.id === "fix_question");
    expect(noteAt).toBeGreaterThanOrEqual(0);
    expect(noteAt).toBeLessThan(fixAt);
  });

  it("#32 AC-4: auth を選び直すと、YAML の回答（idp・admin・collaborative）が残ったまま確認まで進む（黙って no に上書きしない）", async () => {
    const s = setup(
      {
        auth: ["none", "oidc"],
        fix_question: ["auth"],
        confirm_generate: [true],
      },
      { interactive: true },
    );
    const out = await runCreate({ answers: s.writeAnswers(conflictYaml()) }, s.deps);
    expect(s.prompter.askedIds).toEqual(["auth", "fix_question", "auth", "confirm_generate"]);
    expect(out.answers).toMatchObject({
      auth: "oidc",
      idp: "google",
      admin: "yes",
      collaborative: "yes",
    });
    expect(s.err()).toContain(STUB_MESSAGE);
  });

  it("#32 AC-4: 矛盾する YAML の回答を1つずつ捨てると、auth = none のまま進み、idp は消え、admin・collaborative は no になる", async () => {
    const s = setup(
      {
        auth: ["none"],
        fix_question: ["idp", "admin", "collaborative"],
        confirm_generate: [true],
      },
      { interactive: true },
    );
    const out = await runCreate({ answers: s.writeAnswers(conflictYaml()) }, s.deps);
    expect(s.prompter.askedIds).toEqual([
      "auth",
      "fix_question",
      "fix_question",
      "fix_question",
      "confirm_generate",
    ]);
    expect(out.answers?.auth).toBe("none");
    expect(out.answers).not.toHaveProperty("idp");
    expect(out.answers?.admin).toBe("no");
    expect(out.answers?.collaborative).toBe("no");
  });

  it("#32 AC-4: 条件の質問（idp）だけが矛盾する場合も、黙って捨てずに示す", async () => {
    const a = baseAnswers({ idp: "google" }) as Record<string, unknown>;
    delete a.auth;
    const s = setup({ auth: ["app"], fix_question: [new CancelledError()] }, { interactive: true });
    await runCreate({ answers: s.writeAnswers(a) }, s.deps);
    expect(s.prompter.notes.join("\n")).toContain(title("idp"));
    expect(s.prompter.askedIds).toEqual(["auth", "fix_question"]);
  });

  it("#32 AC-4: 条件で決まる値（admin: yes）だけが矛盾する場合も、黙って no にしない", async () => {
    const a = baseAnswers({ admin: "yes", idp: undefined }) as Record<string, unknown>;
    delete a.auth;
    const s = setup(
      { auth: ["none"], fix_question: [new CancelledError()] },
      { interactive: true },
    );
    await runCreate({ answers: s.writeAnswers(a) }, s.deps);
    expect(s.prompter.notes.join("\n")).toContain(title("admin"));
    expect(s.prompter.askedIds).toEqual(["auth", "fix_question"]);
  });

  it("#32 AC-4: 矛盾がなければ、聞き直しは出ない（auth = oidc で YAML の idp・admin はそのまま）", async () => {
    const s = setup({ auth: ["oidc"], confirm_generate: [true] }, { interactive: true });
    const out = await runCreate({ answers: s.writeAnswers(conflictYaml()) }, s.deps);
    expect(s.prompter.askedIds).toEqual(["auth", "confirm_generate"]);
    expect(out.answers).toMatchObject({ auth: "oidc", idp: "google", admin: "yes" });
  });

  it("#32 AC-4: 端末でないときは、auth が足りない回答として示し、終了コード1（矛盾を抱えて進まない）", async () => {
    const s = setup();
    const out = await runCreate({ answers: s.writeAnswers(conflictYaml()), yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("auth");
    expect(s.err()).not.toContain(STUB_MESSAGE);
    expect(s.prompter.inputs).toHaveLength(0);
  });
});

describe("#32 AC-2: 質問A〜G は聞かずに「未定」（利用者の判断で仕様変更）", () => {
  it("#32 AC-2: A〜G を書かない YAML は、端末でなくても足りない回答としてエラーにならず、確認まで進む。回答は「undecided」", async () => {
    const s = setup();
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
    const out = await runCreate({ answers: s.writeAnswers(a), yes: true }, s.deps);
    expect(s.prompter.inputs).toHaveLength(0);
    expect(s.err()).toContain(STUB_MESSAGE);
    expect(out.answers).toMatchObject({
      personal_data: "undecided",
      admin: "undecided",
      critical_ops: "undecided",
      collaborative: "undecided",
      org_separation: "undecided",
      realtime: "undecided",
      availability: "undecided",
    });
    expect(out.answers).not.toHaveProperty("critical_ops_kinds");
  });

  it("#32 AC-2: A〜G を書いた YAML は、その値を使う", async () => {
    const s = setup();
    const out = await runCreate(
      {
        answers: s.writeAnswers(
          baseAnswers({
            personal_data: "basic",
            critical_ops: "yes",
            critical_ops_kinds: ["publish"],
          }) as Record<string, unknown>,
        ),
        yes: true,
      },
      s.deps,
    );
    expect(out.answers).toMatchObject({
      personal_data: "basic",
      critical_ops: "yes",
      critical_ops_kinds: ["publish"],
    });
  });

  it("#32 AC-2: A〜G の回答（個人情報の有無など）は、回答の一覧にも「未定」として表示される", async () => {
    const s = setup();
    const a = baseAnswers() as Record<string, unknown>;
    delete a.personal_data;
    await runCreate({ answers: s.writeAnswers(a), yes: true }, s.deps);
    const shown = s.prompter.notes.join(String.fromCharCode(10));
    expect(shown).toContain(title("personal_data"));
    expect(shown).toContain("未定");
  });
});

describe("#32 AC-4: critical_ops_kinds だけを書いた YAML（レビュー3回目の指摘）", () => {
  it("#32 AC-4: 端末でないとき、入力のメソッド（fix_question を含む）を一度も呼ばず、終了コード1。生成の案内は出さない", async () => {
    const s = setup();
    const a = baseAnswers({ critical_ops_kinds: ["publish"] }) as Record<string, unknown>;
    delete a.critical_ops;
    const out = await runCreate({ answers: s.writeAnswers(a), yes: true }, s.deps);
    expect(s.prompter.inputs).toHaveLength(0);
    expect(s.prompter.askedIds).not.toContain("fix_question");
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("critical_ops_kinds");
    expect(s.err()).not.toContain(STUB_MESSAGE);
  });

  it("#32 AC-4: critical_ops: no と書いた場合も同じ（端末でない）", async () => {
    const s = setup();
    const a = baseAnswers({ critical_ops: "no", critical_ops_kinds: ["publish"] }) as Record<
      string,
      unknown
    >;
    const out = await runCreate({ answers: s.writeAnswers(a), yes: true }, s.deps);
    expect(s.prompter.inputs).toHaveLength(0);
    expect(out.exitCode).toBe(1);
    expect(s.err()).not.toContain(STUB_MESSAGE);
  });
});
