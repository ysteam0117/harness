// 設定は .env.<環境> だけから読む。値を診断に出さない（C-40）。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import ts from "typescript";

export type LocalEnvironment = "development" | "test";
const HYPERDRIVE = "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE";

export class LocalEnvironmentError extends Error {}

function problem(name: string, reason: string): never {
  throw new LocalEnvironmentError(`${name}：${reason}（値は表示しません）。`);
}

export function databaseUrl(
  value: string,
  name: string,
  environment: LocalEnvironment,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return problem(name, "接続先の形式が不正です");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash
  ) {
    problem(name, "手元の PostgreSQL だけを指定してください");
  }
  const db = url.pathname.slice(1);
  const testDb = /^[a-zA-Z0-9_]+_test$/.test(db);
  if (!db || (environment === "test" ? !testDb : testDb)) {
    problem(
      name,
      environment === "test"
        ? "検証専用のDB名（末尾 _test）が必要です"
        : "検証専用のDBは開発に使えません",
    );
  }
  return url;
}

export function loadLocalEnvironment(
  environment: LocalEnvironment,
  root = process.cwd(),
): Record<string, string> {
  if (environment !== "development" && environment !== "test")
    problem("環境", "development・test だけを選べます");
  assertNoDevVars(root);
  let values: Record<string, string>;
  try {
    values = parseEnv(
      readFileSync(path.join(root, `.env.${environment}`), "utf8"),
    ) as Record<string, string>;
  } catch {
    return problem(`.env.${environment}`, "ファイルを用意してください");
  }
  if (values.APP_ENV !== environment)
    problem("APP_ENV", `環境 ${environment} と一致させてください`);
  for (const key of [
    "NODE_OPTIONS",
    "CLOUDFLARE_ENV",
    "CLOUDFLARE_INCLUDE_PROCESS_ENV",
    "HARNESS_APP_ENV",
    "HARNESS_DOCKER",
  ]) {
    if (key in values) problem(key, "環境ファイルで指定できない項目です");
  }
  const urls = ["DATABASE_URL", HYPERDRIVE].filter((key) => key in values);
  for (const key of urls) databaseUrl(values[key], key, environment);
  validatePostgresValues(values, urls);
  validateWorkerConfig(root, urls.length);
  return values;
}

function validatePostgresValues(
  values: Record<string, string>,
  urls: string[],
): void {
  if (
    values.POSTGRES_DB &&
    urls.some(
      (key) => new URL(values[key]).pathname.slice(1) !== values.POSTGRES_DB,
    )
  ) {
    problem("POSTGRES_DB", "接続先のDB名と一致させてください");
  }
  if (
    urls.length === 2 &&
    new URL(values.DATABASE_URL).href !== new URL(values[HYPERDRIVE]).href
  ) {
    problem("CLOUDFLARE_HYPERDRIVE", "DATABASE_URL と同じ接続先にしてください");
  }
  const port = values.POSTGRES_PORT ?? "5432";
  if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) {
    problem("POSTGRES_PORT", "1～65535 のポート番号を指定してください");
  }
  for (const key of urls) {
    const url = new URL(values[key]);
    if ((url.port || "5432") !== port)
      problem("POSTGRES_PORT", `${key} のポートと一致させてください`);
    validateUrlCredentials(url, key, values);
  }
}

function validateUrlCredentials(
  url: URL,
  key: string,
  values: Record<string, string>,
): void {
  let user: string;
  let password: string;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    problem(key, "認証情報の形式が不正です");
  }
  if (values.POSTGRES_USER && user !== values.POSTGRES_USER)
    problem("POSTGRES_USER", `${key} のユーザー名と一致させてください`);
  if (values.POSTGRES_PASSWORD && password !== values.POSTGRES_PASSWORD)
    problem("POSTGRES_PASSWORD", `${key} のパスワードと一致させてください`);
}

function validateWorkerConfig(root: string, urlCount: number): void {
  if (!existsSync(path.join(root, "wrangler.jsonc"))) return;
  const config = readWorkerConfig(root);
  if (Array.isArray(config.hyperdrive) && urlCount !== 2)
    problem("DATABASE_URL・CLOUDFLARE_HYPERDRIVE", "両方の接続先が必要です");
}

export function assertNoDevVars(root = process.cwd()): void {
  // Wrangler は .dev.vars を .env より優先するため、混在を拒否する。
  if (
    readdirSync(root).some(
      (name) => name === ".dev.vars" || name.startsWith(".dev.vars."),
    )
  ) {
    problem(".dev.vars", ".env.development・.env.test に設定を移してください");
  }
  if (existsSync(path.join(root, "node_modules", ".harness-env-disabled"))) {
    problem("Vite envDir", "自動読込を止めるためのパスを空けてください");
  }
}

export function readWorkerConfig(
  root = process.cwd(),
): Record<string, unknown> {
  let config: Record<string, unknown>;
  try {
    const text = readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
    const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", text);
    if (
      parsed.error ||
      !parsed.config ||
      typeof parsed.config !== "object" ||
      Array.isArray(parsed.config)
    ) {
      problem("wrangler.jsonc", "設定を読み取れません");
    }
    config = parsed.config as Record<string, unknown>;
  } catch {
    return problem("wrangler.jsonc", "設定を読み取れません");
  }
  function check(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if ("remote" in value && value.remote === true)
      problem("wrangler.jsonc", "手元で remote なバインディングは使えません");
    for (const child of Object.values(value)) check(child);
  }
  check(config);
  return config;
}

export function applyLocalEnvironment(values: Record<string, string>): void {
  clearInheritedEnvironment();
  Object.assign(process.env, values);
  process.env.HARNESS_APP_ENV = values.APP_ENV;
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
  process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = "false";
  // Docker 内だけ、検証済みの localhost を専用サービス名に置き換える。
  if (existsSync("/.dockerenv")) {
    for (const key of ["DATABASE_URL", HYPERDRIVE]) {
      if (!values[key]) continue;
      const url = new URL(values[key]);
      url.hostname = "db";
      url.port = "5432";
      process.env[key] = url.href;
    }
  }
}

export function clearInheritedEnvironment(): void {
  const keep =
    /^(PATH|Path|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|PROGRAMDATA|HOMEDRIVE|HOMEPATH|LANG|LC_ALL|TZ|CI|TERM|FORCE_COLOR)$/i;
  for (const key of Object.keys(process.env))
    if (!keep.test(key)) delete process.env[key];
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
  process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = "false";
}

export function localStatePath(environment: LocalEnvironment): string {
  return `.wrangler/state/${environment}`;
}
