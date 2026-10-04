import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { prerelease, satisfies, valid, validRange } from "semver";
import { parse as parseYaml } from "yaml";
import { parseWhen, whenMatches, type When } from "./conditions.js";
import { GenerateError } from "./errors.js";

export type ProfileFile = { source: string; destination: string };

/** 回答に合うときだけ出すファイル（files_when） */
export type ProfileFilesWhen = { when: When; files: ProfileFile[] };

/** 回答に合うときだけ足す wrangler.jsonc の設定（wrangler_when） */
export type ProfileWranglerWhen = { when: When; wrangler: Record<string, unknown> };

/** 回答に合うときだけ足す package.json の項目（package_json_when） */
export type ProfilePackageJsonWhen = { when: When; packageJson: Record<string, unknown> };

/** 回答に合うときだけ足すパッケージ（packages_when） */
export type PackagesWhen = { when: Record<string, string>; packages: string[] };

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
  /** 回答に合うときだけ出すファイル（書いてなければ []） */
  filesWhen: ProfileFilesWhen[];
  packageJson: Record<string, unknown>;
  /** 回答に合うときだけ足す package.json の項目（書いてなければ []） */
  packageJsonWhen: ProfilePackageJsonWhen[];
  /** wrangler.jsonc に足す設定（書いてなければ {}）。値の {{名前}} はまとめた後に差し込む */
  wrangler: Record<string, unknown>;
  /** 回答に合うときだけ足す wrangler の設定（書いてなければ []） */
  wranglerWhen: ProfileWranglerWhen[];
  /** CLI が最新の安定版を調べるパッケージ（書いてなければ []） */
  packages: string[];
  /** 回答に合うときだけ足すパッケージ（書いてなければ []） */
  packagesWhen: PackagesWhen[];
  /** devDependencies に入れるパッケージ（packages・packages_when の一部。書いてなければ []。残りは dependencies） */
  devPackages: string[];
  /** ひな形で動作を確かめた版（パッケージ名 → 版） */
  verifiedVersions: Record<string, string>;
  /** 組み合わせの条件（パッケージ名 → semver の範囲） */
  versionRanges: Record<string, string>;
  /** npm で入れない道具（バージョンの調査の対象にしない） */
  externalTools: string[];
  /** 検証済みの版のないパッケージ */
  unverified: string[];
  /** 組み合わせの条件の説明（文章） */
  compatibilityNotes: string[];
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
  "version_ranges",
  "external_tools",
  "packages_when",
  "dev_packages",
  "unverified",
  "requires",
  "includes",
  "skill_name",
  "files",
  "files_when",
  "package_json",
  "package_json_when",
  "wrangler",
  "wrangler_when",
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

function stringRecord(
  data: Record<string, unknown>,
  field: string,
  where: string,
  shape: string,
): Record<string, string> {
  const value = data[field];
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    throw new GenerateError(`${where}：項目 ${field} は「${shape}」の形で書いてください`);
  }
  const out: Record<string, string> = {};
  for (const [name, v] of Object.entries(value)) {
    if (typeof v !== "string" || v === "") {
      throw new GenerateError(
        `${where}：${field} の ${name} は、空でない文字列で書いてください（${JSON.stringify(v)}）`,
      );
    }
    out[name] = v;
  }
  return out;
}

function packagesWhenField(data: Record<string, unknown>, where: string): PackagesWhen[] {
  const value = data["packages_when"];
  if (value === undefined) return [];
  const shape =
    "packages_when は「- when: {質問の id: 回答}、packages: [名前]」の並びで書いてください";
  if (!Array.isArray(value)) throw new GenerateError(`${where}：${shape}`);
  return value.map((item, index): PackagesWhen => {
    const at = `${where}：packages_when の ${index + 1} 番目`;
    if (!isPlainObject(item)) throw new GenerateError(`${at}が連想配列ではありません。${shape}`);
    const when = stringRecord(item, "when", at, "質問の id: 回答");
    if (!isPlainObject(item["when"]) || Object.keys(when).length === 0) {
      throw new GenerateError(`${at}：項目 when は、質問の id と回答を1つ以上書いてください`);
    }
    if (!Array.isArray(item["packages"]) || !item["packages"].every((v) => typeof v === "string")) {
      throw new GenerateError(`${at}：項目 packages は文字列の一覧で書いてください`);
    }
    return { when, packages: item["packages"] as string[] };
  });
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

/** 版・範囲・外部の道具・未検証の指定が、packages などと食い違っていないかを確かめる（R1・R5・R9） */
function checkVersions(p: {
  where: string;
  packages: string[];
  packagesWhen: PackagesWhen[];
  verifiedVersions: Record<string, string>;
  versionRanges: Record<string, string>;
  externalTools: string[];
  unverified: string[];
}): void {
  const known = new Set([...p.packages, ...p.packagesWhen.flatMap((w) => w.packages)]);
  for (const tool of p.externalTools) {
    if (known.has(tool)) {
      throw new GenerateError(
        `${p.where}：external_tools の ${tool} が packages（または packages_when）にも書かれています（npm で入れる道具と、入れない道具を二重に扱えません）`,
      );
    }
  }
  for (const name of p.unverified) {
    if (!known.has(name)) {
      throw new GenerateError(
        `${p.where}：unverified の ${name} が、packages にも packages_when にもありません`,
      );
    }
    if (name in p.verifiedVersions) {
      throw new GenerateError(
        `${p.where}：${name} は unverified に書かれていますが、verified_versions にも版があります（矛盾）`,
      );
    }
  }
  for (const [name, version] of Object.entries(p.verifiedVersions)) {
    if (!known.has(name)) {
      throw new GenerateError(
        `${p.where}：verified_versions の ${name} が、packages にも packages_when にもありません`,
      );
    }
    if (valid(version) === null) {
      throw new GenerateError(
        `${p.where}：verified_versions の ${name} の版 ${JSON.stringify(version)} は、semver の版として読めません`,
      );
    }
    if (prerelease(version) !== null) {
      throw new GenerateError(
        `${p.where}：verified_versions の ${name} の版 ${version} は試験版です（安定版を書いてください）`,
      );
    }
  }
  for (const [name, range] of Object.entries(p.versionRanges)) {
    if (!known.has(name)) {
      throw new GenerateError(
        `${p.where}：version_ranges の ${name} が、packages にも packages_when にもありません`,
      );
    }
    if (validRange(range) === null) {
      throw new GenerateError(
        `${p.where}：version_ranges の ${name} の範囲 ${JSON.stringify(range)} は、semver の範囲として読めません`,
      );
    }
    const verified = p.verifiedVersions[name];
    if (verified !== undefined && !satisfies(verified, range)) {
      throw new GenerateError(
        `${p.where}：${name} の検証済みの版 ${verified} が、範囲 ${range} に合いません（プロファイルの誤り）`,
      );
    }
  }
}

/** files の「元: 出力先」を読む。元のファイルの存在・パスの形・出力先の重なりを確かめる */
function readFileMap(
  raw: Record<string, unknown>,
  at: string,
  profileKey: string,
  dir: string,
): ProfileFile[] {
  const files: ProfileFile[] = [];
  const seen = new Set<string>();
  for (const [source, destination] of Object.entries(raw)) {
    if (typeof destination !== "string") {
      throw new GenerateError(`${at}：files の ${source} の出力先は文字列で書いてください`);
    }
    checkRelativePath(source, at, "files の元のファイル");
    checkRelativePath(destination, at, "files の出力先");
    if (!isFile(path.join(dir, ...source.split("/")))) {
      throw new GenerateError(
        `${at}：files の元のファイル profiles/${profileKey}/${source} がありません`,
      );
    }
    if (seen.has(destination)) {
      throw new GenerateError(`${at}：files の出力先 ${destination} が重なっています`);
    }
    seen.add(destination);
    files.push({ source, destination });
  }
  return files;
}

/** 「- when: ...」と、もう1つの項目（files・wrangler・package_json）の並びを読む共通の部分 */
function whenItems(
  data: Record<string, unknown>,
  field: string,
  inner: string,
  where: string,
): { when: When; value: unknown; at: string }[] {
  const raw = data[field];
  if (raw === undefined) return [];
  const shape = `${field} は「- when: {answer: 質問の id, equals: 回答}、${inner}: ...」の並びで書いてください`;
  if (!Array.isArray(raw)) throw new GenerateError(`${where}：${shape}`);
  return raw.map((item, index) => {
    const at = `${where}：${field} の ${index + 1} 番目`;
    if (!isPlainObject(item)) throw new GenerateError(`${at}が連想配列ではありません。${shape}`);
    for (const key of Object.keys(item)) {
      if (key !== "when" && key !== inner) {
        throw new GenerateError(`${at}：知らない項目 ${key} があります（書き間違いの可能性）`);
      }
    }
    if (item["when"] === undefined) {
      throw new GenerateError(`${at}：項目 when（${field} の条件）を書いてください`);
    }
    if (item[inner] === undefined) {
      throw new GenerateError(`${at}：項目 ${inner} を書いてください`);
    }
    return { when: parseWhen(item["when"], at), value: item[inner], at };
  });
}

function objectOf(value: unknown, at: string, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new GenerateError(`${at}：項目 ${field} は「項目: 値」の形で書いてください`);
  }
  return structuredClone(value);
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
  const packages = stringArrayField(data, "packages", where);
  const compatibilityNotes = stringArrayField(data, "compatibility_notes", where);
  const externalTools = stringArrayField(data, "external_tools", where);
  const unverified = stringArrayField(data, "unverified", where);
  const packagesWhen = packagesWhenField(data, where);
  const devPackages = stringArrayField(data, "dev_packages", where);
  const selectable = new Set([...packages, ...packagesWhen.flatMap((w) => w.packages)]);
  for (const name of devPackages) {
    if (!selectable.has(name)) {
      throw new GenerateError(
        `${where}：dev_packages の ${name} が、packages にも packages_when にもありません`,
      );
    }
  }
  const verifiedVersions = stringRecord(data, "verified_versions", where, "名前: 版");
  const versionRanges = stringRecord(data, "version_ranges", where, "名前: 範囲");
  checkVersions({
    where,
    packages,
    packagesWhen,
    verifiedVersions,
    versionRanges,
    externalTools,
    unverified,
  });

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

  let files: ProfileFile[] = [];
  const rawFiles = data["files"];
  if (rawFiles !== undefined) {
    if (!isPlainObject(rawFiles)) {
      throw new GenerateError(
        `${where}：項目 files は「元のファイル: 出力先」の形で書いてください`,
      );
    }
    files = readFileMap(rawFiles, where, key, dir);
  }
  const filesWhen: ProfileFilesWhen[] = whenItems(data, "files_when", "files", where).map(
    ({ when, value, at }) => {
      if (!isPlainObject(value)) {
        throw new GenerateError(`${at}：項目 files は「元のファイル: 出力先」の形で書いてください`);
      }
      return { when, files: readFileMap(value, at, key, dir) };
    },
  );

  let packageJson: Record<string, unknown> = {};
  if (data["package_json"] !== undefined) {
    packageJson = objectOf(data["package_json"], where, "package_json");
  }
  const packageJsonWhen: ProfilePackageJsonWhen[] = whenItems(
    data,
    "package_json_when",
    "package_json",
    where,
  ).map(({ when, value, at }) => ({ when, packageJson: objectOf(value, at, "package_json") }));

  let wrangler: Record<string, unknown> = {};
  if (data["wrangler"] !== undefined) wrangler = objectOf(data["wrangler"], where, "wrangler");
  const wranglerWhen: ProfileWranglerWhen[] = whenItems(
    data,
    "wrangler_when",
    "wrangler",
    where,
  ).map(({ when, value, at }) => ({ when, wrangler: objectOf(value, at, "wrangler") }));

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
    filesWhen,
    packageJson,
    packageJsonWhen,
    wrangler,
    wranglerWhen,
    packages,
    packagesWhen,
    devPackages,
    verifiedVersions,
    versionRanges,
    externalTools,
    unverified,
    compatibilityNotes,
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
  label: string,
): void {
  for (const [field, value] of Object.entries(source)) {
    const here = location === "" ? field : `${location}.${field}`;
    if (field === "__proto__") {
      throw new GenerateError(`${label} の ${here} は使えない名前です`);
    }
    if (!Object.hasOwn(target, field)) {
      target[field] = structuredClone(value);
      continue;
    }
    const existing = target[field];
    if (isPlainObject(existing) && isPlainObject(value)) {
      mergeInto(existing, value, here, label);
    } else if (JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new GenerateError(
        `${label} の ${here} が、プロファイル同士で食い違っています（${JSON.stringify(existing)} と ${JSON.stringify(value)}）`,
      );
    }
  }
}

/** package_json を深くまとめる。回答に合う package_json_when も足す。同じ項目に違う値があればエラー。渡した値は書き換えない。 */
export function mergePackageJson(
  profiles: Profile[],
  answers: object = {},
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const profile of profiles) {
    mergeInto(merged, profile.packageJson, "", "package_json");
    for (const entry of profile.packageJsonWhen) {
      if (whenMatches(entry.when, answers)) {
        mergeInto(merged, entry.packageJson, "", "package_json");
      }
    }
  }
  return merged;
}

/** wrangler の設定を深くまとめる。回答に合う wrangler_when も足す。同じ項目に違う値があればエラー。渡した値は書き換えない。 */
export function mergeWrangler(profiles: Profile[], answers: object): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const profile of profiles) {
    mergeInto(merged, profile.wrangler, "", "wrangler");
    for (const entry of profile.wranglerWhen) {
      if (whenMatches(entry.when, answers)) mergeInto(merged, entry.wrangler, "", "wrangler");
    }
  }
  return merged;
}

/** 無条件の files の後ろに、回答に合う files_when を書いた順に並べる */
export function selectProfileFiles(profile: Profile, answers: object): ProfileFile[] {
  return [
    ...profile.files,
    ...profile.filesWhen.filter((w) => whenMatches(w.when, answers)).flatMap((w) => w.files),
  ];
}
