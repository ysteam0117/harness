import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { GenerateError } from "./errors.js";

export type ProfileFile = { source: string; destination: string };

export type Profile = {
  /** "<分類>/<id>"（例："backend-framework/hono"） */
  key: string;
  id: string;
  category: string;
  name: string;
  /** 出力するSkillのフォルダ名（profile.yaml の skill_name） */
  skillName: string;
  /** プロファイルのフォルダの絶対パス */
  dir: string;
  languages: string[];
  requires: string[];
  includes: string[];
  /** 読み込むだけで、依存には加えない */
  optionalPackages: string[];
  files: ProfileFile[];
  packageJson: Record<string, unknown>;
};

const SEGMENT = "[A-Za-z0-9][A-Za-z0-9_-]*";
const KEY_RE = new RegExp(`^(${SEGMENT})/(${SEGMENT})$`);
const SHARED_RE = new RegExp(`^(${SEGMENT})/_shared$`);
const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const KNOWN_FIELDS = new Set([
  "id",
  "category",
  "name",
  "languages",
  "runtimes",
  "databases",
  "packages",
  "verified_versions",
  "compatibility_notes",
  "requires",
  "includes",
  "skill_name",
  "files",
  "package_json",
  "optional_packages",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function stringField(data: Record<string, unknown>, field: string, where: string): string {
  const value = data[field];
  if (typeof value !== "string" || value === "") {
    throw new GenerateError(`${where}：項目 ${field} は、空でない文字列で必ず書いてください`);
  }
  return value;
}

function stringArrayField(data: Record<string, unknown>, field: string, where: string): string[] {
  const value = data[field];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new GenerateError(`${where}：項目 ${field} は文字列の一覧で書いてください`);
  }
  return value as string[];
}

/** 出力先・元のパスの形を確かめる（相対・"/" 区切り・空の部分や . や .. を含まない）。 */
function checkRelativePath(value: string, where: string, label: string): void {
  const bad =
    value === "" ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
  if (bad) {
    throw new GenerateError(
      `${where}：${label} ${value} が誤っています（相対パスで、"/" 区切り、空の部分・. ・.. を含めない）`,
    );
  }
}

/** profile.yaml を読んで検証する。key は "<分類>/<id>"。 */
export function loadProfile(templatesDir: string, key: string): Profile {
  const keyMatch = KEY_RE.exec(key);
  if (!keyMatch) {
    throw new GenerateError(
      `プロファイルの指定 ${JSON.stringify(key)} が誤っています。"<分類>/<id>" の形で指定してください`,
    );
  }
  const category = keyMatch[1] ?? "";
  const id = keyMatch[2] ?? "";
  const dir = path.join(templatesDir, "profiles", category, id);
  const where = `profiles/${key}/profile.yaml`;

  let text: string;
  try {
    text = readFileSync(path.join(dir, "profile.yaml"), "utf8");
  } catch (e) {
    throw new GenerateError(`${where} を読めません（プロファイル ${key} がありません）`, {
      cause: e,
    });
  }
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (e) {
    throw new GenerateError(`${where} を YAML として読めません：${(e as Error).message}`, {
      cause: e,
    });
  }
  if (!isPlainObject(data)) {
    throw new GenerateError(`${where}：「項目: 値」の形で書いてください`);
  }
  for (const field of Object.keys(data)) {
    if (!KNOWN_FIELDS.has(field)) {
      throw new GenerateError(`${where}：知らない項目 ${field} があります（書き間違いの可能性）`);
    }
  }

  const fileId = stringField(data, "id", where);
  const fileCategory = stringField(data, "category", where);
  if (fileId !== id) {
    throw new GenerateError(`${where}：id（${fileId}）がフォルダの名前（${id}）と一致しません`);
  }
  if (fileCategory !== category) {
    throw new GenerateError(
      `${where}：category（${fileCategory}）がフォルダの名前（${category}）と一致しません`,
    );
  }
  const name = stringField(data, "name", where);
  const skillName = stringField(data, "skill_name", where);
  if (!SKILL_NAME_RE.test(skillName)) {
    throw new GenerateError(
      `${where}：skill_name（${skillName}）に使えない文字が含まれています（英数字・-・_ だけ）`,
    );
  }

  const languages = stringArrayField(data, "languages", where);
  const requires = stringArrayField(data, "requires", where);
  const includes = stringArrayField(data, "includes", where);
  const optionalPackages = stringArrayField(data, "optional_packages", where);
  stringArrayField(data, "runtimes", where);
  stringArrayField(data, "databases", where);
  stringArrayField(data, "packages", where);
  stringArrayField(data, "compatibility_notes", where);
  if (data["verified_versions"] !== undefined && !isPlainObject(data["verified_versions"])) {
    throw new GenerateError(`${where}：項目 verified_versions は「名前: 版」の形で書いてください`);
  }

  for (const req of requires) {
    if (!KEY_RE.test(req)) {
      throw new GenerateError(
        `${where}：requires の ${req} が誤っています。"<分類>/<id>" の形で書いてください`,
      );
    }
  }
  for (const inc of includes) {
    const m = SHARED_RE.exec(inc);
    if (!m) {
      throw new GenerateError(
        `${where}：includes の ${inc} が誤っています。"<分類>/_shared" の形で書いてください`,
      );
    }
    if (!isFile(path.join(templatesDir, "profiles", m[1] ?? "", "_shared", "SKILL.md"))) {
      throw new GenerateError(`${where}：includes の引用先 profiles/${inc}/SKILL.md がありません`);
    }
  }
  if (!isFile(path.join(dir, "SKILL.md"))) {
    throw new GenerateError(`profiles/${key}/SKILL.md がありません`);
  }

  const files: ProfileFile[] = [];
  const rawFiles = data["files"];
  if (rawFiles !== undefined) {
    if (!isPlainObject(rawFiles)) {
      throw new GenerateError(
        `${where}：項目 files は「元のファイル: 出力先」の形で書いてください`,
      );
    }
    const seen = new Set<string>();
    for (const [source, destination] of Object.entries(rawFiles)) {
      if (typeof destination !== "string") {
        throw new GenerateError(`${where}：files の ${source} の出力先は文字列で書いてください`);
      }
      checkRelativePath(source, where, "files の元のファイル");
      checkRelativePath(destination, where, "files の出力先");
      if (!isFile(path.join(dir, ...source.split("/")))) {
        throw new GenerateError(
          `${where}：files の元のファイル profiles/${key}/${source} がありません`,
        );
      }
      if (seen.has(destination)) {
        throw new GenerateError(`${where}：files の出力先 ${destination} が重なっています`);
      }
      seen.add(destination);
      files.push({ source, destination });
    }
  }

  let packageJson: Record<string, unknown> = {};
  const rawPackageJson = data["package_json"];
  if (rawPackageJson !== undefined) {
    if (!isPlainObject(rawPackageJson)) {
      throw new GenerateError(`${where}：項目 package_json は「項目: 値」の形で書いてください`);
    }
    packageJson = structuredClone(rawPackageJson);
  }

  return {
    key,
    id,
    category,
    name,
    skillName,
    dir,
    languages,
    requires,
    includes,
    optionalPackages,
    files,
    packageJson,
  };
}

/** 選ばれたプロファイルを選んだ順に読む。requires の不足・出力先と Skill 名の重なりはエラー。自動で足さない。 */
export function resolveProfiles(templatesDir: string, selected: string[]): Profile[] {
  const selectedKeys = new Set<string>();
  for (const key of selected) {
    if (selectedKeys.has(key)) {
      throw new GenerateError(`プロファイル ${key} が2回選ばれています`);
    }
    selectedKeys.add(key);
  }
  const profiles = selected.map((key) => loadProfile(templatesDir, key));

  const missing: string[] = [];
  const details: string[] = [];
  for (const profile of profiles) {
    const lacks = profile.requires.filter((r) => !selectedKeys.has(r));
    if (lacks.length === 0) continue;
    details.push(`${profile.key} には ${lacks.join("・")}`);
    for (const r of lacks) if (!missing.includes(r)) missing.push(r);
  }
  if (missing.length > 0) {
    throw new GenerateError(
      `選んだプロファイルに足りないものがあります：${missing.join("、")}（${details.join("、")} が必要です。自動では足しません）`,
    );
  }

  const destinations = new Map<string, string>();
  const skillNames = new Map<string, string>();
  for (const profile of profiles) {
    const owner = skillNames.get(profile.skillName);
    if (owner !== undefined) {
      throw new GenerateError(
        `プロファイル ${owner} と ${profile.key} の skill_name（${profile.skillName}）が重なっています`,
      );
    }
    skillNames.set(profile.skillName, profile.key);
    for (const file of profile.files) {
      const other = destinations.get(file.destination);
      if (other !== undefined) {
        throw new GenerateError(
          `プロファイル ${other} と ${profile.key} の files の出力先 ${file.destination} が重なっています`,
        );
      }
      destinations.set(file.destination, profile.key);
    }
  }
  return profiles;
}

function mergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  location: string,
): void {
  for (const [field, value] of Object.entries(source)) {
    const here = location === "" ? field : `${location}.${field}`;
    if (field === "__proto__") {
      throw new GenerateError(`package_json の ${here} は使えない名前です`);
    }
    if (!Object.hasOwn(target, field)) {
      target[field] = structuredClone(value);
      continue;
    }
    const existing = target[field];
    if (isPlainObject(existing) && isPlainObject(value)) {
      mergeInto(existing, value, here);
    } else if (JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new GenerateError(
        `package_json の ${here} が、プロファイル同士で食い違っています（${JSON.stringify(existing)} と ${JSON.stringify(value)}）`,
      );
    }
  }
}

/** package_json を深くまとめる。同じ項目に違う値があればエラー。渡した値は書き換えない。 */
export function mergePackageJson(profiles: Profile[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const profile of profiles) mergeInto(merged, profile.packageJson, "");
  return merged;
}
