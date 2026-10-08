// 基準線の確認（harness adopt が置く。ハーネスの更新（harness update）で置き換わる。Issue #21）。
// 導入したときの Lint・型・書式の違反の件数を .harness/baseline.json に記録し、増えたら失敗する。減ったら下げる。
// 使い方（リポジトリのルートで、各アプリの npm ci のあとに実行する）：
//   node .harness/scripts/baseline-check.mjs                    比べる（増えたら失敗）
//   node .harness/scripts/baseline-check.mjs --init             baseline.json を作る（無いときだけ）
//   node .harness/scripts/baseline-check.mjs --update           減った件数に下げる（増えた値が1つでもあれば書かない）
//   node .harness/scripts/baseline-check.mjs --update --allow-increase   上げる（ADR に記録し、承認を得てから）
// 数えるのは、各アプリの node_modules にある ESLint（error と warning）・tsc（エラー数）・Prettier（整形が要るファイル数）。
// その道具と設定が無いものは数えない（null）。ソースの中身は読まず、表示にも出さない（件数・種類・フォルダだけ）。
// シェルも npx も使わない。道具は、各アプリの node_modules のものを、この Node.js で直接動かす。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIRS = {{baseline_dirs}};
const HARNESS_VERSION = {{harness_version}};
const BASELINE_VERSION = 1;
// このスクリプト（.harness/scripts/）から見たプロジェクトの根
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const METRICS = ["eslint_error", "eslint_warning", "tsc_error", "prettier_files"];
export const METRIC_LABEL = {
  eslint_error: "ESLint のエラー",
  eslint_warning: "ESLint の警告",
  tsc_error: "tsc の型エラー",
  prettier_files: "Prettier の整形が要るファイル",
};

const UPDATE_COMMAND = "node .harness/scripts/baseline-check.mjs --update";
const INIT_COMMAND = "node .harness/scripts/baseline-check.mjs --init";

const isCount = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;

// ---- 数え方（道具の出力から件数だけを取る。純粋な関数） ----

/** ハーネス自身のファイル（アプリのフォルダの .harness/ の下）か。区切りは / と \ の両方 */
function isHarnessPath(relative) {
  const p = relative.replace(/\\/g, "/").replace(/^\.\//, "");
  return p === ".harness" || p.startsWith(".harness/");
}

/** ESLint の JSON の出力（-f json）から [error 数, warning 数]。読めないときは undefined */
export function countEslint(stdout, appDir) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!Array.isArray(data)) return undefined;
  let errors = 0;
  let warnings = 0;
  for (const r of data) {
    if (r === null || typeof r !== "object") return undefined;
    if (typeof r.filePath !== "string" || !isCount(r.errorCount) || !isCount(r.warningCount)) {
      return undefined;
    }
    if (isHarnessPath(path.relative(appDir, path.resolve(appDir, r.filePath)))) continue;
    errors += r.errorCount;
    warnings += r.warningCount;
  }
  return [errors, warnings];
}

/** tsc の出力から、型エラーの行の数（.harness/ の下のファイルの行は除く） */
export function countTsc(stdout) {
  let n = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!/error TS\d+/.test(line)) continue;
    const located = /^(.*?)\(\d+,\d+\): error TS\d+/.exec(line);
    if (located !== null && isHarnessPath(located[1] ?? "")) continue;
    n += 1;
  }
  return n;
}

/** tsc の出力の、型エラーの行の数（除外する前。終了コードとの食い違いを確かめるために使う） */
export function countTscAll(stdout) {
  return stdout.split(/\r?\n/).filter((line) => /error TS\d+/.test(line)).length;
}

/** Prettier の --list-different の出力から、整形が要るファイルの数（.harness/ の下は除く） */
export function countPrettier(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !isHarnessPath(l)).length;
}

// ---- 比べ方・下げ方（純粋な関数） ----

/**
 * 基準線と今の件数を比べる。apps は { フォルダ: { eslint_error, ... } }（null は対象外）。
 * increases：増えた（失敗）。decreases：減った。recordable：基準線が null で今は数値（--update で記録できる）。
 * problems：基準線は数値で今は測れない（失敗）。基準線にないフォルダは、missingDirs（失敗）。
 */
export function compare(baseline, current) {
  const increases = [];
  const decreases = [];
  const recordable = [];
  const problems = [];
  const missingDirs = [];
  for (const dir of Object.keys(current)) {
    const now = current[dir];
    const was = Object.hasOwn(baseline, dir) ? baseline[dir] : undefined;
    if (was === undefined) {
      missingDirs.push(dir);
      continue;
    }
    for (const metric of METRICS) {
      const from = was[metric] ?? null;
      const to = now[metric] ?? null;
      if (from === null && to === null) continue;
      if (from === null) recordable.push({ dir, metric, from, to });
      else if (to === null) problems.push({ dir, metric, from, to });
      else if (to > from) increases.push({ dir, metric, from, to });
      else if (to < from) decreases.push({ dir, metric, from, to });
    }
  }
  return {
    ok: increases.length === 0 && problems.length === 0 && missingDirs.length === 0,
    increases,
    decreases,
    recordable,
    problems,
    missingDirs,
  };
}

const describeChange = (c) =>
  `${c.dir} の ${METRIC_LABEL[c.metric] ?? c.metric}：${String(c.from)} → ${String(c.to)}`;

/** compare の結果の表示（件数・種類・フォルダだけ） */
export function formatCompare(result) {
  const lines = [];
  for (const c of result.increases) lines.push(`増えました：${describeChange(c)}`);
  for (const c of result.problems) {
    lines.push(
      `測れなくなりました：${c.dir} の ${METRIC_LABEL[c.metric] ?? c.metric}（道具か設定が無くなった可能性があります）`,
    );
  }
  for (const dir of result.missingDirs) {
    lines.push(`基準線にないフォルダです：${dir}。${UPDATE_COMMAND} で記録してください`);
  }
  for (const c of result.decreases) lines.push(`減りました：${describeChange(c)}`);
  for (const c of result.recordable) {
    lines.push(`新しく測れました：${c.dir} の ${METRIC_LABEL[c.metric] ?? c.metric}（${String(c.to)}）`);
  }
  if (result.decreases.length > 0 || result.recordable.length > 0) {
    lines.push(`${UPDATE_COMMAND} で基準線を更新してください（減らした分は、元に戻らないようにします）`);
  }
  if (result.increases.length > 0) {
    lines.push("増えた違反を直してください。基準線を上げてよいのは、ADR に記録し、承認を得たときだけです（C-80）");
  }
  return lines;
}

/**
 * --update で書く内容を決める。増えた値が1つでもあれば（allowIncrease でない限り）書かない。
 * 基準線は数値で今は測れない場合は、allowIncrease でも書かない。
 * 返す next は、今の件数をそのまま基準線にしたもの（ok のときだけ）。reasons は表示する文
 */
export function lower(baseline, current, opts) {
  const r = compare(baseline, current);
  const reasons = [];
  if (r.problems.length > 0) {
    for (const c of r.problems) {
      reasons.push(
        `測れなくなりました：${c.dir} の ${METRIC_LABEL[c.metric] ?? c.metric}。道具と設定を戻してください（基準線は書きません）`,
      );
    }
    return { ok: false, reasons };
  }
  if (r.increases.length > 0) {
    for (const c of r.increases) reasons.push(`増えました：${describeChange(c)}`);
    if (!opts.allowIncrease) {
      reasons.push(
        "増えた値があるため、基準線は書きません。増えた違反を直してください。上げるときは --allow-increase を付けます（ADR に記録し、承認を得てから。C-80）",
      );
      return { ok: false, reasons };
    }
    reasons.push("基準線を上げました。ADR に記録し、承認を得てください（C-80）");
  }
  // フォルダ名（__proto__ など）をキーにするため、プロトタイプのない辞書にする
  const next = Object.create(null);
  for (const dir of Object.keys(current)) next[dir] = { ...current[dir] };
  return { ok: true, next, reasons };
}

/** baseline.json の文字列を読む。壊れている・版が違うときは { ok: false, reason } */
export function parseBaseline(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "JSON として読めません" };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "形が違います" };
  }
  if (data.version !== BASELINE_VERSION) {
    return { ok: false, reason: `版（version）が ${String(BASELINE_VERSION)} ではありません` };
  }
  const apps = data.apps;
  if (apps === null || typeof apps !== "object" || Array.isArray(apps)) {
    return { ok: false, reason: "apps がありません" };
  }
  const safeApps = Object.create(null);
  for (const dir of Object.keys(apps)) {
    const entry = apps[dir];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, reason: "apps の中の形が違います" };
    }
    for (const metric of METRICS) {
      const v = entry[metric];
      if (v !== null && !isCount(v)) {
        return { ok: false, reason: "件数が、0 以上の整数でも null でもありません" };
      }
    }
    safeApps[dir] = entry;
  }
  return { ok: true, baseline: { ...data, apps: safeApps } };
}

// ---- 道具を動かして数える ----

/** node_modules/<パッケージ>/package.json の bin から、動かす JS のファイルを求める。無ければ undefined */
function resolveBin(appDir, pkg, binName) {
  try {
    const dir = path.join(appDir, "node_modules", pkg);
    const meta = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    const bin = typeof meta.bin === "string" ? meta.bin : meta.bin?.[binName];
    if (typeof bin !== "string") return undefined;
    const file = path.resolve(dir, bin);
    return existsSync(file) ? file : undefined;
  } catch {
    return undefined;
  }
}

const hasAny = (appDir, names) => names.some((n) => existsSync(path.join(appDir, n)));

/**
 * 設定ファイル（または package.json のキー）が、アプリのフォルダか、その上のフォルダ（プロジェクトの根まで）にあるか。
 * 根の共有設定を使うアプリも測るため。根より上は見ない
 */
function hasConfigUp(appDir, names, key) {
  let dir = path.resolve(appDir);
  const top = path.resolve(PROJECT_ROOT);
  for (;;) {
    if (hasAny(dir, names) || packageJsonHas(dir, key)) return true;
    const parent = path.dirname(dir);
    if (dir === top || parent === dir) return false;
    dir = parent;
  }
}

function packageJsonHas(appDir, key) {
  try {
    const meta = JSON.parse(readFileSync(path.join(appDir, "package.json"), "utf8"));
    return meta !== null && typeof meta === "object" && key in meta;
  } catch {
    return false;
  }
}

export const ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
];
export const PRETTIER_CONFIGS = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yml",
  ".prettierrc.yaml",
  ".prettierrc.json5",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  ".prettierrc.ts",
  ".prettierrc.mts",
  ".prettierrc.cts",
  ".prettierrc.toml",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  "prettier.config.ts",
  "prettier.config.mts",
  "prettier.config.cts",
];

function run(appDir, bin, args) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd: appDir,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.error !== undefined || r.status === null) return undefined;
  return { status: r.status, stdout: r.stdout ?? "" };
}

/** 1つのアプリを測る。{ metrics, failures }。測れなかった道具は failures に種類だけを書く（0 件にはしない） */
export function measureApp(appDir) {
  const metrics = { eslint_error: null, eslint_warning: null, tsc_error: null, prettier_files: null };
  const failures = [];

  const eslint = resolveBin(appDir, "eslint", "eslint");
  if (
    eslint !== undefined &&
    hasConfigUp(appDir, ESLINT_CONFIGS, "eslintConfig")
  ) {
    const r = run(appDir, eslint, [".", "-f", "json"]);
    const counted = r !== undefined && (r.status === 0 || r.status === 1) ? countEslint(r.stdout, appDir) : undefined;
    if (counted === undefined) failures.push("ESLint を実行できない、または出力を読めません");
    else [metrics.eslint_error, metrics.eslint_warning] = counted;
  }

  const tsc = resolveBin(appDir, "typescript", "tsc");
  if (tsc !== undefined && existsSync(path.join(appDir, "tsconfig.json"))) {
    const r = run(appDir, tsc, ["--noEmit", "--pretty", "false", "-p", "tsconfig.json"]);
    const n = r === undefined ? undefined : countTsc(r.stdout);
    // 終了コードとの食い違いは、除外する前の診断の数で確かめる（.harness/ の下だけの診断は、0 件として通す）
    const all = r === undefined ? undefined : countTscAll(r.stdout);
    if (r === undefined || r.status > 2 || (r.status === 0 && all !== 0) || (r.status !== 0 && all === 0)) {
      failures.push("tsc を実行できない、または出力を読めません");
    } else {
      metrics.tsc_error = n;
    }
  }

  const prettier = resolveBin(appDir, "prettier", "prettier");
  if (
    prettier !== undefined &&
    hasConfigUp(appDir, PRETTIER_CONFIGS, "prettier")
  ) {
    const r = run(appDir, prettier, ["--list-different", "."]);
    const n = r === undefined ? undefined : countPrettier(r.stdout);
    if (
      r === undefined ||
      r.status > 1 ||
      (r.status === 0 && n !== 0) ||
      (r.status === 1 && n === 0 && r.stdout.trim() === "")
    ) {
      failures.push("Prettier を実行できない、または出力を読めません");
    } else {
      metrics.prettier_files = n;
    }
  }
  return { metrics, failures };
}

// ---- 実行 ----

const root = PROJECT_ROOT;
const BASELINE_FILE = path.join(root, ".harness", "baseline.json");

function measureAll() {
  const apps = Object.create(null);
  const failures = [];
  for (const dir of APP_DIRS) {
    const { metrics, failures: f } = measureApp(path.resolve(root, dir));
    apps[dir] = metrics;
    for (const x of f) failures.push(`${dir}：${x}`);
  }
  return { apps, failures };
}

function summaryLine(dir, m) {
  const parts = METRICS.map((k) => `${METRIC_LABEL[k]} ${m[k] === null ? "対象外" : String(m[k])}`);
  return `  ${dir}：${parts.join("、")}`;
}

function writeBaseline(apps) {
  const body = {
    version: BASELINE_VERSION,
    harness_version: HARNESS_VERSION,
    measured_at: new Date().toISOString(),
    apps,
  };
  mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  writeFileSync(BASELINE_FILE, `${JSON.stringify(body, null, 2)}\n`);
}

function readBaseline() {
  if (!existsSync(BASELINE_FILE)) {
    console.error(
      `.harness/baseline.json がありません。各アプリで npm ci をしたあと、${INIT_COMMAND} で作り、コミットしてください`,
    );
    return undefined;
  }
  let text;
  try {
    text = readFileSync(BASELINE_FILE, "utf8");
  } catch {
    console.error(".harness/baseline.json を読めません");
    return undefined;
  }
  const parsed = parseBaseline(text);
  if (!parsed.ok) {
    console.error(`.harness/baseline.json が使えません：${parsed.reason}`);
    return undefined;
  }
  return parsed.baseline;
}

function main(argv) {
  const known = new Set(["--init", "--update", "--allow-increase"]);
  const flags = new Set(argv);
  if (argv.some((a) => !known.has(a)) || (flags.has("--init") && flags.has("--update"))) {
    console.error("使い方：baseline-check.mjs [--init | --update [--allow-increase]]");
    return 1;
  }
  if (flags.has("--allow-increase") && !flags.has("--update")) {
    console.error("--allow-increase は、--update と一緒にだけ使えます");
    return 1;
  }
  if (APP_DIRS.length === 0) {
    console.log("対象のアプリがありません");
    return 0;
  }

  const baseline = flags.has("--init") ? undefined : readBaseline();
  if (!flags.has("--init") && baseline === undefined) return 1;
  if (flags.has("--init") && existsSync(BASELINE_FILE)) {
    console.error(`.harness/baseline.json は既にあります。件数を変えるときは ${UPDATE_COMMAND} を使います`);
    return 1;
  }

  const { apps, failures } = measureAll();
  if (failures.length > 0) {
    console.error("件数を測れませんでした（0 件とは扱いません）：");
    for (const f of failures) console.error(`  ${f}`);
    console.error("各アプリで npm ci を実行したか、ESLint・tsc・Prettier が動くかを確かめてください");
    return 1;
  }

  if (flags.has("--init")) {
    writeBaseline(apps);
    console.log("基準線を作りました（.harness/baseline.json。コミットしてください）：");
    for (const dir of APP_DIRS) console.log(summaryLine(dir, apps[dir]));
    return 0;
  }

  if (flags.has("--update")) {
    const result = lower(baseline.apps, apps, { allowIncrease: flags.has("--allow-increase") });
    if (!result.ok) {
      for (const line of result.reasons) console.error(line);
      return 1;
    }
    writeBaseline(result.next);
    for (const line of result.reasons) console.log(line);
    console.log("基準線を更新しました：");
    for (const dir of APP_DIRS) console.log(summaryLine(dir, result.next[dir]));
    return 0;
  }

  const result = compare(baseline.apps, apps);
  const lines = formatCompare(result);
  if (!result.ok) {
    console.error("基準線を超えました：");
    for (const line of lines) console.error(`  ${line}`);
    return 1;
  }
  console.log("基準線を超えていません：");
  for (const dir of APP_DIRS) console.log(summaryLine(dir, apps[dir]));
  for (const line of lines) console.log(`  ${line}`);
  return 0;
}

function isMain() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = main(process.argv.slice(2));
