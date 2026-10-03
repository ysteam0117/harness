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
}

type Choice = { when?: When; value: string };
type Definition = string | Choice[];

const VALUES_FILE = "template-values.yaml";
const ENV_FILE = "env-items.yaml";
const NAME_RE = /^[a-z][a-z0-9_]*$/;

let cachedDefinitions: Record<string, Definition> | undefined;

function loadDefinitions(): Record<string, Definition> {
  if (cachedDefinitions) return cachedDefinitions;
  const doc = readDataYaml(VALUES_FILE);
  if (!isPlainObject(doc)) {
    throw new GenerateError(`data/${VALUES_FILE}：「名前: 値」の形で書いてください`);
  }
  const out: Record<string, Definition> = {};
  for (const [name, raw] of Object.entries(doc)) {
    const at = `data/${VALUES_FILE} の ${name}`;
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
  cachedDefinitions = out;
  return out;
}

interface EnvItem {
  name: string;
  purpose: string;
  development: string;
  test: string;
  production: string;
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
    const known = ["name", "purpose", "development", "test", "production", "when"];
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
    const base = {
      name: text("name"),
      purpose: text("purpose"),
      development: text("development"),
      test: text("test"),
      production: text("production"),
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

function pentestRequirement(judgment: Judgment): string {
  return judgment.pentestRequired
    ? `初回のリリースの前に必須（${judgment.pentestReasons.join("、")}）`
    : "任意（推奨）";
}

function asvsLevel(judgment: Judgment): string {
  return judgment.asvsLevel === 3 ? "3を検討（結果をADRに記録する）" : String(judgment.asvsLevel);
}

function envRow(item: EnvItem): string {
  const name = "`" + item.name + "`";
  return `| ${name} | ${item.purpose} | ${item.development} | ${item.test} | ${item.production} |`;
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

  for (const [name, def] of Object.entries(loadDefinitions())) {
    if (typeof def === "string") {
      values[name] = def;
      continue;
    }
    const chosen = def.find((c) => whenMatches(c.when, answers));
    if (!chosen) {
      throw new GenerateError(
        `data/${VALUES_FILE} の ${name}：この回答に合う値がありません（最後に、when のない行を書いてください）`,
      );
    }
    values[name] = chosen.value;
  }

  values["app_name"] = answers.app_name;
  values["auth_method"] = labelOf("auth", answers.auth);
  values["database"] = labelOf("database", answers.database);
  values["asvs_level"] = asvsLevel(judgment);
  values["pentest_requirement"] = pentestRequirement(judgment);
  values["knowledge_index"] = knowledgeIndexRows(knowledge);
  values["compatibility_date"] = compatibilityDate();
  values["secrets_table"] = loadEnvItems()
    .filter((item) => whenMatches(item.when, answers))
    .map(envRow)
    .join("\n");

  for (const [role, model] of Object.entries(rolesFor(answers.ais))) {
    if (model.claude) values[`claude_model_${role}`] = model.claude.model;
    if (model.codex) {
      values[`codex_model_${role}`] = model.codex.model;
      values[`codex_effort_${role}`] = model.codex.effort;
    }
  }
  return values;
}
