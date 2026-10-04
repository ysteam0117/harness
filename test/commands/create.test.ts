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
//     - 確認の後（#34）：<cwd>/<app_name> に生成する（一時的な場所で組み立てて移す）。生成した場所と次の手順（README を読む・npm install）を
//       prompter.note で表示し、exitCode 0。確認で「いいえ」なら何もせず exitCode 0
//     - 生成の失敗（GenerateError・書き込みの失敗）：日本語のメッセージを stderr に示し、exitCode 1。生成先にも一時的な場所にも何も残さない
//     - 生成の最中の SIGINT（Ctrl+C）：生成の間だけ SIGINT を受ける処理を登録し、受けたら止めて一時的な場所を消し、
//       stderr に「中断しました」を出して exitCode 130。生成が完了した後（rename の後）に届いたときは生成先を残し、
//       「生成は完了しています」を出して exitCode 130。処理を外すので、終わった後は SIGINT の受け手が増えたままにならない
//   CreateDeps に generateFs?: Partial<FsOps>（write.ts の FsOps。テストで書き込み・名前の変更などを差し替える入口）を足す
//   CreateOutcome に projectDir?: string（生成した場所。<cwd>/<app_name>）を足す
//     - CancelledError：stderr に「中断しました。ファイルは作成していません。」を出し、exitCode 130
//     - 対話しない（interactive = false）：足りない回答・承知していない警告・--yes なしの確認のいずれかがあれば、
//       その一覧を stderr に示して exitCode 1（prompter の入力は使わない）
//     - --answers のエラー（ファイルがない・AnswersError）：日本語で stderr に示して exitCode 1
//     - チェックのエラー（対話しない）：エラーの一覧（ルールの id とメッセージ）を stderr に示して exitCode 1
//   createCommand(deps?: Partial<CreateDeps>)・createProgram(deps?: Partial<CreateDeps>) も同じ deps を受け取れる
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { lstat, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { runCreate, type CreateDeps } from "../../src/commands/create.js";
import type { ToolStatus } from "../../src/checks/tools.js";
import { questionDefinitions as defs } from "../../src/questions/definitions.js";
import { CancelledError } from "../../src/questions/prompter.js";
import { FakePrompter, baseAnswers, cleanupTmp, makeTmp } from "../questions/helpers.js";
import { FIXED_NOW, offlineFetch } from "../versions/helpers.js";

afterEach(cleanupTmp);

/** #34 で生成するようになったので、もう表示しない */
const OLD_STUB_MESSAGE = "生成は Issue #34 で実装予定です";

/** 生成先（<cwd>/testapp-001）に、記録のファイルまでできているか */
const generated = (cwd: string, app = "testapp-001") =>
  existsSync(path.join(cwd, app, ".harness", "config.yaml"));
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
    now: () => FIXED_NOW,
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
  it("#32 AC-4: 完全な YAML と --yes で、入力のメソッドを一度も呼ばずに確認まで進み、生成して終了コード0", async () => {
    const s = setup();
    const file = s.writeAnswers(baseAnswers() as Record<string, unknown>);
    const out = await runCreate({ answers: file, yes: true }, s.deps);
    expect(s.prompter.inputs).toHaveLength(0);
    expect(out.exitCode).toBe(0);
    expect(generated(s.tmp.cwd)).toBe(true); // 生成した
    expect(s.err()).not.toContain(OLD_STUB_MESSAGE); // 「実装予定」の表示はやめた
    expect(listing(s.tmp.cwd)).toEqual(["testapp-001"]); // 生成先だけ（一時的な場所は残らない）
    expect(out.projectDir).toBe(path.join(s.tmp.cwd, "testapp-001"));
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
    expect(generated(s.tmp.cwd)).toBe(false); // 生成しない
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
    expect(generated(s.tmp.cwd)).toBe(false); // 生成しない
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
    expect(out.exitCode).toBe(0);
    expect(generated(s.tmp.cwd)).toBe(true); // 生成した
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
    expect(generated(s.tmp.cwd)).toBe(false); // 生成しない
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#32 AC-1: 端末で「この内容で生成しますか」に「はい」なら、生成して終了コード0", async () => {
    const s = setup({ confirm_generate: [true] }, { interactive: true });
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>) },
      s.deps,
    );
    expect(out.exitCode).toBe(0);
    expect(generated(s.tmp.cwd)).toBe(true); // 生成した
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
    expect(generated(s.tmp.cwd)).toBe(false); // 生成しない
    expect(listing(s.tmp.cwd)).toEqual([]);
  });

  it("#32 AC-1: --yes なら、端末でも確認を聞かない", async () => {
    const s = setup({}, { interactive: true });
    const out = await runCreate(
      { answers: s.writeAnswers(baseAnswers() as Record<string, unknown>), yes: true },
      s.deps,
    );
    expect(s.prompter.inputs).toHaveLength(0);
    expect(out.exitCode).toBe(0);
    expect(generated(s.tmp.cwd)).toBe(true); // 生成した
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
    expect(out.exitCode).toBe(0);
    expect(generated(s.tmp.cwd)).toBe(true); // 生成した
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
    expect(generated(s.tmp.cwd)).toBe(true); // 生成した
  });

  it("#32 AC-3: 警告あり＋accepted_warnings に承知あり → 確認まで進み、承知した内容が結果に入る", async () => {
    const s = setup();
    const file = s.writeAnswers({ ...warnYaml(), accepted_warnings: ["team-needs-ci"] });
    const out = await runCreate({ answers: file, yes: true }, s.deps);
    expect(generated(s.tmp.cwd)).toBe(true); // 生成した
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
    expect(generated(s.tmp.cwd)).toBe(false); // 生成しない
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#32 AC-3: 端末で警告を承知しないと、終了コード0で何もせず終わる（生成の案内も出さない）", async () => {
    const s = setup({ "accept_warning:team-needs-ci": [false] }, { interactive: true });
    const out = await runCreate({ answers: s.writeAnswers(warnYaml()), yes: true }, s.deps);
    expect(out.exitCode).toBe(0);
    expect(generated(s.tmp.cwd)).toBe(false); // 生成しない
  });

  it("#32 AC-3: 端末で警告を承知すると、承知した内容が結果に入り、確認まで進む", async () => {
    const s = setup(
      { "accept_warning:team-needs-ci": [true], confirm_generate: [true] },
      { interactive: true },
    );
    const out = await runCreate({ answers: s.writeAnswers(warnYaml()) }, s.deps);
    expect(out.acceptedWarnings?.map((w) => w.id)).toEqual(["team-needs-ci"]);
    expect(generated(s.tmp.cwd)).toBe(true); // 生成した
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
    expect(generated(s.tmp.cwd)).toBe(false); // 生成しない
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
    expect(generated(s.tmp.cwd)).toBe(false); // 生成しない
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
    expect(generated(s.tmp.cwd)).toBe(true); // 生成した
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
    expect(generated(s.tmp.cwd)).toBe(false); // 生成しない
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
    expect(generated(s.tmp.cwd)).toBe(true); // 生成した
  });
});

describe("#32 AC-5: 質問の途中でやめる（Ctrl+C）", () => {
  it("#32 AC-5: 最初の質問で中断すると、「中断しました。ファイルは作成していません。」と表示して終了コード130。ファイルは作られない", async () => {
    const s = setup({ app_name: [new CancelledError()] }, { interactive: true });
    const out = await runCreate({}, s.deps);
    expect(out.exitCode).toBe(130);
    expect(s.err()).toContain(CANCEL_MESSAGE);
    expect(generated(s.tmp.cwd)).toBe(false); // 生成しない
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
    expect(generated(s.tmp.cwd)).toBe(true); // 生成した
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
    expect(generated(s.tmp.cwd)).toBe(false); // 生成しない
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
    expect(generated(s.tmp.cwd)).toBe(true); // 生成した
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
    expect(generated(s.tmp.cwd)).toBe(false); // 生成しない
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
    expect(generated(s.tmp.cwd)).toBe(false); // 生成しない
  });
});

// ---------------------------------------------------------------------------
// #34：生成の仕組みと記録（harness create の最後）
//   生成先は必ずテストの一時的なフォルダ（makeTmp。afterEach で cleanupTmp が消す）
// ---------------------------------------------------------------------------

const APP = "testapp-001";
const TMP_PREFIX = `.${APP}.harness-tmp-`;
const answersYaml = (over: Record<string, unknown> = {}) =>
  baseAnswers(over) as Record<string, unknown>;

/** 生成した場所の、すべてのファイルを "/" 区切りの相対パス → 中身 で返す */
function treeOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const full = path.join(dir, rel);
    if (statSync(full).isFile()) out[rel.split(path.sep).join("/")] = readFileSync(full, "utf8");
  }
  return out;
}

describe("#34 AC-3: 生成する（harness create の最後）", () => {
  it("#34 AC-3: 確認で「はい」→ <cwd>/<アプリ名> に生成し、終了コード0。.harness/config.yaml と AGENTS.md ができる", async () => {
    const s = setup({ confirm_generate: [true] }, { interactive: true });
    const out = await runCreate({ answers: s.writeAnswers(answersYaml()) }, s.deps);
    expect(out.exitCode).toBe(0);
    const dir = path.join(s.tmp.cwd, APP);
    expect(existsSync(path.join(dir, ".harness", "config.yaml"))).toBe(true);
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(existsSync(path.join(dir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(path.join(dir, "package.json"))).toBe(true);
    expect(listing(s.tmp.cwd)).toEqual([APP]);
  });

  it("#34 AC-3: 生成した場所と次の手順（README を読む・npm install）を表示する", async () => {
    const s = setup();
    await runCreate({ answers: s.writeAnswers(answersYaml()), yes: true }, s.deps);
    const shown = s.prompter.notes.join("\n");
    expect(shown).toContain(path.join(s.tmp.cwd, APP));
    expect(shown).toContain("README");
    expect(shown).toContain("npm install");
  });

  it("#34 AC-3: config.yaml には、回答・承知した警告・版・生成した日（now）が記録される", async () => {
    const s = setup();
    const file = s.writeAnswers({
      ...answersYaml({ team_size: "team", check_location: "local" }),
      accepted_warnings: ["team-needs-ci"],
    });
    const out = await runCreate({ answers: file, yes: true }, s.deps);
    expect(out.exitCode).toBe(0);
    const cfg = parse(
      readFileSync(path.join(s.tmp.cwd, APP, ".harness", "config.yaml"), "utf8"),
    ) as {
      generated_on: string;
      answers: Record<string, unknown>;
      accepted_warnings: { id: string }[];
      versions: { name: string }[];
    };
    expect(cfg.generated_on).toBe("2026-10-03");
    expect(cfg.answers).toMatchObject({
      app_name: APP,
      team_size: "team",
      check_location: "local",
    });
    expect(cfg.accepted_warnings.map((w) => w.id)).toEqual(["team-needs-ci"]);
    expect(cfg.versions.length).toBeGreaterThan(10);
    // 承知した警告は ADR にも残る
    const adr = readFileSync(
      path.join(s.tmp.cwd, APP, "docs", "adr", "0001-accepted-warnings.md"),
      "utf8",
    );
    expect(adr).toContain("team-needs-ci");
  });

  it("#34 AC-3: 承知した警告がなければ、ADR は作られない", async () => {
    const s = setup();
    await runCreate({ answers: s.writeAnswers(answersYaml()), yes: true }, s.deps);
    expect(existsSync(path.join(s.tmp.cwd, APP, "docs", "adr", "0001-accepted-warnings.md"))).toBe(
      false,
    );
  });

  it("#34 AC-3: Git の初期化はしない（#55 で決める）", async () => {
    const s = setup();
    await runCreate({ answers: s.writeAnswers(answersYaml()), yes: true }, s.deps);
    expect(existsSync(path.join(s.tmp.cwd, APP, ".git"))).toBe(false);
  });

  it("#34 AC-3: Codex だけを選ぶと、Codex の出力だけができる", async () => {
    const s = setup();
    await runCreate(
      { answers: s.writeAnswers(answersYaml({ ais: ["codex"] })), yes: true },
      s.deps,
    );
    const dir = path.join(s.tmp.cwd, APP);
    expect(existsSync(path.join(dir, ".codex"))).toBe(true);
    expect(existsSync(path.join(dir, ".agents"))).toBe(true);
    expect(existsSync(path.join(dir, ".claude"))).toBe(false);
    expect(existsSync(path.join(dir, "CLAUDE.md"))).toBe(false);
  });
});

describe("#34 AC-4: 同じ --answers で2回生成すると、同じ結果になる", () => {
  it("#34 AC-4: 別々のフォルダに2回生成して、ファイルの一覧と中身がすべて同じ（version_policy: verified・fetch はつながらない偽物・now は固定）", async () => {
    const run = async () => {
      const s = setup();
      const out = await runCreate(
        {
          answers: s.writeAnswers(
            answersYaml({
              ais: ["claude", "codex"],
              database: "postgresql",
              postgres_provider: "neon",
            }),
          ),
          yes: true,
        },
        s.deps,
      );
      expect(out.exitCode).toBe(0);
      return treeOf(path.join(s.tmp.cwd, APP));
    };
    const a = await run();
    const b = await run();
    expect(Object.keys(a).length).toBeGreaterThan(40);
    expect(Object.keys(b)).toEqual(Object.keys(a));
    expect(b).toEqual(a);
  });
});

describe("#34 AC-1: 生成先に中身があるときは、エラーにして止める（create）", () => {
  it("#34 AC-1: 生成先が、同じ名前のファイルのときも、整合性チェックのエラーで止まる。ファイルは変わらない", async () => {
    const s = setup();
    writeFileSync(path.join(s.tmp.cwd, APP), "ファイルの中身");
    const out = await runCreate({ answers: s.writeAnswers(answersYaml()), yes: true }, s.deps);
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("target-dir-not-empty");
    expect(readFileSync(path.join(s.tmp.cwd, APP), "utf8")).toBe("ファイルの中身");
    expect(listing(s.tmp.cwd)).toEqual([APP]);
  });

  it("#34 AC-1: 空のフォルダなら生成できる", async () => {
    const s = setup();
    mkdirSync(path.join(s.tmp.cwd, APP));
    const out = await runCreate({ answers: s.writeAnswers(answersYaml()), yes: true }, s.deps);
    expect(out.exitCode).toBe(0);
    expect(generated(s.tmp.cwd)).toBe(true);
    expect(listing(s.tmp.cwd)).toEqual([APP]);
  });

  it("#34 AC-1: チェックの後、書く直前に別のファイルが置かれたら、既存のものには触らず、エラーで終了コード1（一時的な場所は残らない）", async () => {
    const s = setup();
    let n = 0;
    const out = await runCreate(
      { answers: s.writeAnswers(answersYaml()), yes: true },
      {
        ...s.deps,
        generateFs: {
          writeFile: async (file, content) => {
            n += 1;
            await writeFile(file, content, "utf8");
            if (n === 3) {
              mkdirSync(path.join(s.tmp.cwd, APP));
              writeFileSync(path.join(s.tmp.cwd, APP, "other.txt"), "別のプロセスのファイル");
            }
          },
        },
      },
    );
    expect(out.exitCode).toBe(1);
    expect(s.err()).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    expect(treeOf(path.join(s.tmp.cwd, APP))).toEqual({ "other.txt": "別のプロセスのファイル" });
    expect(listing(s.tmp.cwd)).toEqual([APP]);
  });
});

describe("#34 AC-2: 生成が途中で失敗したとき、生成先にファイルが残らない（create）", () => {
  it("#34 AC-2: 3つ目の書き込みで例外にすると、エラーを日本語で示して終了コード1。生成先も一時的な場所も残らない", async () => {
    const s = setup();
    let n = 0;
    const out = await runCreate(
      { answers: s.writeAnswers(answersYaml()), yes: true },
      {
        ...s.deps,
        generateFs: {
          writeFile: async (file, content) => {
            n += 1;
            if (n === 3) throw new Error("disk full (fake)");
            await writeFile(file, content, "utf8");
          },
        },
      },
    );
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain("disk full (fake)");
    expect(s.err()).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    expect(listing(s.tmp.cwd)).toEqual([]);
    expect(s.prompter.notes.join("\n")).not.toContain("npm install"); // 成功の案内は出さない
  });

  it("#34 AC-2: 一時的な場所を消せないときは、エラーに場所（.<アプリ名>.harness-tmp-…）が示され、終了コード1", async () => {
    const s = setup();
    let n = 0;
    const out = await runCreate(
      { answers: s.writeAnswers(answersYaml()), yes: true },
      {
        ...s.deps,
        generateFs: {
          writeFile: async (file, content) => {
            n += 1;
            if (n === 2) throw new Error("disk full (fake)");
            await writeFile(file, content, "utf8");
          },
          rm: async () => {
            throw Object.assign(new Error("EBUSY (fake)"), { code: "EBUSY" });
          },
        },
      },
    );
    expect(out.exitCode).toBe(1);
    expect(s.err()).toContain(TMP_PREFIX);
  });
});

describe("#34 R2: 生成の最中の中断（SIGINT）", () => {
  // 実際の SIGINT の送信は Windows では難しいため、プロセス内で process.emit("SIGINT") で代える（計画 R2）。
  // 実際の CLI を子のプロセスで起動して SIGINT を送るテストは、Windows 以外の CI（macOS・Linux）で別に行う。
  const interrupt = () => process.emit("SIGINT", "SIGINT");

  it("#34 R2: 書き込みの途中で SIGINT → 終了コード130。「中断しました」を表示し、生成先も一時的な場所も残らない", async () => {
    const s = setup();
    let n = 0;
    const out = await runCreate(
      { answers: s.writeAnswers(answersYaml()), yes: true },
      {
        ...s.deps,
        generateFs: {
          writeFile: async (file, content) => {
            n += 1;
            await writeFile(file, content, "utf8");
            if (n === 3) interrupt();
          },
        },
      },
    );
    expect(out.exitCode).toBe(130);
    expect(s.err()).toContain("中断しました");
    expect(s.err()).not.toContain("生成は完了しています");
    expect(n).toBe(3); // 要求の後に、次の書き込みは始めない
    expect(listing(s.tmp.cwd)).toEqual([]);
  });

  it("#34 R2: SIGINT を受ける処理は、生成の間だけ登録され、終わると外れる（成功・失敗・中断のどれでも）", async () => {
    const before = process.listenerCount("SIGINT");
    // 成功
    const ok = setup();
    let during = -1;
    await runCreate(
      { answers: ok.writeAnswers(answersYaml()), yes: true },
      {
        ...ok.deps,
        generateFs: {
          writeFile: async (file, content) => {
            during = process.listenerCount("SIGINT");
            await writeFile(file, content, "utf8");
          },
        },
      },
    );
    expect(during).toBeGreaterThan(before); // 生成の間は登録されている
    expect(process.listenerCount("SIGINT")).toBe(before);
    // 失敗
    const ng = setup();
    await runCreate(
      { answers: ng.writeAnswers(answersYaml()), yes: true },
      {
        ...ng.deps,
        generateFs: {
          writeFile: async () => {
            throw new Error("disk full (fake)");
          },
        },
      },
    );
    expect(process.listenerCount("SIGINT")).toBe(before);
    // 中断
    const stop = setup();
    await runCreate(
      { answers: stop.writeAnswers(answersYaml()), yes: true },
      {
        ...stop.deps,
        generateFs: {
          writeFile: async (file, content) => {
            await writeFile(file, content, "utf8");
            interrupt();
          },
        },
      },
    );
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("#34 R2: 質問・チェックの間（生成の前）には、SIGINT を受ける処理を登録しない", async () => {
    const before = process.listenerCount("SIGINT");
    const s = setup({ confirm_generate: [false] }, { interactive: true });
    await runCreate({ answers: s.writeAnswers(answersYaml()) }, s.deps);
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("#34 R2: 移動の直前に SIGINT → 終了コード130。生成先は作られず、一時的な場所も残らない", async () => {
    const s = setup();
    const target = path.join(s.tmp.cwd, APP);
    let targetChecks = 0;
    const out = await runCreate(
      { answers: s.writeAnswers(answersYaml()), yes: true },
      {
        ...s.deps,
        generateFs: {
          rename: async () => {
            throw new Error("到達しないはず：中断の要求の後に rename しない");
          },
          lstat: async (p) => {
            // 2回目の確かめ（移動の直前）の最中に中断する
            if (path.resolve(p) === path.resolve(target)) {
              targetChecks += 1;
              if (targetChecks === 2) interrupt();
            }
            return lstat(p);
          },
        },
      },
    );
    expect(out.exitCode).toBe(130);
    expect(s.err()).toContain("中断しました");
    expect(listing(s.tmp.cwd)).toEqual([]);
  });

  it("#34 R2: 移動（rename）の直後に SIGINT → 生成は完了しているので生成先を残し、「生成は完了しています」を表示して終了コード130", async () => {
    const s = setup();
    const out = await runCreate(
      { answers: s.writeAnswers(answersYaml()), yes: true },
      {
        ...s.deps,
        generateFs: {
          rename: async (from, to) => {
            await rename(from, to);
            // 最後の項目の移動の後（一時的な場所が空になったとき）だけ中断する
            if ((await readdir(path.dirname(from))).length === 0) interrupt();
          },
        },
      },
    );
    expect(out.exitCode).toBe(130);
    expect(s.err()).toContain("生成は完了しています");
    expect(generated(s.tmp.cwd)).toBe(true);
    expect(listing(s.tmp.cwd)).toEqual([APP]);
  });

  it("#34 R2: 移動の再試行（EPERM）の途中で SIGINT → 終了コード130。生成先は作られず、一時的な場所も残らない", async () => {
    const s = setup();
    let calls = 0;
    const out = await runCreate(
      { answers: s.writeAnswers(answersYaml()), yes: true },
      {
        ...s.deps,
        generateFs: {
          rename: async () => {
            calls += 1;
            throw Object.assign(new Error("EPERM (fake)"), { code: "EPERM" });
          },
          sleep: async () => {
            interrupt();
          },
        },
      },
    );
    expect(out.exitCode).toBe(130);
    expect(calls).toBe(1);
    expect(listing(s.tmp.cwd)).toEqual([]);
  });
});

describe("#34 AC-3: 環境変数・取得の失敗の理由を、生成したファイルに書かない（create）", () => {
  const MARKER = "HARNESS_TEST_SECRET_MARKER_001";

  it("#34 AC-3: process.env の項目と、取得の失敗の理由に目印を入れて生成しても、生成したすべてのファイル（パスを含む）に目印が含まれない", async () => {
    const names = ["HARNESS_TEST_ENV_MARKER_001", "HARNESS_TEST_TOKEN_001", "DATABASE_URL"];
    const saved = names.map((n) => process.env[n]);
    for (const n of names) process.env[n] = MARKER;
    try {
      const failing = (async () => {
        throw new Error(`ECONNREFUSED ${MARKER}`);
      }) as typeof fetch;
      const s = setup({}, { fetch: failing });
      const out = await runCreate({ answers: s.writeAnswers(answersYaml()), yes: true }, s.deps);
      expect(out.exitCode).toBe(0);
      const tree = treeOf(path.join(s.tmp.cwd, APP));
      expect(Object.keys(tree).length).toBeGreaterThan(40);
      for (const [p, content] of Object.entries(tree)) {
        expect(p, p).not.toContain(MARKER);
        expect(content, p).not.toContain(MARKER);
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

// ---------------------------------------------------------------------------
// #34 R2：実際の CLI を子のプロセスで起動して SIGINT を送る（Windows 以外）
//   Windows では、子のプロセスへ SIGINT を送れない（kill("SIGINT") は強制終了になり、Ctrl+C の処理が動かない）ため skip する。
//   Windows の動作は、上の describe のプロセス内のテスト（process.emit("SIGINT")）で確かめる。
//   書き込みを遅くする入口：環境変数ではなく、テストが一時的に書く小さな起動スクリプトが、組み立て済みの dist/commands/create.js の
//   runCreate に、遅い generateFs（writeFile）を渡す。tsx は使わない（実装に必要なのは CreateDeps.generateFs だけ）。
//   dist は、このテストの beforeAll で `tsc -p tsconfig.build.json` を実行して作る。
// ---------------------------------------------------------------------------
describe.skipIf(process.platform === "win32")(
  "#34 R2: 実際の CLI の SIGINT（子のプロセス）",
  () => {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

    beforeAll(() => {
      execFileSync(
        process.execPath,
        [
          path.join(rootDir, "node_modules", "typescript", "bin", "tsc"),
          "-p",
          "tsconfig.build.json",
        ],
        { cwd: rootDir, stdio: "pipe" },
      );
    }, 120_000);

    it("#34 R2: 書き込みが始まったら SIGINT を送ると、終了コード130で終わり、生成先も一時的な場所も残らない", async () => {
      const tmp = makeTmp();
      const answersFile = path.join(tmp.inputDir, "answers.yaml");
      writeFileSync(answersFile, stringify(answersYaml()));
      const createUrl = pathToFileURL(path.join(rootDir, "dist", "commands", "create.js")).href;
      const script = path.join(tmp.inputDir, "slow-create.mjs");
      writeFileSync(
        script,
        `import { writeFile } from "node:fs/promises";
import { runCreate } from ${JSON.stringify(createUrl)};
const fail = () => { throw new Error("到達しないはず"); };
const prompter = { note() {}, text: fail, select: fail, multiselect: fail, confirm: fail };
let first = true;
const out = await runCreate(
  { answers: process.argv[2], yes: true },
  {
    prompter,
    cwd: process.argv[3],
    interactive: false,
    stderr: (t) => process.stderr.write(t),
    checkTools: async () => [
      { name: "node", state: "ok", version: "24.0.0" },
      { name: "git", state: "ok", version: "2.45.0" },
      { name: "docker", state: "ok", version: "27.0.1" },
    ],
    fetch: async () => { throw new Error("offline (fake)"); },
    now: () => new Date("2026-10-03T12:00:00Z"),
    generateFs: {
      writeFile: async (file, content) => {
        if (first) { first = false; process.stdout.write("WRITING\\n"); }
        await new Promise((resolve) => setTimeout(resolve, 300));
        await writeFile(file, content, "utf8");
      },
    },
  },
);
process.exitCode = out.exitCode;
`,
      );
      const child = spawn(process.execPath, [script, answersFile, tmp.cwd], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      const exit = new Promise<number | null>((resolve) =>
        child.on("close", (code) => resolve(code)),
      );
      await new Promise<void>((resolve, reject) => {
        let seen = "";
        const timer = setTimeout(() => reject(new Error("書き込みが始まりません")), 60_000);
        child.stdout.on("data", (d: Buffer) => {
          seen += d.toString();
          if (seen.includes("WRITING")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.on("close", () => {
          clearTimeout(timer);
          reject(new Error(`書き込みの前に終わりました：${stderr}`));
        });
      });
      child.kill("SIGINT");
      const code = await exit;
      expect(code, stderr).toBe(130);
      expect(stderr).toContain("中断しました");
      expect(readdirSync(tmp.cwd)).toEqual([]); // 生成先も一時的な場所も残らない
    }, 120_000);
  },
);
