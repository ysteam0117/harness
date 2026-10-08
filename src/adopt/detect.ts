// 既存のプロジェクトの技術を判定する（F-29 の手順2・「既存の技術の扱い」、Issue #18）。
// ルールは data/adopt-detection.yaml（C-38）。ディスクを読む部分（detectStack）は fs を注入し、プロファイルの判定（matchProfiles）は純粋な関数。
// 読む範囲：ルート、frontend/・backend/・apps/*・packages/*、package.json の workspaces（深さ2まで）。node_modules・.git は見ない。
// .env 等の秘密情報のファイルは開かない（.env.example だけ、キーの名前を使い、値は捨てる）。リンクはたどらない。ルートの外は読まない。
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { isPlainObject, readDataYaml } from "../generate/data.js";
import { GenerateError } from "../generate/errors.js";
import { findTemplatesDir } from "../generate/templates-dir.js";
import type { UpdateFs } from "../update/fs.js";

export type DetectClass =
  "language" | "runtime" | "backend" | "frontend" | "db" | "test" | "quality" | "ci";

/** 分類の並び（表示・記録の順） */
export const CLASS_ORDER: readonly DetectClass[] = [
  "language",
  "runtime",
  "backend",
  "frontend",
  "db",
  "test",
  "quality",
  "ci",
];

export interface DetectedItem {
  class: DetectClass;
  technology: string;
  version?: string;
  /** 根拠のファイル（ルートからの相対パス。/ 区切り） */
  evidence: string[];
}

export interface DetectedApp {
  /** ルートからの相対パス（/ 区切り）。ルートは "." */
  dir: string;
  /** このフォルダがアプリ（package.json などがある）か */
  app: boolean;
  /** package.json の依存の名前（並べ替え済み。記録しない） */
  packages: string[];
  /** ルートだけ：package.json に workspaces がある（記録しない） */
  workspaces?: boolean;
  /** ルートの workspaces の所属のフォルダ（記録しない）。ルートの依存を共通に使えるのは、所属のフォルダだけ */
  member?: boolean;
  items: DetectedItem[];
}

export interface DetectNote {
  path: string;
  reason: string;
}

export interface DetectedStack {
  apps: DetectedApp[];
  notes: DetectNote[];
}

export interface ProfileRule {
  /** "<分類>/<id>" */
  profile: string;
  class: DetectClass;
  /** 当てられなかったとき、同じ分類の技術を「プロファイルなし」として表示するか */
  primary: boolean;
  /** 手がかりがなく、ほかのプロファイルの requires から当たるもの */
  requiresOnly: boolean;
  /** すべて満たすときだけ当てる。内側は「どれか1つ」（package.json の依存の名前） */
  needs: string[][];
  /** profile.yaml の requires */
  requires: string[];
}

interface NameRule {
  class: DetectClass;
  technology: string;
}
interface LanguageRule {
  files: string[];
  language: string;
  versionPattern?: RegExp;
}

export interface DetectionRules {
  candidateDirs: string[];
  candidateParents: string[];
  nodePackages: Map<string, NameRule>;
  languages: LanguageRule[];
  presence: { paths: string[]; rule: NameRule }[];
  manifests: string[];
  ciDirectory: string;
  ciTechnology: string;
  versionFiles: { file: string; technology: string }[];
  envKeys: Map<string, NameRule>;
  profiles: ProfileRule[];
}

export interface AppliedProfile {
  profile: string;
  apps: string[];
}

export interface NoProfile {
  category: DetectClass;
  technology: string;
  apps: string[];
  partial?: string[];
}

export interface ProfileMatch {
  applied: AppliedProfile[];
  none: NoProfile[];
}

export type DetectFs = Pick<UpdateFs, "lstat" | "readFile" | "readdir" | "realpath">;

// ---- ルールの読み込み ----

const FILE = "adopt-detection.yaml";

function bad(where: string, form: string): never {
  throw new GenerateError(`data/${FILE} の ${where} が誤っています（${form}）`);
}
const str = (v: unknown, where: string): string =>
  typeof v === "string" && v !== "" ? v : bad(where, "文字列で書いてください");
const strList = (v: unknown, where: string): string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string" && x !== "")
    ? (v as string[])
    : bad(where, "文字列の一覧で書いてください");
const rec = (v: unknown, where: string): Record<string, unknown> =>
  isPlainObject(v) ? v : bad(where, "連想配列で書いてください");
const list = (v: unknown, where: string): unknown[] =>
  Array.isArray(v) ? v : bad(where, "一覧で書いてください");

function toClass(v: unknown, where: string): DetectClass {
  return (CLASS_ORDER as readonly unknown[]).includes(v)
    ? (v as DetectClass)
    : bad(where, `分類は ${CLASS_ORDER.join("・")} のどれかで書いてください`);
}
function toNameRule(v: unknown, where: string): NameRule {
  const r = rec(v, where);
  return {
    class: toClass(r["class"], `${where}.class`),
    technology: str(r["technology"], `${where}.technology`),
  };
}

let cachedRules: DetectionRules | undefined;

/** data/adopt-detection.yaml を読んで検証する。プロファイルの requires は、templates/profiles の profile.yaml から読む */
export function loadDetectionRules(): DetectionRules {
  if (cachedRules !== undefined) return cachedRules;
  const raw = rec(readDataYaml(FILE), "先頭");
  const nodePackages = new Map<string, NameRule>();
  for (const [name, v] of Object.entries(rec(raw["node_packages"], "node_packages"))) {
    nodePackages.set(name, toNameRule(v, `node_packages.${name}`));
  }
  const languages = list(raw["languages"], "languages").map((m, i): LanguageRule => {
    const where = `languages[${String(i)}]`;
    const r = rec(m, where);
    const versionPattern =
      r["version_pattern"] === undefined
        ? undefined
        : new RegExp(str(r["version_pattern"], `${where}.version_pattern`), "m");
    return {
      files: strList(r["files"], `${where}.files`),
      language: str(r["language"], `${where}.language`),
      ...(versionPattern !== undefined ? { versionPattern } : {}),
    };
  });
  const presence = list(raw["presence"], "presence").map((p, i) => {
    const where = `presence[${String(i)}]`;
    const r = rec(p, where);
    return { paths: strList(r["paths"], `${where}.paths`), rule: toNameRule(r, where) };
  });
  const ci = rec(raw["ci_workflows"], "ci_workflows");
  const versionFiles = list(raw["version_files"], "version_files").map((v, i) => {
    const where = `version_files[${String(i)}]`;
    const r = rec(v, where);
    return {
      file: str(r["file"], `${where}.file`),
      technology: str(r["technology"], `${where}.technology`),
    };
  });
  const envKeys = new Map<string, NameRule>();
  for (const [name, v] of Object.entries(rec(raw["env_keys"], "env_keys"))) {
    envKeys.set(name, toNameRule(v, `env_keys.${name}`));
  }
  const profiles = list(raw["profiles"], "profiles").map((p, i): ProfileRule => {
    const where = `profiles[${String(i)}]`;
    const r = rec(p, where);
    const profile = str(r["profile"], `${where}.profile`);
    const needs = list(r["needs"], `${where}.needs`).map((g, j) =>
      strList(g, `${where}.needs[${String(j)}]`),
    );
    const requiresOnly = r["requires_only"] === true;
    if (needs.length === 0 && !requiresOnly) {
      bad(`${where}.needs`, "手がかりがないプロファイルには requires_only: true が必要です");
    }
    return {
      profile,
      class: toClass(r["class"], `${where}.class`),
      primary: r["primary"] === true,
      requiresOnly,
      needs,
      requires: readRequires(profile),
    };
  });
  cachedRules = {
    candidateDirs: strList(raw["candidate_dirs"], "candidate_dirs"),
    candidateParents: strList(raw["candidate_parents"], "candidate_parents"),
    nodePackages,
    languages,
    presence,
    manifests: strList(raw["manifests"], "manifests"),
    ciDirectory: str(ci["directory"], "ci_workflows.directory"),
    ciTechnology: str(ci["technology"], "ci_workflows.technology"),
    versionFiles,
    envKeys,
    profiles,
  };
  return cachedRules;
}

/** templates/profiles/<分類>/<id>/profile.yaml の requires */
function readRequires(key: string): string[] {
  const [category, id] = key.split("/");
  const file = path.join(findTemplatesDir(), "profiles", category ?? "", id ?? "", "profile.yaml");
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(file, "utf8"));
  } catch (e) {
    throw new GenerateError(
      `技術プロファイル ${key} を読めません：${file}（${(e as Error).message}）`,
      { cause: e },
    );
  }
  const requires = isPlainObject(doc) ? doc["requires"] : undefined;
  if (requires === undefined) return [];
  return strList(requires, `${key} の requires`);
}

// ---- 読み取り ----

const MAX_BYTES = 1024 * 1024;
/** 先頭の BOM（U+FEFF） */
const BOM_PATTERN = new RegExp(`^${String.fromCharCode(0xfeff)}`);
const REASON_LINK = "リンクのため読まない";
const REASON_OUTSIDE = "ルートの外のため読まない";
const REASON_BIG = "大きすぎるため読まない";
const REASON_JSON = "読めませんでした（JSON として誤っています）";
const REASON_UNREADABLE = "読めませんでした";
const REASON_UNSUPPORTED = "対応していない書き方のため読まない";
const REASON_DEPTH = "深さの範囲外のため読まない";
const SKIP_NAMES = new Set(["node_modules", ".git"]);
const MAX_DEPTH = 2;

const codeOf = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null ? (e as NodeJS.ErrnoException).code : undefined;

/** 秘密情報のファイル（.env・.env.*・.dev.vars）。.env.example だけは読んでよい */
function isSecretFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === ".env.example") return false;
  return (
    lower === ".env" ||
    lower.startsWith(".env.") ||
    lower === ".dev.vars" ||
    lower.startsWith(".dev.vars.")
  );
}

/** 版として使える文字列だけ（記録・表示に出すため、形を絞る） */
function cleanVersion(value: string): string | undefined {
  const v = value.trim().replace(/^v(?=\d)/, "");
  return /^[<>=^~]*\s?\d[0-9A-Za-z.*| -]{0,39}$/.test(v) ? v : undefined;
}

/** 記録・表示に出すパスの文字列（制御文字を除き、長さを絞る） */
function shownPath(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out.slice(0, 100);
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort(compare);

type Kind = "file" | "dir" | "absent" | "skip";

/** 読み取りの道具（1回の判定の状態） */
class Reader {
  private readonly notes = new Map<string, DetectNote>();
  private rootReal = "";
  /** ルートの workspaces に書かれたフォルダ */
  readonly workspaceDirs = new Set<string>();
  private readonly root: string;
  private readonly fs: DetectFs;
  private readonly rules: DetectionRules;

  constructor(root: string, fs: DetectFs, rules: DetectionRules) {
    this.root = root;
    this.fs = fs;
    this.rules = rules;
  }

  note(p: string, reason: string): void {
    const shown = shownPath(p);
    this.notes.set(`${shown}\n${reason}`, { path: shown, reason });
  }

  sortedNotes(): DetectNote[] {
    return [...this.notes.values()].sort(
      (a, b) => compare(a.path, b.path) || compare(a.reason, b.reason),
    );
  }

  /** ルートからの相対パス（/ 区切り）が、リンクをたどらずに、ファイル／フォルダとしてあるかを確かめる */
  private async kindOf(rel: string): Promise<{ kind: Kind; size: number }> {
    const parts = rel === "." ? [] : rel.split("/");
    let current = this.root;
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      let stat;
      try {
        stat = await this.fs.lstat(current);
      } catch (e) {
        const code = codeOf(e);
        if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent", size: 0 };
        this.note(parts.slice(0, index + 1).join("/"), REASON_UNREADABLE);
        return { kind: "skip", size: 0 };
      }
      if (stat.isSymbolicLink()) {
        this.note(parts.slice(0, index + 1).join("/"), REASON_LINK);
        return { kind: "skip", size: 0 };
      }
      const last = index === parts.length - 1;
      if (!last && !stat.isDirectory()) return { kind: "absent", size: 0 };
      if (last) {
        if (stat.isDirectory()) return { kind: "dir", size: 0 };
        if (stat.isFile()) return { kind: "file", size: stat.size };
        return { kind: "absent", size: 0 };
      }
    }
    return { kind: "dir", size: 0 };
  }

  /** フォルダとして調べてよいか（リンクでなく、実体がルートの中にある） */
  async dirOk(rel: string): Promise<boolean> {
    const { kind } = await this.kindOf(rel);
    if (kind !== "dir") return false;
    try {
      if (this.rootReal === "") this.rootReal = await this.fs.realpath(this.root);
      const real = await this.fs.realpath(path.join(this.root, ...rel.split("/")));
      const relative = path.relative(this.rootReal, real);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        this.note(rel, REASON_OUTSIDE);
        return false;
      }
    } catch {
      this.note(rel, REASON_UNREADABLE);
      return false;
    }
    return true;
  }

  /** フォルダの中の名前の一覧（並べ替え済み。隠しフォルダ・node_modules を除く）。調べてよいフォルダだけ */
  async children(rel: string): Promise<string[]> {
    if (!(await this.dirOk(rel))) return [];
    try {
      const names = await this.fs.readdir(path.join(this.root, ...rel.split("/")));
      return names.filter((n) => !SKIP_NAMES.has(n) && !n.startsWith(".")).sort(compare);
    } catch {
      this.note(rel, REASON_UNREADABLE);
      return [];
    }
  }

  /** CI のワークフローのファイル（.yml・.yaml。リンクでないファイルだけ） */
  async workflowFiles(rel: string): Promise<string[]> {
    if (!(await this.dirOk(rel))) return [];
    let names: string[];
    try {
      names = await this.fs.readdir(path.join(this.root, ...rel.split("/")));
    } catch {
      this.note(rel, REASON_UNREADABLE);
      return [];
    }
    const out: string[] = [];
    for (const name of names.sort(compare)) {
      if (!/\.ya?ml$/i.test(name)) continue;
      if ((await this.kindOf(`${rel}/${name}`)).kind === "file") out.push(`${rel}/${name}`);
    }
    return out;
  }

  /** ファイルの有無（中身は読まない） */
  async exists(rel: string): Promise<boolean> {
    return (await this.kindOf(rel)).kind === "file";
  }

  /** テキストを読む。無い・読めない・リンク・大きい・秘密情報のファイルなら undefined */
  async readText(rel: string): Promise<string | undefined> {
    if (isSecretFileName(path.posix.basename(rel))) return undefined;
    const { kind, size } = await this.kindOf(rel);
    if (kind !== "file") return undefined;
    if (size > MAX_BYTES) {
      this.note(rel, REASON_BIG);
      return undefined;
    }
    try {
      const buf = await this.fs.readFile(path.join(this.root, ...rel.split("/")));
      if (buf.length > MAX_BYTES) {
        this.note(rel, REASON_BIG);
        return undefined;
      }
      return buf.toString("utf8").replace(BOM_PATTERN, "");
    } catch {
      this.note(rel, REASON_UNREADABLE);
      return undefined;
    }
  }

  /** package.json を JSON として読む。誤っていれば、読めなかったと記録して undefined（エラーの文は残さない） */
  async readJson(rel: string): Promise<Record<string, unknown> | undefined> {
    const text = await this.readText(rel);
    if (text === undefined) return undefined;
    try {
      const value: unknown = JSON.parse(text);
      if (isPlainObject(value)) return value;
    } catch {
      // 下で記録する（エラーの文には、中身の一部が入ることがある）
    }
    this.note(rel, REASON_JSON);
    return undefined;
  }

  /** 調べるフォルダの一覧（ルートが先、あとは並べ替え済み） */
  async candidates(): Promise<string[]> {
    const found = new Set<string>(this.rules.candidateDirs);
    for (const parent of this.rules.candidateParents) {
      for (const name of await this.children(parent)) found.add(`${parent}/${name}`);
    }
    for (const pattern of workspacesOf(await this.readJson("package.json"))) {
      for (const dir of await this.expandWorkspace(pattern)) {
        found.add(dir);
        this.workspaceDirs.add(dir);
      }
    }
    return [".", ...[...found].filter((d) => d !== ".").sort(compare)];
  }

  /** workspaces の1つの書き方を、フォルダの一覧にする。ルートの外・深すぎる・対応していない書き方は読まない */
  private async expandWorkspace(raw: string): Promise<string[]> {
    const slashed = raw.trim().replace(/\\/g, "/");
    if (slashed === "") return [];
    if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) {
      this.note(raw, REASON_OUTSIDE);
      return [];
    }
    const normalized = path.posix.normalize(slashed);
    if (normalized.split("/").includes("..")) {
      this.note(raw, REASON_OUTSIDE);
      return [];
    }
    let base = normalized;
    let wildcard = false;
    if (/\/\*{1,2}$/.test(base)) {
      base = base.replace(/\/\*{1,2}$/, "");
      wildcard = true;
    }
    if (base.includes("*") || base.startsWith("!")) {
      this.note(raw, REASON_UNSUPPORTED);
      return [];
    }
    const segments = base.split("/").filter((s) => s !== "" && s !== ".");
    if (segments.length === 0 || segments.some((s) => SKIP_NAMES.has(s))) return [];
    if (segments.length + (wildcard ? 1 : 0) > MAX_DEPTH) {
      this.note(raw, REASON_DEPTH);
      return [];
    }
    const rel = segments.join("/");
    if (!wildcard) return [rel];
    return (await this.children(rel)).map((n) => `${rel}/${n}`);
  }
}

function workspacesOf(pkg: Record<string, unknown> | undefined): string[] {
  const w = pkg?.["workspaces"];
  const items = Array.isArray(w)
    ? w
    : isPlainObject(w) && Array.isArray(w["packages"])
      ? w["packages"]
      : [];
  return items.filter((x): x is string => typeof x === "string");
}

const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** 項目をためる（分類＋技術で1つにまとめる） */
class ItemBag {
  private readonly map = new Map<string, DetectedItem>();
  private readonly evidence = new Map<string, Set<string>>();

  add(cls: DetectClass, technology: string, evidence: string, version?: string): void {
    const key = `${cls}\n${technology}`;
    let item = this.map.get(key);
    if (item === undefined) {
      item = { class: cls, technology, evidence: [] };
      this.map.set(key, item);
      this.evidence.set(key, new Set());
    }
    this.evidence.get(key)?.add(evidence);
    if (version !== undefined && item.version === undefined) item.version = version;
  }

  items(): DetectedItem[] {
    return [...this.map.entries()]
      .map(([key, item]) => ({ ...item, evidence: sortedUnique(this.evidence.get(key) ?? []) }))
      .sort(
        (a, b) =>
          CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class) ||
          compare(a.technology, b.technology),
      );
  }
}

/** 既存のプロジェクトの技術を調べる。読むのは、決まったファイルだけ（.env 等の秘密情報のファイルは開かない） */
export async function detectStack(
  root: string,
  fs: DetectFs,
  rules: DetectionRules = loadDetectionRules(),
): Promise<DetectedStack> {
  const reader = new Reader(root, fs, rules);
  const apps: DetectedApp[] = [];
  for (const dir of await reader.candidates()) {
    if (dir !== "." && !(await reader.dirOk(dir))) continue;
    const app = await scanDir(reader, rules, dir);
    if (app.app || app.items.length > 0) apps.push(app);
  }
  shareRootTypeScript(apps);
  return { apps, notes: reader.sortedNotes() };
}

/** ルートの typescript は、workspaces の所属の子にも効く。子が JavaScript と判定されていたら、TypeScript に直す */
function shareRootTypeScript(apps: DetectedApp[]): void {
  const root = apps.find((a) => a.dir === ".");
  if (root?.workspaces !== true || !root.packages.includes("typescript")) return;
  for (const app of apps) {
    if (app.member !== true) continue;
    const js = app.items.findIndex((i) => i.class === "language" && i.technology === "JavaScript");
    if (js < 0) continue;
    app.items.splice(js, 1);
    if (!app.items.some((i) => i.class === "language" && i.technology === "TypeScript")) {
      app.items.unshift({
        class: "language",
        technology: "TypeScript",
        evidence: ["package.json"],
      });
    }
  }
}

async function scanDir(r: Reader, rules: DetectionRules, dir: string): Promise<DetectedApp> {
  const at = (name: string): string => (dir === "." ? name : `${dir}/${name}`);
  const bag = new ItemBag();
  const packages = new Set<string>();
  let isApp = false;

  for (const name of rules.manifests) {
    if (await r.exists(at(name))) isApp = true;
  }

  // package.json
  const pkgPath = at("package.json");
  const pkg = await r.readJson(pkgPath);
  if (pkg !== undefined) {
    for (const section of DEP_SECTIONS) {
      const deps = pkg[section];
      if (!isPlainObject(deps)) continue;
      for (const name of Object.keys(deps)) packages.add(name);
    }
    for (const name of packages) {
      const rule = rules.nodePackages.get(name);
      if (rule !== undefined) bag.add(rule.class, rule.technology, pkgPath);
    }
    if (packages.has("typescript")) bag.add("language", "TypeScript", pkgPath);
    else if (await r.exists(at("tsconfig.json")))
      bag.add("language", "TypeScript", at("tsconfig.json"));
    else bag.add("language", "JavaScript", pkgPath);
    const engines = pkg["engines"];
    const node = isPlainObject(engines) ? engines["node"] : undefined;
    const nodeVersion = typeof node === "string" ? cleanVersion(node) : undefined;
    if (nodeVersion !== undefined) bag.add("runtime", "Node.js", pkgPath, nodeVersion);
  }

  // Node.js 以外：ファイルの有無で言語だけを判定する（依存の名前は見ない）。版のパターンがあるファイルだけ読む
  for (const rule of rules.languages) {
    for (const file of rule.files) {
      let version: string | undefined;
      if (rule.versionPattern !== undefined) {
        const text = await r.readText(at(file));
        if (text === undefined) continue;
        const m = rule.versionPattern.exec(text.replace(/\r\n/g, "\n"));
        version = m?.[1] === undefined ? undefined : cleanVersion(m[1]);
      } else if (!(await r.exists(at(file)))) {
        continue;
      }
      bag.add("language", rule.language, at(file), version);
    }
  }

  // ファイルがあるだけで分かるもの
  for (const p of rules.presence) {
    for (const name of p.paths) {
      if (await r.exists(at(name))) bag.add(p.rule.class, p.rule.technology, at(name));
    }
  }

  // 実行環境の版のファイル
  for (const v of rules.versionFiles) {
    const text = await r.readText(at(v.file));
    const first = text?.split(/\r?\n/).find((l) => l.trim() !== "");
    const version = first === undefined ? undefined : cleanVersion(first);
    if (version !== undefined) bag.add("runtime", v.technology, at(v.file), version);
  }

  // .env.example：キーの名前だけ使い、値は捨てる
  const envText = await r.readText(at(".env.example"));
  if (envText !== undefined) {
    for (const line of envText.split(/\r?\n/)) {
      const key = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
      const rule = key === undefined ? undefined : rules.envKeys.get(key);
      if (rule !== undefined) bag.add(rule.class, rule.technology, at(".env.example"));
    }
  }

  // CI（ルートだけ）
  if (dir === ".") {
    for (const file of await r.workflowFiles(rules.ciDirectory)) {
      bag.add("ci", rules.ciTechnology, file);
    }
  }

  return {
    dir,
    app: isApp,
    packages: [...packages].sort(compare),
    ...(dir === "." && workspacesOf(pkg).length > 0 ? { workspaces: true } : {}),
    ...(dir !== "." && r.workspaceDirs.has(dir) ? { member: true } : {}),
    items: bag.items(),
  };
}

// ---- プロファイルの判定 ----

/** 「プロファイルなし」を出す分類（プロファイルを当てる対象の分類） */
const NONE_CLASSES: readonly DetectClass[] = ["backend", "frontend", "db", "test", "quality"];

/** ルートの項目のうち、各アプリに共通で効くもの（言語・テスト・品質チェックの道具）。バックエンド・フロント・DB は、そのアプリのものだけを見る */
/** アプリ本体の手がかりになる分類 */
const APP_CLASSES: readonly DetectClass[] = ["backend", "frontend", "db"];

/** アプリ本体の手がかり：バックエンド・フロント・DB、または package.json 以外の言語のファイル（go.mod・pyproject.toml 等） */
const hasAppClue = (items: DetectedItem[]): boolean =>
  items.some(
    (i) =>
      isStrong(i) &&
      (APP_CLASSES.includes(i.class) ||
        (i.class === "language" &&
          i.evidence.some(
            (e) =>
              e !== "package.json" && !e.endsWith("/package.json") && !e.endsWith("tsconfig.json"),
          ))),
  );

const SHARED_CLASSES: readonly DetectClass[] = ["language", "test", "quality"];

/** 「プロファイルなし」に数える項目。.env.example のキーの名前だけが根拠のものは、手がかりが弱いので数えない */
const isStrong = (item: DetectedItem): boolean =>
  item.evidence.some((e) => !e.endsWith(".env.example"));

function mergeItems(shared: DetectedItem[], own: DetectedItem[]): DetectedItem[] {
  const map = new Map<string, DetectedItem>();
  const all = [...shared.filter((i) => SHARED_CLASSES.includes(i.class)), ...own];
  for (const item of all.filter(isStrong)) map.set(`${item.class}\n${item.technology}`, item);
  return [...map.values()];
}

/**
 * アプリ（package.json などのあるフォルダ）単位で、必須の手がかりがすべて合うプロファイルを当てる。
 * 手がかりは、そのアプリの依存と、ルートの依存（workspaces で共通に入れたもの）だけを合わせて見る。別のアプリの手がかりは合算しない。
 * ルート以外にアプリがあるとき、ルートはアプリとして数えない（ルートの手がかりは、各アプリに共通で効く）。
 */
export function matchProfiles(stack: DetectedStack, rules: DetectionRules): ProfileMatch {
  const root = stack.apps.find((a) => a.dir === ".");
  const children = stack.apps.filter((a) => a.app && a.dir !== ".");
  // ルートが実アプリか：子がなければ、アプリの手がかりがあればルートが対象。子があるときは、バックエンド・フロント・DB の手がかりが
  // あるときだけ実アプリ（workspaces の管理用のルートは、開発の道具の手がかりだけなので、対象にしない）
  const rootIsApp =
    root?.app === true &&
    (children.length === 0 || root.workspaces !== true || hasAppClue(root.items));
  const targets = [...(rootIsApp && root !== undefined ? [root] : []), ...children].sort((a, b) =>
    compare(a.dir, b.dir),
  );

  const applied = new Map<string, Set<string>>();
  const none = new Map<string, NoProfile>();

  for (const target of targets) {
    // ルートの依存を共通に使えるのは、ルートに workspaces があり、その所属の子だけ
    const shared =
      target.dir !== "." && root?.workspaces === true && target.member === true ? root : undefined;
    const packages = new Set([...target.packages, ...(shared?.packages ?? [])]);
    const items = mergeItems(shared?.items ?? [], target.items);

    // 必須の手がかりがすべて合うもの。一部だけ合うものは、分類ごとに覚える
    const matched = new Set<string>();
    const partials = new Map<DetectClass, Set<string>>();
    for (const rule of rules.profiles) {
      if (rule.requiresOnly) continue;
      const hits = rule.needs.map((group) => group.find((name) => packages.has(name)));
      if (hits.every((h) => h !== undefined)) {
        matched.add(rule.profile);
      } else if (rule.primary) {
        const found = hits.filter((h): h is string => h !== undefined);
        if (found.length > 0) {
          const set = partials.get(rule.class) ?? new Set<string>();
          for (const f of found) set.add(f);
          partials.set(rule.class, set);
        }
      }
    }
    // requires を解決する（例：hono → 共通ロガー）
    const queue = [...matched];
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      for (const required of rules.profiles.find((r) => r.profile === key)?.requires ?? []) {
        if (!matched.has(required)) {
          matched.add(required);
          queue.push(required);
        }
      }
    }
    for (const key of matched) {
      const apps = applied.get(key) ?? new Set<string>();
      apps.add(target.dir);
      applied.set(key, apps);
    }

    // 当たらなかった分類の技術は「プロファイルなし」
    const covered = new Set(
      rules.profiles.filter((r) => r.primary && matched.has(r.profile)).map((r) => r.class),
    );
    let produced = false;
    for (const cls of NONE_CLASSES) {
      if (covered.has(cls)) continue;
      const technologies = sortedUnique(
        items.filter((i) => i.class === cls).map((i) => i.technology),
      );
      if (technologies.length === 0) continue;
      addNone(
        none,
        cls,
        technologies.join("・"),
        target.dir,
        sortedUnique(partials.get(cls) ?? []),
      );
      produced = true;
    }
    // 言語だけが分かるアプリ（例：Go）は、言語を「プロファイルなし」にする
    if (!produced && matched.size === 0) {
      const technologies = sortedUnique(
        items.filter((i) => i.class === "language").map((i) => i.technology),
      );
      if (technologies.length > 0) {
        addNone(none, "language", technologies.join("・"), target.dir, []);
      }
    }
  }

  return {
    applied: [...applied.entries()]
      .sort(([a], [b]) => compare(a, b))
      .map(([profile, apps]) => ({ profile, apps: sortedUnique(apps) })),
    none: [...none.values()]
      .map((n) => ({ ...n, apps: sortedUnique(n.apps) }))
      .sort(
        (a, b) =>
          CLASS_ORDER.indexOf(a.category) - CLASS_ORDER.indexOf(b.category) ||
          compare(a.technology, b.technology) ||
          compare((a.partial ?? []).join(","), (b.partial ?? []).join(",")),
      ),
  };
}

function addNone(
  none: Map<string, NoProfile>,
  category: DetectClass,
  technology: string,
  dir: string,
  partial: string[],
): void {
  const key = `${category}\n${technology}\n${partial.join(",")}`;
  const existing = none.get(key);
  if (existing !== undefined) {
    existing.apps.push(dir);
    return;
  }
  none.set(key, { category, technology, apps: [dir], ...(partial.length > 0 ? { partial } : {}) });
}
