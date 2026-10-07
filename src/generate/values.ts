import type { Answers } from "../questions/answers.js";
import { questionDefinitions } from "../questions/definitions.js";
import { parseWhen, whenMatches, type When } from "./conditions.js";
import { isPlainObject, readDataYaml } from "./data.js";
import { GenerateError } from "./errors.js";
import { judge, type Judgment } from "./judgment.js";
import { knowledgeIndexRows, selectKnowledge, type KnowledgeEntry } from "./knowledge.js";
import { rolesFor } from "./roles.js";

export interface BuildValuesInput {
  /** 完全な回答（自動で決まる値・未定を含む） */
  answers: Answers;
  /** 既定は judge(answers) */
  judgment?: Judgment;
  /** 写す知見。既定は selectKnowledge(answers) */
  knowledge?: KnowledgeEntry[];
  /** 選んだ Node.js の版。docker-compose.yml の image に使う（渡したときだけ値 node_version を作る） */
  nodeVersion?: string;
}

export type Choice = { when?: When; value: string };
export type Definition = string | Choice[];

const VALUES_FILE = "template-values.yaml";
const ENV_FILE = "env-items.yaml";
const NAME_RE = /^[a-z][a-z0-9_]*$/;

let cachedDefinitions: Record<string, Definition> | undefined;

/** 「名前: 値」または「名前: [- when / value の並び]」の YAML を読んで、定義にする（label はエラーの文に入れるファイルの名前） */
export function parseValueDefinitions(doc: unknown, label: string): Record<string, Definition> {
  if (!isPlainObject(doc)) {
    throw new GenerateError(`${label}：「名前: 値」の形で書いてください`);
  }
  const out: Record<string, Definition> = {};
  for (const [name, raw] of Object.entries(doc)) {
    const at = `${label} の ${name}`;
    if (!NAME_RE.test(name)) {
      throw new GenerateError(`${at}：名前は英小文字・数字・_ で書いてください`);
    }
    if (typeof raw === "string") {
      out[name] = raw;
      continue;
    }
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new GenerateError(`${at}：文字列か、「- when: ...、value: ...」の並びで書いてください`);
    }
    out[name] = raw.map((item, index): Choice => {
      const where = `${at} の ${index + 1} 番目`;
      if (!isPlainObject(item)) {
        throw new GenerateError(`${where}：「value: 値」の形で書いてください`);
      }
      for (const key of Object.keys(item)) {
        if (key !== "when" && key !== "value") {
          throw new GenerateError(`${where}：知らない項目 ${key} があります（書き間違いの可能性）`);
        }
      }
      const value = item["value"];
      if (typeof value !== "string") {
        throw new GenerateError(`${where}：value は文字列で書いてください`);
      }
      return item["when"] === undefined
        ? { value }
        : { when: parseWhen(item["when"], where), value };
    });
  }
  return out;
}

/** 定義から、回答に合う値を選ぶ。合う値がなければ GenerateError（skipUnmatched が真なら、その名前を飛ばす） */
export function chooseValues(
  defs: Record<string, Definition>,
  answers: Answers,
  label: string,
  skipUnmatched = false,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, def] of Object.entries(defs)) {
    if (typeof def === "string") {
      values[name] = def;
      continue;
    }
    const chosen = def.find((c) => whenMatches(c.when, answers));
    if (!chosen) {
      if (skipUnmatched) continue;
      throw new GenerateError(
        `${label} の ${name}：この回答に合う値がありません（最後に、when のない行を書いてください）`,
      );
    }
    values[name] = chosen.value;
  }
  return values;
}

function loadDefinitions(): Record<string, Definition> {
  if (cachedDefinitions) return cachedDefinitions;
  cachedDefinitions = parseValueDefinitions(readDataYaml(VALUES_FILE), `data/${VALUES_FILE}`);
  return cachedDefinitions;
}

interface EnvItem {
  name: string;
  purpose: string;
  development: string;
  test: string;
  production: string;
  /** .env.example に書く値（空か、changeme・<…> のプレースホルダ） */
  example: string;
  when?: When;
}

let cachedEnvItems: EnvItem[] | undefined;

function loadEnvItems(): EnvItem[] {
  if (cachedEnvItems) return cachedEnvItems;
  const doc = readDataYaml(ENV_FILE);
  if (!Array.isArray(doc)) {
    throw new GenerateError(`data/${ENV_FILE}：「- name: 項目名」の並びで書いてください`);
  }
  cachedEnvItems = doc.map((item, index): EnvItem => {
    const at = `data/${ENV_FILE} の ${index + 1} 番目`;
    if (!isPlainObject(item)) throw new GenerateError(`${at}：「項目: 値」の形で書いてください`);
    const known = ["name", "purpose", "development", "test", "production", "example", "when"];
    for (const key of Object.keys(item)) {
      if (!known.includes(key)) {
        throw new GenerateError(`${at}：知らない項目 ${key} があります（書き間違いの可能性）`);
      }
    }
    const text = (key: string): string => {
      const v = item[key];
      if (typeof v !== "string" || v === "" || /[|\r\n]/.test(v)) {
        throw new GenerateError(
          `${at}：${key} は、空でなく、| と改行を含まない文字列で書いてください`,
        );
      }
      return v;
    };
    const example = item["example"];
    if (
      example !== undefined &&
      (typeof example !== "string" || /[\r\n]/.test(example) || example !== example.trim())
    ) {
      throw new GenerateError(
        `${at}：example は、改行と前後の空白を含まない文字列で書いてください`,
      );
    }
    const base = {
      name: text("name"),
      purpose: text("purpose"),
      development: text("development"),
      test: text("test"),
      production: text("production"),
      example: example ?? "",
    };
    return item["when"] === undefined ? base : { ...base, when: parseWhen(item["when"], at) };
  });
  return cachedEnvItems;
}

function labelOf(id: string, value: unknown): string {
  const def = questionDefinitions.find((d) => d.id === id);
  const label = def?.options?.find((o) => o.value === value)?.label;
  if (label === undefined) {
    throw new GenerateError(`回答 ${id} の値 ${JSON.stringify(value)} の表示の名前がありません`);
  }
  return label;
}

/** 開発用の PostgreSQL のコンテナの版（data/runtimes.yaml の postgres_image_tag） */
function postgresImageTag(): string {
  const doc = readDataYaml("runtimes.yaml");
  const tag = isPlainObject(doc) ? doc["postgres_image_tag"] : undefined;
  if (typeof tag !== "string" || !/^\d+(\.\d+)?$/.test(tag)) {
    throw new GenerateError(
      "data/runtimes.yaml：postgres_image_tag に、PostgreSQL の版（例：18.6）を書いてください",
    );
  }
  return tag;
}

/** compatibility_date（data/runtimes.yaml） */
function compatibilityDate(): string {
  const doc = readDataYaml("runtimes.yaml");
  const date = isPlainObject(doc) ? doc["compatibility_date"] : undefined;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new GenerateError(
      "data/runtimes.yaml：compatibility_date に、YYYY-MM-DD の日付を書いてください",
    );
  }
  return date;
}

/** Terraform と Cloudflare プロバイダーの版（data/runtimes.yaml）。infra/versions.tf・docs/tech-stack.md に使う */
export function terraformVersions(): { terraform: string; cloudflareProvider: string } {
  const doc = readDataYaml("runtimes.yaml");
  const text = (key: string, shape: RegExp, example: string): string => {
    const value = isPlainObject(doc) ? doc[key] : undefined;
    if (typeof value !== "string" || !shape.test(value)) {
      throw new GenerateError(
        `data/runtimes.yaml：${key} に、版（例：${example}）を書いてください`,
      );
    }
    return value;
  };
  return {
    terraform: text("terraform_version", /^[0-9]+[.][0-9]+[.][0-9]+$/, "1.15.5"),
    cloudflareProvider: text("terraform_cloudflare_provider", /^5[.][0-9]+[.][0-9]+$/, "5.26.0"),
  };
}

function pentestRequirement(judgment: Judgment): string {
  return judgment.pentestRequired
    ? `初回のリリースの前に必須（${judgment.pentestReasons.join("、")}）`
    : "任意（推奨）";
}

function asvsLevel(judgment: Judgment): string {
  return judgment.asvsLevel === 3 ? "3を検討（結果をADRに記録する）" : String(judgment.asvsLevel);
}

/** 要件定義書の判定の結果の表（質問A〜G。F-26） */
const JUDGMENT_QUESTIONS = [
  ["A", "personal_data"],
  ["B", "admin"],
  ["C", "critical_ops"],
  ["D", "collaborative"],
  ["E", "org_separation"],
  ["F", "realtime"],
  ["G", "availability"],
] as const;

function titleOf(id: string): string {
  const title = questionDefinitions.find((d) => d.id === id)?.title;
  if (title === undefined) throw new GenerateError(`質問 ${id} の定義がありません`);
  return title;
}

function judgmentTable(answers: Answers): string {
  const raw = answers as unknown as Record<string, unknown>;
  return JUDGMENT_QUESTIONS.map(
    ([mark, id]) => `| ${mark} | ${titleOf(id)} | ${labelOf(id, raw[id] ?? "undecided")} |`,
  ).join("\n");
}

function undecidedItems(judgment: Judgment): string {
  const lines = JUDGMENT_QUESTIONS.filter(([, id]) => judgment.undecided.includes(id)).map(
    ([mark, id]) => `- ${mark}：${titleOf(id)}（\`${id}\`）`,
  );
  return lines.length > 0 ? lines.join("\n") : "なし";
}

const FEATURE_UNDECIDED = "未定（要件定義で決める）";

/**
 * 要件定義書の「要件定義で決める機能の項目」の表の行（#79）。認証方式・IdP・アップロードの有無・ファイルの種類の、
 * 今の回答（未定なら「未定（要件定義で決める）」）と、決めるときに従う共通仕様を並べる。
 */
function requirementsFeatureItems(answers: Answers): string {
  const raw = answers as unknown as Record<string, unknown>;
  const auth = raw["auth"] ?? "undecided";
  const upload = raw["file_upload"] ?? "undecided";
  const shown = (id: string, value: unknown): string =>
    value === "undecided" ? FEATURE_UNDECIDED : labelOf(id, value);
  const kinds = Array.isArray(raw["file_kinds"])
    ? raw["file_kinds"].map((k) => labelOf("file_kinds", k)).join("・")
    : undefined;
  const idpValue =
    typeof raw["idp"] === "string"
      ? labelOf("idp", raw["idp"])
      : auth === "oidc" || auth === "both" || auth === "undecided"
        ? FEATURE_UNDECIDED
        : "該当しない";
  const kindsValue =
    kinds ?? (upload === "yes" || upload === "undecided" ? FEATURE_UNDECIDED : "該当しない");
  return [
    `| 認証方式（なし・アプリ独自・OIDC・併用） | ${shown("auth", auth)} | C-12〜C-20（認証方式・セッション・MFA など）、F-26（ASVSのレベルの判定） |`,
    `| 外部IdP（OIDC・併用のとき） | ${idpValue} | C-12〜C-20 |`,
    `| ファイルのアップロード（使う・使わない） | ${shown("file_upload", upload)} | C-63（ファイルのアップロード） |`,
    `| 扱うファイルの種類（アップロードを使うとき） | ${kindsValue} | C-63 |`,
  ].join("\n");
}

function envRow(item: EnvItem): string {
  const name = "`" + item.name + "`";
  return `| ${name} | ${item.purpose} | ${item.development} | ${item.test} | ${item.production} |`;
}

const REFERENCE_RE = /{{([a-z][a-z0-9_]*)}}/g;

/**
 * data/template-values.yaml の値の中の {{名前}} を、ほかの値で置き換える（1段だけ。置き換えた先の中の {{名前}} は展開しない）。
 * 値を持たない名前は、そのまま残す（ひな形に差し込んだあと、値が決まっていない名前として誤りになる）。
 */
function expandReferences(values: Record<string, string>, names: string[]): void {
  const before = { ...values };
  for (const name of names) {
    const text = before[name];
    if (text === undefined) continue;
    values[name] = text.replace(REFERENCE_RE, (all, ref: string) =>
      ref !== name && before[ref] !== undefined ? before[ref] : all,
    );
  }
}

/**
 * ひな形（templates/）の {{名前}} に入れる値を決める。名前 → 値。
 * 回答の条件で決まるものは data/template-values.yaml・env-items.yaml・role-models.yaml・runtimes.yaml に置き、
 * データに書けないもの（判定・表示の名前・知見の一覧）だけを計算する。
 * 役割とモデルは、選んだAIの分だけ持つ。
 */
export function buildValues(input: BuildValuesInput): Record<string, string> {
  const { answers } = input;
  const judgment = input.judgment ?? judge(answers);
  const knowledge = input.knowledge ?? selectKnowledge(answers);
  const values: Record<string, string> = {};

  Object.assign(values, chooseValues(loadDefinitions(), answers, `data/${VALUES_FILE}`));

  values["app_name"] = answers.app_name;
  values["auth_method"] = labelOf("auth", answers.auth);
  values["database"] = labelOf("database", answers.database);
  values["asvs_level"] = asvsLevel(judgment);
  values["pentest_requirement"] = pentestRequirement(judgment);
  values["judgment_table"] = judgmentTable(answers);
  values["enabled_rules"] =
    judgment.enabledRules.length > 0 ? judgment.enabledRules.join("、") : "なし";
  values["undecided_items"] = undecidedItems(judgment);
  values["requirements_feature_items"] = requirementsFeatureItems(answers);
  values["knowledge_index"] = knowledgeIndexRows(knowledge);
  values["compatibility_date"] = compatibilityDate();
  values["postgres_image_tag"] = postgresImageTag();
  const terraform = terraformVersions();
  values["terraform_version"] = terraform.terraform;
  values["terraform_cloudflare_version"] = terraform.cloudflareProvider;
  if (input.nodeVersion !== undefined) values["node_version"] = input.nodeVersion;
  values["secrets_table"] = loadEnvItems()
    .filter((item) => whenMatches(item.when, answers))
    .map(envRow)
    .join("\n");

  expandReferences(values, Object.keys(loadDefinitions()));

  for (const [role, model] of Object.entries(rolesFor(answers.ais))) {
    if (model.claude) values[`claude_model_${role}`] = model.claude.model;
    if (model.codex) {
      values[`codex_model_${role}`] = model.codex.model;
      values[`codex_effort_${role}`] = model.codex.effort;
    }
  }
  return values;
}

/**
 * .env.example の中身。data/env-items.yaml の項目のうち、回答に合うものを、用途の説明の行と「名前=値」で並べる。
 * 値は、空か、プレースホルダ（実際の値は書かない）。
 */
export function buildEnvExample(answers: object): string {
  const lines = [
    "# 環境変数の項目の一覧（C-05）。開発は .env.development、検証は .env.test にコピーして値を入れる。",
    "# 実際の値が入ったファイルは Git に入れない。チャットにも書かない。項目の説明は docs/secrets.md にある。",
    "# 足りない項目は、npm run env:check で確かめられる。",
    "",
  ];
  for (const item of loadEnvItems().filter((i) => whenMatches(i.when, answers))) {
    lines.push(`# ${item.purpose}`, `${item.name}=${item.example}`, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
