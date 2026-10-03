// 想定する型（実装は src/generate/judgment.ts をこれに合わせる）。F-26 の判定
//
//   export interface Judgment {
//     asvsLevel: 1 | 2 | 3;        // 3 は「レベル3を検討」の意味（検討の結果は ADR に記録する）
//     pentestRequired: boolean;    // ペネトレーションテストが必須か（C-82）
//     pentestReasons: string[];    // 必須の理由（日本語の短い文。必須でなければ []）
//     undecided: string[];         // 「未定」の質問の id（personal_data・admin・critical_ops・collaborative・
//                                  //   org_separation・realtime・availability の順。要件定義で決める項目）
//     enabledRules: string[];      // 有効にする共通仕様の番号（"C-14" の形。重複なし・昇順）
//   }
//   export function judge(answers: Answers): Judgment;
//
// 判定の規則（functional.md F-26。計画 R7）
//   A 個人情報（personal_data）：basic → レベル2・必須／sensitive → レベル3・必須
//   B 管理者（admin）：yes → レベル2・必須。C-14・C-20・C-30
//   C 重要な操作（critical_ops + critical_ops_kinds）：yes（未定も）→ レベル2・必須。決済（payment）を含めばレベル3。C-20・C-66（影響大として扱う）
//   D 共同編集（collaborative）：yes → C-14・C-64（レベル・必須には影響しない）
//   E 組織の分離（org_separation）：yes → 必須・C-14
//   F リアルタイム（realtime）：yes → C-77
//   G 可用性（availability）：critical → C-79・C-41
//   「未定」は安全側（扱う・ある・する）として判定し、undecided に入れる
import { describe, expect, it } from "vitest";
import { judge } from "../../src/generate/judgment.js";
import { completeAnswers } from "./project-helpers.js";

/** A〜G をすべて「ない」にした回答に、上書きを重ねる */
const none = {
  personal_data: "none",
  admin: "no",
  critical_ops: "no",
  collaborative: "no",
  org_separation: "no",
  realtime: "no",
  availability: "tolerant",
};

const ALL_UNDECIDED = {
  personal_data: "undecided",
  admin: "undecided",
  critical_ops: "undecided",
  collaborative: "undecided",
  org_separation: "undecided",
  realtime: "undecided",
  availability: "undecided",
};

const judgeWith = async (over: Record<string, unknown>) =>
  judge(await completeAnswers({ ...none, ...over }));

type Row = {
  name: string;
  over: Record<string, unknown>;
  level: 1 | 2 | 3;
  pentest: boolean;
  rules: string[];
};

describe("#34 R7: 判定（各条件を単独で満たす表）", () => {
  const rows: Row[] = [
    { name: "すべてない", over: {}, level: 1, pentest: false, rules: [] },
    {
      name: "A=扱う（basic）",
      over: { personal_data: "basic" },
      level: 2,
      pentest: true,
      rules: ["C-09", "C-19", "C-30"],
    },
    {
      name: "A=特に配慮が必要（sensitive）",
      over: { personal_data: "sensitive" },
      level: 3,
      pentest: true,
      rules: ["C-09", "C-19", "C-30"],
    },
    {
      name: "B=ある",
      over: { admin: "yes" },
      level: 2,
      pentest: true,
      rules: ["C-14", "C-20", "C-30"],
    },
    {
      name: "C=ある（決済）",
      over: { critical_ops: "yes", critical_ops_kinds: ["payment"] },
      level: 3,
      pentest: true,
      rules: ["C-20", "C-66"],
    },
    {
      name: "C=ある（公開範囲を広げる）",
      over: { critical_ops: "yes", critical_ops_kinds: ["publish"] },
      level: 2,
      pentest: true,
      rules: ["C-20", "C-66"],
    },
    {
      name: "C=ある（削除）",
      over: { critical_ops: "yes", critical_ops_kinds: ["delete"] },
      level: 2,
      pentest: true,
      rules: ["C-20", "C-66"],
    },
    {
      name: "C=ある（権限の変更）",
      over: { critical_ops: "yes", critical_ops_kinds: ["permission"] },
      level: 2,
      pentest: true,
      rules: ["C-20", "C-66"],
    },
    {
      name: "C=ある（決済と削除）",
      over: { critical_ops: "yes", critical_ops_kinds: ["delete", "payment"] },
      level: 3,
      pentest: true,
      rules: ["C-20", "C-66"],
    },
    {
      name: "D=する",
      over: { collaborative: "yes" },
      level: 1,
      pentest: false,
      rules: ["C-14", "C-64"],
    },
    {
      name: "E=分ける",
      over: { org_separation: "yes" },
      level: 1,
      pentest: true,
      rules: ["C-14"],
    },
    { name: "F=必要", over: { realtime: "yes" }, level: 1, pentest: false, rules: ["C-77"] },
    {
      name: "G=止まると困る",
      over: { availability: "critical" },
      level: 1,
      pentest: false,
      rules: ["C-79", "C-41"],
    },
  ];

  for (const row of rows) {
    it(`#34 R7: ${row.name} → レベル${row.level}・ペネトレーションテスト${row.pentest ? "必須" : "任意"}`, async () => {
      const j = await judgeWith(row.over);
      expect(j.asvsLevel).toBe(row.level);
      expect(j.pentestRequired).toBe(row.pentest);
      expect(j.undecided).toEqual([]);
      if (row.rules.length === 0) expect(j.enabledRules).toEqual([]);
      for (const rule of row.rules) expect(j.enabledRules, rule).toContain(rule);
    });
  }

  it("#34 R7: 必須のときは理由が1つ以上あり、必須でないときは空", async () => {
    const required = await judgeWith({ personal_data: "basic" });
    expect(required.pentestReasons.length).toBeGreaterThan(0);
    for (const r of required.pentestReasons) expect(r).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    expect((await judgeWith({})).pentestReasons).toEqual([]);
  });

  it("#34 R7: 条件が重なると、いちばん高いレベルになる（A=basic と C=決済 → レベル3）", async () => {
    const j = await judgeWith({
      personal_data: "basic",
      critical_ops: "yes",
      critical_ops_kinds: ["payment"],
      admin: "yes",
    });
    expect(j.asvsLevel).toBe(3);
    expect(j.enabledRules).toEqual(expect.arrayContaining(["C-09", "C-14", "C-20", "C-30"]));
  });

  it("#34 R7: enabled_rules は重複がなく、昇順に並ぶ（同じ入力なら同じ結果）", async () => {
    const j = await judgeWith({
      personal_data: "basic",
      admin: "yes",
      collaborative: "yes",
      org_separation: "yes",
    });
    expect(new Set(j.enabledRules).size).toBe(j.enabledRules.length);
    expect(j.enabledRules).toEqual([...j.enabledRules].sort());
    expect(j.enabledRules.every((r) => /^C-\d{2}$/.test(r))).toBe(true);
    expect(await judgeWith({ personal_data: "basic", admin: "yes" })).toEqual(
      await judgeWith({ personal_data: "basic", admin: "yes" }),
    );
  });
});

describe("#34 R7: 未定は安全側（扱う・ある・する）", () => {
  it("#34 R7: A〜G がすべて未定 → レベル2・ペネトレーションテスト必須・未定の一覧（7項目）", async () => {
    const j = await judgeWith(ALL_UNDECIDED);
    expect(j.asvsLevel).toBe(2);
    expect(j.pentestRequired).toBe(true);
    expect(j.undecided).toEqual([
      "personal_data",
      "admin",
      "critical_ops",
      "collaborative",
      "org_separation",
      "realtime",
      "availability",
    ]);
  });

  it("#34 R7: 未定のとき、安全側の規則が有効になる（C-14・C-64・C-77・C-79・C-41）", async () => {
    const j = await judgeWith(ALL_UNDECIDED);
    for (const rule of ["C-14", "C-64", "C-77", "C-79", "C-41", "C-20", "C-66"]) {
      expect(j.enabledRules, rule).toContain(rule);
    }
  });

  it("#34 R7: 回答を書かない質問A〜G は未定として扱われる（既定の「未定」）", async () => {
    const j = judge(
      await completeAnswers({
        personal_data: undefined,
        admin: undefined,
        critical_ops: undefined,
        collaborative: undefined,
        org_separation: undefined,
        realtime: undefined,
        availability: undefined,
      }),
    );
    expect(j.undecided).toHaveLength(7);
    expect(j.asvsLevel).toBe(2);
    expect(j.pentestRequired).toBe(true);
  });

  it("#34 R7: 1項目だけ未定（F=未定）なら、その項目だけが一覧に入り、ほかの判定は変わらない", async () => {
    const j = await judgeWith({ realtime: "undecided" });
    expect(j.undecided).toEqual(["realtime"]);
    expect(j.asvsLevel).toBe(1);
    expect(j.pentestRequired).toBe(false);
    expect(j.enabledRules).toContain("C-77");
  });

  it("#34 R7: A だけ未定 → 扱うとして、レベル2・必須", async () => {
    const j = await judgeWith({ personal_data: "undecided" });
    expect(j.undecided).toEqual(["personal_data"]);
    expect(j.asvsLevel).toBe(2);
    expect(j.pentestRequired).toBe(true);
  });

  it("#34 R7: C だけ未定 → あるとして、レベル2・必須。未定の一覧に critical_ops が入る", async () => {
    const j = await judgeWith({ critical_ops: "undecided" });
    expect(j.undecided).toEqual(["critical_ops"]);
    expect(j.asvsLevel).toBeGreaterThanOrEqual(2);
    expect(j.pentestRequired).toBe(true);
    expect(j.enabledRules).toContain("C-20");
    expect(j.enabledRules).toContain("C-66");
  });

  it("#34 R7: 認証が「なし」なら、B・D は自動で「ない」に決まるので、未定に入らない", async () => {
    const j = await judgeWith({
      auth: "none",
      idp: undefined,
      admin: undefined,
      collaborative: undefined,
    });
    expect(j.undecided).not.toContain("admin");
    expect(j.undecided).not.toContain("collaborative");
    expect(j.enabledRules).not.toContain("C-64");
  });

  it("#34 R7: 未定のない回答では、未定の一覧は空", async () => {
    expect((await judgeWith({})).undecided).toEqual([]);
  });
});
