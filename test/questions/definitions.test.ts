// 想定する型：src/questions/definitions.ts
//   export interface Condition { id: string; equals?: string; in?: string[]; notEquals?: string }   // 他の質問の回答への条件
//   export interface QuestionOption { value: string; label: string }                                // label は日本語（例：「Cloudflare D1（標準）」）
//   export interface QuestionDefinition {
//     id: string; title: string;                       // title は日本語の見出し
//     kind: "text" | "select" | "multiselect";
//     options?: QuestionOption[];                      // select・multiselect
//     when?: Condition;                                // この条件のときだけ聞く（なければ常に聞く）
//     forced?: { when: Condition; value: string };     // この条件のとき、聞かずに value で決める（B・D：auth = none → no）
//     initialValue?: string;                           // 初期値（推奨）
//     validate?: (value: string) => string | undefined;
//   }
//   export const questionDefinitions: readonly QuestionDefinition[];
//   選択肢が1つだけの select は「自動で決定」として扱う
import { describe, expect, it } from "vitest";
import { questionDefinitions as defs } from "../../src/questions/definitions.js";
import { validateAppName } from "../../src/questions/app-name.js";

const byId = (id: string) => defs.find((d) => d.id === id);
const values = (id: string) => byId(id)?.options?.map((o) => o.value);
const JAPANESE = /[ぁ-んァ-ヶ一-龠]/;

describe("#32 AC-1: 質問の定義（データ）", () => {
  it("#32 AC-1: functional.md の質問順どおりに並ぶ", () => {
    expect(defs.map((d) => d.id)).toEqual([
      "app_name",
      "ais",
      "project_type",
      "layers",
      "repository",
      "visibility",
      "team_size",
      "frontend",
      "backend",
      "infra",
      "database",
      "postgres_provider",
      "data_access",
      "auth",
      "idp",
      "personal_data",
      "admin",
      "critical_ops",
      "critical_ops_kinds",
      "collaborative",
      "org_separation",
      "realtime",
      "availability",
      "file_upload",
      "file_kinds",
      "check_location",
      "version_policy",
    ]);
  });

  it("#32 AC-1: id は英小文字とアンダースコアで、重複しない", () => {
    const ids = defs.map((d) => d.id);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z_]*$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("#32 AC-1: 種類が計画どおり（text・multiselect・select）", () => {
    expect(byId("app_name")?.kind).toBe("text");
    for (const id of ["ais", "critical_ops_kinds", "file_kinds"]) {
      expect(byId(id)?.kind).toBe("multiselect");
    }
    const others = defs.filter(
      (d) => !["app_name", "ais", "critical_ops_kinds", "file_kinds"].includes(d.id),
    );
    for (const d of others) expect(d.kind).toBe("select");
  });

  it("#32 AC-1: 見出しと選択肢の表示は日本語で、値は英字", () => {
    for (const d of defs) {
      expect(d.title).toMatch(JAPANESE);
      for (const o of d.options ?? []) {
        expect(o.label).toMatch(JAPANESE);
        expect(o.value).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it("#32 AC-1: 選択肢の値が計画どおり", () => {
    expect(values("ais")).toEqual(["claude", "codex"]);
    expect(values("project_type")).toEqual(["web"]);
    expect(values("layers")).toEqual(["frontend_backend"]);
    expect(values("visibility")).toEqual(["public", "private"]);
    expect(values("team_size")).toEqual(["solo", "team"]);
    expect(values("frontend")).toEqual(["react"]);
    expect(values("backend")).toEqual(["hono"]);
    expect(values("infra")).toEqual(["cloudflare"]);
    expect(values("database")).toEqual(["d1", "postgresql", "none"]);
    expect(values("postgres_provider")).toEqual(["neon", "supabase", "other"]);
    expect(values("data_access")).toEqual(["drizzle"]);
    expect(values("auth")).toEqual(["none", "app", "oidc", "both", "undecided"]);
    expect(values("idp")).toEqual(["google", "microsoft", "other"]);
    expect(values("personal_data")).toEqual(["none", "basic", "sensitive", "undecided"]);
    for (const id of ["admin", "critical_ops", "collaborative", "org_separation", "realtime"]) {
      expect(values(id)).toEqual(["no", "yes", "undecided"]);
    }
    expect(values("critical_ops_kinds")).toEqual(["payment", "publish", "delete", "permission"]);
    expect(values("availability")).toEqual(["tolerant", "critical", "undecided"]);
    expect(values("file_upload")).toEqual(["no", "yes", "undecided"]);
    expect(values("file_kinds")).toEqual(["image", "video", "document"]);
    expect(values("check_location")).toEqual(["local", "github_actions", "both"]);
    expect(values("version_policy")).toEqual(["verified", "latest"]);
  });

  it("#32 AC-1: 選択肢が1つの select は project_type・layers・frontend・backend・infra・data_access だけ", () => {
    const single = defs.filter((d) => d.kind === "select" && d.options?.length === 1);
    expect(single.map((d) => d.id)).toEqual([
      "project_type",
      "layers",
      "frontend",
      "backend",
      "infra",
      "data_access",
    ]);
  });

  it("#32 AC-1: DB の「Cloudflare D1」の選択肢に「（標準）」が付く", () => {
    const d1 = byId("database")?.options?.find((o) => o.value === "d1");
    expect(d1?.label).toContain("D1");
    expect(d1?.label).toContain("（標準）");
  });

  it("#32 AC-1: 条件の質問の条件が計画どおり", () => {
    expect(byId("postgres_provider")?.when).toMatchObject({ id: "database", equals: "postgresql" });
    expect(byId("data_access")?.when).toMatchObject({ id: "database", notEquals: "none" });
    expect(byId("idp")?.when).toMatchObject({ id: "auth", in: ["oidc", "both"] });
    expect(byId("critical_ops_kinds")?.when).toMatchObject({ id: "critical_ops", equals: "yes" });
    expect(byId("file_kinds")?.when).toMatchObject({ id: "file_upload", equals: "yes" });
  });

  it("#32 AC-2: admin・collaborative は、auth = none のとき「no」に決まる定義を持つ", () => {
    for (const id of ["admin", "collaborative"]) {
      expect(byId(id)?.forced).toMatchObject({ when: { id: "auth", equals: "none" }, value: "no" });
    }
  });

  it("#79 AC-1: auth・idp・file_upload・file_kinds は対話で聞かない。auth・file_upload の既定は「未定」", () => {
    for (const id of ["auth", "idp", "file_upload", "file_kinds"]) {
      expect(byId(id)?.interactive, id).toBe(false);
    }
    expect(byId("auth")?.defaultValue).toBe("undecided");
    expect(byId("file_upload")?.defaultValue).toBe("undecided");
    expect(byId("idp")?.defaultValue).toBeUndefined();
    expect(byId("file_kinds")?.defaultValue).toBeUndefined();
    expect(byId("auth")?.initialValue).toBeUndefined();
  });

  it("#32 AC-1: app_name の入力の確かめは validateAppName と同じ判定", () => {
    const validate = byId("app_name")?.validate;
    expect(validate).toBeTypeOf("function");
    for (const name of ["testapp-001", "-abc", "Bad_Name", "", "a--b"]) {
      expect(validate?.(name)).toBe(validateAppName(name));
    }
  });

  it("#32 AC-2: 質問A〜G は対話で聞かない定義（interactive: false）で、聞かない場合の値は「undecided」（critical_ops_kinds は値なし）", () => {
    const asvs = [
      "personal_data",
      "admin",
      "critical_ops",
      "critical_ops_kinds",
      "collaborative",
      "org_separation",
      "realtime",
      "availability",
    ];
    for (const id of asvs) {
      expect(byId(id)?.interactive).toBe(false);
      if (id === "critical_ops_kinds") {
        expect(byId(id)?.defaultValue).toBeUndefined();
      } else {
        expect(byId(id)?.defaultValue).toBe("undecided");
      }
    }
    // A〜G と、auth・idp・file_upload・file_kinds（#79）以外は対話で聞く（interactive が false でない）
    const notAsked = [...asvs, "auth", "idp", "file_upload", "file_kinds"];
    for (const d of defs.filter((d) => !notAsked.includes(d.id))) {
      expect(d.interactive).not.toBe(false);
    }
  });

  it("#32 AC-2: 質問C の選択肢 publish の表示は「公開範囲を広げる」を含む", () => {
    const publish = byId("critical_ops_kinds")?.options?.find((o) => o.value === "publish");
    expect(publish?.label).toContain("公開範囲を広げる");
  });
});
