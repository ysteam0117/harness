import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { parseEnv } from "node:util";

export type EnvName = "development" | "test";
const ENVIRONMENTS: readonly EnvName[] = ["development", "test"];

/** 秘密の値を持つ項目の名前（C-05）。この項目の値は、短くても出力に出さない */
const SECRET_NAME = /PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL|CONNECTION_STRING/i;

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

/** OIDC の接続先の項目（空のときに入れる架空の値。example.test は予約された、つながらないドメイン） */
const ENDPOINT_DUMMIES: Readonly<Record<string, string>> = {
  OIDC_ISSUER: "https://idp.example.test",
  OIDC_REDIRECT_URI: "http://localhost:5173/api/auth/oidc/callback",
  APP_BASE_URL: "http://localhost:5173",
};

const HYPERDRIVE = "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE";
const DUMMY_DB_USER = "testuser_verify";

export interface EnsureEnvOptions {
  /** 検証用の DB のポートに使う、空いているポートを返す（既定は OS に空きを聞く）。テストで差し替える */
  pickPort?: () => Promise<number>;
}

export interface EnsureEnvResult {
  /** 今回作ったファイル名 */
  created: string[];
  /** すでにあって、変えなかったファイル名 */
  existing: string[];
}

function randomValue(): string {
  return randomBytes(16).toString("hex");
}

/** 今空いている、待ち受けできるポート */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("空いているポートを決められませんでした"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

interface PostgresValues {
  user: string;
  password: string;
  db: string;
  port: string;
  url: string;
}

function isPlaceholder(value: string): boolean {
  return value === "" || value.startsWith("<");
}

/**
 * .env.development と .env.test を、無いときだけ、.env.example の項目から架空の値で作る。
 * すでにあるファイルは、1バイトも変えない。乱数で作った値は、どこにも表示しない（戻り値にも入れない）。
 * PostgreSQL の項目は、環境ごとに別の値にする（検証用のデータベース名は末尾 _test、ポートも別）。
 */
export async function ensureEnvFiles(
  projectDir: string,
  options: EnsureEnvOptions = {},
): Promise<EnsureEnvResult> {
  const result: EnsureEnvResult = { created: [], existing: [] };
  const missing = ENVIRONMENTS.filter((env) => !existsSync(path.join(projectDir, `.env.${env}`)));
  for (const env of ENVIRONMENTS) {
    if (!missing.includes(env)) result.existing.push(`.env.${env}`);
  }
  if (missing.length === 0) return result;

  const example = readFileSync(path.join(projectDir, ".env.example"), "utf8");
  const lines = example.split(/\r?\n/);
  const exampleValue = (name: string): string | undefined => {
    const line = lines.find((l) => !l.startsWith("#") && l.startsWith(`${name}=`));
    return line?.slice(name.length + 1);
  };
  const hasPostgres = lines.some(
    (l) => l.startsWith("POSTGRES_DB=") || l.startsWith("DATABASE_URL="),
  );

  const devPort = exampleValue("POSTGRES_PORT") || "5432";
  const pickPort = options.pickPort ?? pickFreePort;
  const postgres = async (env: EnvName): Promise<PostgresValues> => {
    const base = exampleValue("POSTGRES_DB") || "app_dev";
    const db =
      env === "test" ? `${base.replace(/_dev$/, "")}_test` : base.replace(/_test$/, "_dev");
    let port = devPort;
    if (env === "test") {
      port = String(await pickPort());
      for (let i = 0; port === devPort && i < 10; i++) port = String(await pickPort());
    }
    const password = randomValue();
    return {
      user: DUMMY_DB_USER,
      password,
      db,
      port,
      url: `postgresql://${DUMMY_DB_USER}:${password}@localhost:${port}/${db}`,
    };
  };

  for (const env of missing) {
    const pg = hasPostgres ? await postgres(env) : undefined;
    const out = lines.map((line) => {
      const eq = line.indexOf("=");
      if (line.startsWith("#") || eq <= 0) return line;
      const name = line.slice(0, eq);
      const value = line.slice(eq + 1);
      if (name === "APP_ENV") return `${name}=${env}`;
      if (pg) {
        if (name === "POSTGRES_USER") return `${name}=${pg.user}`;
        if (name === "POSTGRES_PASSWORD") return `${name}=${pg.password}`;
        if (name === "POSTGRES_DB") return `${name}=${pg.db}`;
        if (name === "POSTGRES_PORT") return `${name}=${pg.port}`;
        if (name === "DATABASE_URL" || name === HYPERDRIVE) return `${name}=${pg.url}`;
      }
      if (!isPlaceholder(value)) return line;
      const endpoint = ENDPOINT_DUMMIES[name];
      if (endpoint !== undefined) return `${name}=${endpoint}`;
      if (isSecretName(name)) return `${name}=${randomValue()}`;
      return `${name}=dummy_verify_${name.toLowerCase()}`;
    });
    writeFileSync(path.join(projectDir, `.env.${env}`), `${out.join("\n").trimEnd()}\n`);
    result.created.push(`.env.${env}`);
  }
  return result;
}

export interface EnvSecrets {
  /** 出力から消す値（長いものから順）。URL で使える形（エンコードした形）も含む */
  values: string[];
  /** 秘密の項目に、8文字未満の値がある。この場合は、出力を一切残さない */
  hasShortSecret: boolean;
}

/** 値を出力から消す最小の長さ（秘密でない項目）と、秘密の項目の「短い」の境目 */
const MIN_REDACT_LENGTH = 4;
const SHORT_SECRET_LENGTH = 8;

/** .env.development・.env.test のすべての値から、出力から消す値を集める（ファイルが無ければ飛ばす） */
export function readEnvSecrets(projectDir: string): EnvSecrets {
  const found = new Set<string>();
  let hasShortSecret = false;
  for (const env of ENVIRONMENTS) {
    const file = path.join(projectDir, `.env.${env}`);
    if (!existsSync(file)) continue;
    let parsed: Record<string, string | undefined>;
    try {
      parsed = parseEnv(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const [name, value] of Object.entries(parsed)) {
      if (value === undefined || value === "") continue;
      // APP_ENV の値（development・test）は環境の名前で、秘密ではない。出力のあちこちにある語を消さないよう、除く
      if (name === "APP_ENV") continue;
      if (isSecretName(name) && value.length < SHORT_SECRET_LENGTH) hasShortSecret = true;
      if (value.length < MIN_REDACT_LENGTH) continue;
      found.add(value);
      const encoded = encodeURIComponent(value);
      if (encoded.length >= MIN_REDACT_LENGTH) found.add(encoded);
    }
  }
  return { values: [...found].sort((a, b) => b.length - a.length), hasShortSecret };
}

const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]*:)([^\s@/]+)(@)/gi;

/** 秘密の値を [REDACTED] に置き換える関数。つないだ文字列に対して使う（チャンクの境目で分かれた値も消える） */
export function buildRedactor(secrets: EnvSecrets): (text: string) => string {
  return (text) => {
    let out = text;
    for (const value of secrets.values) out = out.split(value).join("[REDACTED]");
    return out.replace(URL_PASSWORD, "$1[REDACTED]$3");
  };
}
