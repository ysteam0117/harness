import { existsSync } from "node:fs";
import path from "node:path";
import { isPlainObject, readDataYaml } from "../generate/data.js";
import { GenerateError } from "../generate/errors.js";
import { isProfileKey, loadProfile, type Profile } from "../generate/profile.js";
import { findTemplatesDir } from "../generate/templates-dir.js";
import type { AppliedProfile } from "./detect.js";

// 当てたプロファイルの Skill を導入するための道具（Issue #18）。
// ・今のハーネスに無いプロファイルを、報告して飛ばす（連鎖して、それを requires しているものも除く）
// ・Skill を AGENTS.md の「コードを書く前に、ルールを読んで従う」の表に書くための値を作る（data/adopt-profile-skills.yaml）

export interface MissingProfile {
  profile: string;
  /** not-found：今のハーネスにない。requires：requires しているプロファイルが使えない */
  reason: "not-found" | "requires";
  /** reason が requires のとき、使えない requires */
  requires?: string[];
}

export interface UsableProfiles {
  /** 使えるプロファイル（記録の順。同じ名前は apps をまとめる） */
  usable: AppliedProfile[];
  missing: MissingProfile[];
}

/**
 * 記録した applied のうち、今のハーネスで使えるものを選ぶ。
 * 今のハーネスに無いものを除き、除いたものを requires しているプロファイルも、連鎖して除く
 * （Skill だけを入れるので、requires の検証は「足りないものを除く」で扱う）。止めない。
 * プロファイルの定義が壊れているときは GenerateError。
 */
export function usableProfiles(
  applied: readonly AppliedProfile[],
  templatesDir: string = findTemplatesDir(),
): UsableProfiles {
  // 同じプロファイルは1つにまとめる
  const merged = new Map<string, AppliedProfile>();
  for (const a of applied) {
    const found = merged.get(a.profile);
    if (found === undefined) merged.set(a.profile, { profile: a.profile, apps: [...a.apps] });
    else for (const dir of a.apps) if (!found.apps.includes(dir)) found.apps.push(dir);
  }

  const missing: MissingProfile[] = [];
  const loaded = new Map<string, Profile>();
  for (const key of merged.keys()) {
    const exists =
      isProfileKey(key) &&
      existsSync(path.join(templatesDir, "profiles", ...key.split("/"), "profile.yaml"));
    if (exists) loaded.set(key, loadProfile(templatesDir, key));
    else missing.push({ profile: key, reason: "not-found" });
  }

  // requires が使えないものを、連鎖して除く
  for (let changed = true; changed;) {
    changed = false;
    for (const [key, profile] of loaded) {
      const lacks = profile.requires.filter((r) => !loaded.has(r));
      if (lacks.length === 0) continue;
      loaded.delete(key);
      missing.push({ profile: key, reason: "requires", requires: lacks });
      changed = true;
    }
  }

  return {
    usable: [...merged.values()].filter((a) => loaded.has(a.profile)),
    missing,
  };
}

/**
 * 技術の判定の結果（または記録）から、Node.js のアプリ（言語が JavaScript・TypeScript）のフォルダを集める（並べ替え済み）。
 * harness-check.yml の npm audit の対象。フォルダの名前は、ここでは確かめない（ci.ts が安全な名前だけを使う）
 */
export function nodeAppDirs(stack: {
  apps: readonly {
    dir: string;
    items: readonly { technology: string; class?: string; category?: string }[];
  }[];
}): string[] {
  return stack.apps
    .filter((app) =>
      app.items.some(
        (i) =>
          (i.class ?? i.category) === "language" &&
          (i.technology === "JavaScript" || i.technology === "TypeScript"),
      ),
    )
    .map((app) => app.dir)
    .sort();
}

/** 報告に使う文（見つからないプロファイル） */
export function describeMissing(m: MissingProfile): string {
  return m.reason === "not-found"
    ? `${m.profile}（今のハーネスにありません）`
    : `${m.profile}（必要な ${(m.requires ?? []).join("・")} が使えません）`;
}

interface TableRule {
  value: string;
  mode: "append" | "replace" | "row";
  template?: string;
}
interface CategoryRule {
  table: TableRule;
  examples?: string;
}

const FILE = "adopt-profile-skills.yaml";

function bad(where: string, form: string): never {
  throw new GenerateError(`data/${FILE} の ${where} が誤っています（${form}）`);
}

/** data/adopt-profile-skills.yaml を読んで検証する。キーの順が、表に書く Skill の並び */
function loadCategoryRules(): Map<string, CategoryRule> {
  const raw = readDataYaml(FILE);
  const categories = isPlainObject(raw) ? raw["categories"] : undefined;
  if (!isPlainObject(categories)) return bad("categories", "分類ごとの連想配列で書いてください");
  const rules = new Map<string, CategoryRule>();
  for (const [name, rule] of Object.entries(categories)) {
    const where = `categories.${name}`;
    if (!isPlainObject(rule) || !isPlainObject(rule["table"])) {
      return bad(`${where}.table`, "連想配列で書いてください");
    }
    const { value, mode, template } = rule["table"];
    if (typeof value !== "string" || value === "") bad(`${where}.table.value`, "値の名前");
    if (mode !== "append" && mode !== "replace" && mode !== "row") {
      return bad(`${where}.table.mode`, "append・replace・row のどれか");
    }
    if (mode === "row" && (typeof template !== "string" || !template.includes("{skills}"))) {
      return bad(`${where}.table.template`, "{skills} を含む行を書いてください");
    }
    const examples = rule["examples"];
    if (examples !== undefined && (typeof examples !== "string" || examples === "")) {
      return bad(`${where}.examples`, "値の名前");
    }
    rules.set(name, {
      table: {
        value: value as string,
        mode,
        ...(typeof template === "string" ? { template } : {}),
      },
      ...(typeof examples === "string" ? { examples } : {}),
    });
  }
  return rules;
}

/** Skill の名前（と、ルート全体ではないときの対象のフォルダ）を、表に書く形にする */
function skillText(skillName: string, apps: readonly string[]): string {
  const dirs = apps.includes(".") ? [] : apps;
  return dirs.length === 0
    ? `\`${skillName}\``
    : `\`${skillName}\`（${dirs.map((d) => `\`${d}/\``).join("・")} のみ）`;
}

/**
 * 当てたプロファイルの Skill を、AGENTS.md の表（と、良い例・悪い例の案内）に書くための値に反映する。
 * values を書き換える。当てた Skill はすべて表に書く（書けない分類は GenerateError）。
 */
export function applyProfileSkillValues(
  values: Record<string, string>,
  profiles: readonly { profile: Profile; apps: readonly string[] }[],
): void {
  if (profiles.length === 0) return;
  const rules = loadCategoryRules();
  const order = [...rules.keys()];
  const sorted = [...profiles].sort(
    (a, b) =>
      order.indexOf(a.profile.category) - order.indexOf(b.profile.category) ||
      (a.profile.key < b.profile.key ? -1 : a.profile.key > b.profile.key ? 1 : 0),
  );
  const tables = new Map<string, { rule: TableRule; texts: string[] }>();
  const examples = new Map<string, string[]>();
  for (const { profile, apps } of sorted) {
    const rule = rules.get(profile.category);
    if (rule === undefined) {
      throw new GenerateError(
        `プロファイル ${profile.key}：分類 ${profile.category} は、data/${FILE} にないため、導入できません（AGENTS.md の表に書けない Skill は入れません）`,
      );
    }
    const entry = tables.get(rule.table.value) ?? { rule: rule.table, texts: [] };
    entry.texts.push(skillText(profile.skillName, apps));
    tables.set(rule.table.value, entry);
    if (rule.examples !== undefined) {
      const names = examples.get(rule.examples) ?? [];
      names.push(`\`${profile.skillName}\``);
      examples.set(rule.examples, names);
    }
  }
  const need = (name: string): string => {
    const current = values[name];
    if (current === undefined) {
      throw new GenerateError(
        `data/${FILE}：値 ${name} がありません（data/template-values.yaml にない名前）`,
      );
    }
    return current;
  };
  for (const [name, { rule, texts }] of tables) {
    const current = need(name);
    const list = texts.join("・");
    if (rule.mode === "append") values[name] = `${current}・${list}`;
    else if (rule.mode === "replace") values[name] = list;
    else values[name] = (rule.template ?? "").replace("{skills}", list);
  }
  for (const [name, names] of examples) {
    need(name);
    values[name] = names.join("・");
  }
}
