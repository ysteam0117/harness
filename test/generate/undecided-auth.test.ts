// #79 認証・アップロードを要件定義で決める項目に移す（AC-2・AC-3）
//
// 既定（--answers に書かない）では auth・file_upload が「未定」になる。未定の生成物は認証なし（none）と同じ共通のひな形を出し、
// 認証・アップロードに付随するもの（認証のプロファイル・認証の環境変数・R2 の設定）は出さない。
// 明示した回答（auth: oidc 等）の生成結果は、今までどおり（既存のスナップショット・auth-none-baseline が回帰を守る）。
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { evaluateRules, loadRules, type Facts } from "../../src/checks/rules.js";
import { judge } from "../../src/generate/judgment.js";
import { buildProject, type ProjectFile } from "../../src/generate/project.js";
import { parseAnswersYaml } from "../../src/questions/answers.js";
import { baseAnswers } from "../questions/helpers.js";
import { completeAnswers, contentOf, pathsOf, projectInput } from "./project-helpers.js";

/** 認証・アップロードを省いた（未定の）回答 */
const UNDECIDED = { auth: undefined, idp: undefined, file_upload: undefined } as const;
const NONE = { auth: "none", idp: undefined, file_upload: "no" } as const;

const DBS: Record<string, Record<string, unknown>> = {
  none: { database: "none" },
  d1: { database: "d1" },
  pg: { database: "postgresql", postgres_provider: "neon" },
};

async function generate(over: Record<string, unknown>): Promise<ProjectFile[]> {
  return buildProject(await projectInput(over)).files;
}

const NO_FACTS: Facts = {
  versions_newer_than_verified: false,
  missing_tools: [],
  target_dir_not_empty: false,
  invalid_app_name: false,
};

describe("#79 AC-1：--answers の読み取り", () => {
  const yaml = (o: Record<string, unknown>) => stringify(o);

  it("#79 AC-1: auth・file_upload を省いても読める（書いた分だけ返す）", () => {
    const o = baseAnswers() as Record<string, unknown>;
    delete o.auth;
    delete o.idp;
    delete o.file_upload;
    const parsed = parseAnswersYaml(yaml(o));
    expect(parsed.answers).not.toHaveProperty("auth");
    expect(parsed.answers).not.toHaveProperty("file_upload");
  });

  it("#79 AC-1: auth: undecided・file_upload: undecided を書ける", () => {
    const parsed = parseAnswersYaml(
      yaml(baseAnswers({ auth: "undecided", idp: undefined, file_upload: "undecided" })),
    );
    expect(parsed.answers).toMatchObject({ auth: "undecided", file_upload: "undecided" });
  });

  it("#79 AC-1: 親が未定のとき、idp・file_kinds は書けない（親を省く・親が undecided）", () => {
    const o = baseAnswers({ idp: "google", file_kinds: ["image"] }) as Record<string, unknown>;
    delete o.auth;
    delete o.file_upload;
    const omitted = (): unknown => parseAnswersYaml(yaml(o));
    expect(omitted).toThrow(/idp/);
    expect(omitted).toThrow(/file_kinds/);
    expect(() =>
      parseAnswersYaml(
        yaml(baseAnswers({ auth: "undecided", idp: "google", file_upload: "undecided" })),
      ),
    ).toThrow(/idp/);
  });

  it("#79 AC-1: 明示した auth: oidc・idp・file_upload: yes・file_kinds は受け付ける", () => {
    const parsed = parseAnswersYaml(
      yaml(baseAnswers({ auth: "oidc", idp: "google", file_upload: "yes", file_kinds: ["image"] })),
    );
    expect(parsed.answers).toMatchObject({
      auth: "oidc",
      idp: "google",
      file_upload: "yes",
      file_kinds: ["image"],
    });
  });
});

describe("#79 AC-2：既定（未定）の生成物に、認証・アップロードのひな形が出ない", () => {
  it.each(Object.keys(DBS))(
    "#79 AC-2: %s：認証のプロファイル・R2・アップロードの設定が出ない",
    async (key) => {
      const files = await generate({ ...DBS[key], ...UNDECIDED });
      const paths = pathsOf(files);
      expect(paths.filter((p) => /skills\/auth-/.test(p))).toEqual([]);
      expect(paths.filter((p) => /auth/i.test(p) && !/skills\//.test(p))).toEqual([]);
      expect(paths).not.toContain("infra/r2.tf");
      expect(contentOf(files, ".env.example")).not.toMatch(/SESSION_SECRET|OIDC_|APP_BASE_URL|R2_/);
      expect(contentOf(files, "docs/secrets.md")).not.toMatch(/SESSION_SECRET|OIDC_|APP_BASE_URL/);
      expect(contentOf(files, "wrangler.jsonc")).not.toMatch(/r2_buckets/);
    },
  );

  it("#79 AC-2: 明示すると、今までどおり出る（oidc・yes）", async () => {
    const files = await generate({
      database: "d1",
      auth: "oidc",
      idp: "google",
      file_upload: "yes",
      file_kinds: ["image"],
    });
    const paths = pathsOf(files);
    expect(paths.filter((p) => /skills\/auth-/.test(p)).length).toBeGreaterThan(0);
    expect(paths).toContain("infra/r2.tf");
    expect(contentOf(files, ".env.example")).toContain("SESSION_SECRET=");
  });

  it("#79 AC-2: 要件定義書の「未決定事項」に、独自認証の行が出ない", async () => {
    const text = contentOf(await generate({ ...DBS.d1, ...UNDECIDED }), "docs/requirements.md");
    const section = text.slice(text.indexOf("## 7. 未決定事項"));
    expect(section.split("\n").filter((l) => /^\| \d+ \|/.test(l))).toHaveLength(0);
  });
});

describe("#79 R1：未定の生成結果は、認証なし（none）と同じ共通のひな形を出す", () => {
  /** 回答・判定の違いで変わる文書を除いた、アプリの側のファイル */
  const isApp = (p: string): boolean =>
    /^(backend|frontend|e2e|infra|prototype)\//.test(p) ||
    ["package.json", "drizzle.config.ts", "wrangler.jsonc", "docker-compose.yml"].includes(p);

  it.each(Object.keys(DBS))(
    "#79 R1: %s：アプリの側のファイルの一覧と中身が、auth: none の生成結果と同じ",
    async (key) => {
      const undecided = await generate({ ...DBS[key], ...UNDECIDED });
      const none = await generate({ ...DBS[key], ...NONE });
      const pick = (files: ProjectFile[]) =>
        files.filter((f) => isApp(f.path)).map((f) => `${f.path}\n${f.content}`);
      expect(pick(undecided)).toEqual(pick(none));
      expect(pick(undecided).length).toBeGreaterThan(5);
    },
  );

  it.each(["d1", "pg"])(
    "#79 R1: %s：drizzle の共通のファイル（index.ts・cleanup.sql・drizzle.config.ts・_journal.json）と App.tsx が出る",
    async (key) => {
      const paths = pathsOf(await generate({ ...DBS[key], ...UNDECIDED }));
      for (const p of [
        "backend/src/index.ts",
        "backend/db/seeds/cleanup.sql",
        "drizzle.config.ts",
        "backend/db/migrations/meta/_journal.json",
        "frontend/src/App.tsx",
      ]) {
        expect(paths, p).toContain(p);
      }
    },
  );

  it.each(Object.keys(DBS))(
    "#79 R1: %s：auth: none との違いは、認証・アップロードのひな形ではない（ファイルの一覧は、判定で出し入れされる文書だけが違ってよい）",
    async (key) => {
      const undecided = pathsOf(await generate({ ...DBS[key], ...UNDECIDED }));
      const none = pathsOf(await generate({ ...DBS[key], ...NONE }));
      const diff = [
        ...undecided.filter((p) => !none.includes(p)),
        ...none.filter((p) => !undecided.includes(p)),
      ];
      expect(diff.filter((p) => !p.startsWith("docs/"))).toEqual([]);
    },
  );
});

describe("#79 AC-2：F-26 の判定と整合性チェックが、未定で安全側に動く", () => {
  it("#79 AC-2: auth が未定のとき、admin・collaborative は未定のまま（なしに決まらない）で、安全側（レベル2以上・ペネトレーション必須）", async () => {
    // baseAnswers は admin・collaborative を「no」と明示するため、省いて（auth に従って決まる値を見る）
    const answers = await completeAnswers({
      ...UNDECIDED,
      admin: undefined,
      collaborative: undefined,
    });
    expect(answers.auth).toBe("undecided");
    expect(answers.file_upload).toBe("undecided");
    expect(answers.admin).toBe("undecided");
    expect(answers.collaborative).toBe("undecided");
    const j = judge(answers);
    expect(j.undecided).toEqual(expect.arrayContaining(["admin", "collaborative"]));
    expect(j.asvsLevel).toBeGreaterThanOrEqual(2);
    expect(j.pentestRequired).toBe(true);
    expect(j.enabledRules).toEqual(expect.arrayContaining(["C-14", "C-20"]));
  });

  it("#79 AC-2: auth が none（明示）なら、admin・collaborative は「なし」に決まる（今までどおり）", async () => {
    const answers = await completeAnswers({ ...NONE });
    expect(answers.admin).toBe("no");
    expect(answers.collaborative).toBe("no");
  });

  it("#79 AC-2: DB なしでも、未定の auth・file_upload では auth-needs-db・upload-needs-db・upload-without-auth が出ない", () => {
    const r = evaluateRules(
      loadRules(),
      baseAnswers({
        database: "none",
        auth: "undecided",
        idp: undefined,
        file_upload: "undecided",
      }),
      NO_FACTS,
    );
    const ids = [...r.errors, ...r.warnings, ...r.infos].map((h) => h.id);
    for (const id of ["auth-needs-db", "upload-needs-db", "upload-without-auth"]) {
      expect(ids).not.toContain(id);
    }
  });

  it("#79 AC-2: 明示した auth: oidc ＋ DB なしは、今までどおり auth-needs-db のエラー", () => {
    const r = evaluateRules(loadRules(), baseAnswers({ database: "none", auth: "oidc" }), NO_FACTS);
    expect(r.errors.map((h) => h.id)).toContain("auth-needs-db");
  });

  it("#79: upload-without-auth は「yes＋未定」に広げない（今までどおり yes＋none だけ）", () => {
    const hit = (o: Record<string, unknown>) =>
      evaluateRules(loadRules(), baseAnswers({ database: "d1", ...o }), NO_FACTS).warnings.map(
        (h) => h.id,
      );
    expect(hit({ file_upload: "yes", auth: "undecided", idp: undefined })).not.toContain(
      "upload-without-auth",
    );
    expect(hit({ file_upload: "yes", auth: "none", idp: undefined })).toContain(
      "upload-without-auth",
    );
  });
});

describe("#79 AC-3：要件定義書と Skill「実装の進め方」に、認証・アップロードを決める項目と従うルールがある", () => {
  it("#79 AC-3: 要件定義書：節・認証方式・アップロード・C-12〜C-20・F-26・C-63・config.yaml の更新", async () => {
    const files = await generate({ ...DBS.d1, ...UNDECIDED });
    const text = contentOf(files, "docs/requirements.md");
    expect(text).toContain("要件定義で決める機能の項目");
    expect(text).toContain("認証方式");
    expect(text).toContain("アップロード");
    expect(text).toContain("未定（要件定義で決める）");
    for (const k of ["C-12", "C-20", "F-26", "C-63", ".harness/config.yaml"]) {
      expect(text, k).toContain(k);
    }
    expect(text).not.toContain("{{");
  });

  it("#79 AC-3: 要件定義書：明示した回答のときは、その値が入る", async () => {
    const text = contentOf(
      await generate({ database: "d1", auth: "oidc", idp: "google", file_upload: "no" }),
      "docs/requirements.md",
    );
    const section = text.slice(text.indexOf("要件定義で決める機能の項目"));
    expect(section).toContain("OIDC");
    expect(section).toContain("使わない");
  });

  it("#79 AC-3: Skill「実装の進め方」（claude・codex の両方）に、同じ内容がある", async () => {
    const files = await generate({ ...DBS.d1, ...UNDECIDED, ais: ["claude", "codex"] });
    const skills = pathsOf(files).filter((p) =>
      /skills\/implementation-process\/SKILL\.md$/.test(p),
    );
    expect(skills.length).toBe(2);
    for (const p of skills) {
      const text = contentOf(files, p);
      for (const k of ["認証", "アップロード", "C-12", "F-26", "C-63", ".harness/config.yaml"]) {
        expect(text, `${p}：${k}`).toContain(k);
      }
      expect(text).not.toContain("{{");
    }
  });

  it("#79 AC-3: 認証方式の表示は「未定」", async () => {
    const files = await generate({ ...DBS.d1, ...UNDECIDED });
    expect(contentOf(files, "README.md")).toContain("認証：未定");
  });
});
