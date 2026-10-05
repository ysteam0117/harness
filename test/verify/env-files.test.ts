// #57 R2・R6・R7：環境ファイル（.env.development・.env.test）の用意と、出力の秘密の値の伏せ字
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRedactor,
  ensureEnvFiles,
  isSecretName,
  readEnvSecrets,
} from "../../src/verify/env-files.js";
import { D1_ENV_EXAMPLE, PG_ENV_EXAMPLE, cleanupWorkDirs, makeProject } from "./helpers.js";

afterEach(cleanupWorkDirs);

const read = (dir: string, name: string) => parseEnv(readFileSync(path.join(dir, name), "utf8"));

/** テストでは、空いているポートを OS に聞かず、決まった順に返す */
const ports = (...values: number[]) => {
  const queue = [...values];
  return { pickPort: async () => queue.shift() ?? 59999 };
};

describe("#57 R2: ensureEnvFiles（無いときだけ、架空の値で作る）", () => {
  it("生成直後（どちらも無い）で、.env.development と .env.test の両方が作られ、項目の名前が .env.example と一致する", async () => {
    const { dir } = makeProject();
    const result = await ensureEnvFiles(dir);
    expect(result.created).toEqual([".env.development", ".env.test"]);
    expect(result.existing).toEqual([]);
    const names = Object.keys(parseEnv(D1_ENV_EXAMPLE)).sort();
    for (const file of [".env.development", ".env.test"]) {
      const values = read(dir, file);
      expect(Object.keys(values).sort()).toEqual(names);
      for (const name of names) expect(values[name], `${file} の ${name}`).toBeTruthy();
    }
  });

  it("APP_ENV は、それぞれ development・test。OIDC の接続先は example.test の架空の値", async () => {
    const { dir } = makeProject();
    await ensureEnvFiles(dir);
    expect(read(dir, ".env.development")["APP_ENV"]).toBe("development");
    expect(read(dir, ".env.test")["APP_ENV"]).toBe("test");
    expect(read(dir, ".env.test")["OIDC_ISSUER"]).toContain("example.test");
  });

  it("片方だけあるときは、もう片方だけを作り、あるほうは1バイトも変えない", async () => {
    const original = "APP_ENV=development\nSESSION_SECRET=FAKE_SECRET_FOR_TEST\n# メモ\n";
    const { dir } = makeProject({ files: { ".env.development": original } });
    const before = readFileSync(path.join(dir, ".env.development"));
    const result = await ensureEnvFiles(dir);
    expect(result.created).toEqual([".env.test"]);
    expect(result.existing).toEqual([".env.development"]);
    expect(readFileSync(path.join(dir, ".env.development")).equals(before)).toBe(true);
    expect(read(dir, ".env.test")["APP_ENV"]).toBe("test");
  });

  it("両方あるときは、何も作らず、どちらも1バイトも変えない", async () => {
    const { dir } = makeProject({
      files: { ".env.development": "APP_ENV=development\n", ".env.test": "A=b\r\n\r\n" },
    });
    const a = readFileSync(path.join(dir, ".env.development"));
    const b = readFileSync(path.join(dir, ".env.test"));
    const result = await ensureEnvFiles(dir);
    expect(result).toEqual({ created: [], existing: [".env.development", ".env.test"] });
    expect(readFileSync(path.join(dir, ".env.development")).equals(a)).toBe(true);
    expect(readFileSync(path.join(dir, ".env.test")).equals(b)).toBe(true);
  });

  it("乱数の値は、戻り値のどこにも入らず、開発と検証で別の値になる", async () => {
    const { dir } = makeProject();
    const result = await ensureEnvFiles(dir);
    const dev = read(dir, ".env.development");
    const test = read(dir, ".env.test");
    expect(dev["SESSION_SECRET"]).not.toBe(test["SESSION_SECRET"]);
    const shown = JSON.stringify(result);
    for (const value of [
      dev["SESSION_SECRET"],
      test["SESSION_SECRET"],
      dev["OIDC_CLIENT_SECRET"],
    ]) {
      expect(shown).not.toContain(value as string);
    }
  });

  it("PostgreSQL：検証用は末尾 _test のデータベース名と別のポート。接続先・ユーザー・パスワードが項目と一致する", async () => {
    const { dir } = makeProject({ envExample: PG_ENV_EXAMPLE });
    await ensureEnvFiles(dir, ports(5432, 55432));
    const dev = read(dir, ".env.development");
    const test = read(dir, ".env.test");
    expect(dev["POSTGRES_DB"]).toBe("app_dev");
    expect(test["POSTGRES_DB"]).toBe("app_test");
    expect(dev["POSTGRES_PORT"]).toBe("5432");
    expect(test["POSTGRES_PORT"]).toBe("55432"); // 開発と同じポートが返ったら、取り直す
    for (const [env, values] of [
      ["development", dev],
      ["test", test],
    ] as const) {
      const url = new URL(values["DATABASE_URL"] as string);
      expect(url.hostname, env).toBe("localhost");
      expect(url.port).toBe(values["POSTGRES_PORT"]);
      expect(url.pathname.slice(1)).toBe(values["POSTGRES_DB"]);
      expect(decodeURIComponent(url.username)).toBe(values["POSTGRES_USER"]);
      expect(decodeURIComponent(url.password)).toBe(values["POSTGRES_PASSWORD"]);
      expect(values["CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"]).toBe(
        values["DATABASE_URL"],
      );
    }
    expect(dev["POSTGRES_PASSWORD"]).not.toBe(test["POSTGRES_PASSWORD"]);
  });

  it("生成物の .gitignore は、どちらの環境ファイルも除外し、.env.example だけを除外しない", () => {
    const text = readFileSync(
      path.join(import.meta.dirname, "../../templates/project/gitignore"),
      "utf8",
    );
    const lines = text.split(/\r?\n/);
    expect(lines).toContain(".env.*"); // .env.development・.env.test を含む
    expect(lines).toContain("!.env.example");
    expect(lines.indexOf("!.env.example")).toBeGreaterThan(lines.indexOf(".env.*"));
  });

  it("作った環境ファイルは、ファイルの存在を後から確かめられる", async () => {
    const { dir } = makeProject();
    await ensureEnvFiles(dir);
    expect(existsSync(path.join(dir, ".env.test"))).toBe(true);
  });
});

describe("#57 R6・R7: 出力の秘密の値", () => {
  it("秘密の項目の名前の判定", () => {
    for (const name of [
      "POSTGRES_PASSWORD",
      "SESSION_SECRET",
      "API_TOKEN",
      "SOME_KEY",
      "DATABASE_URL",
      "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE",
    ]) {
      expect(isSecretName(name), name).toBe(true);
    }
    expect(isSecretName("APP_PORT")).toBe(false);
  });

  it("両方のファイルの、4文字以上の値が集まる。APP_ENV の値と、4文字未満の値は集めない", () => {
    const { dir } = makeProject({
      files: {
        ".env.development":
          "APP_ENV=development\nFOO=abcd\nBAR=abc\nSESSION_SECRET=FAKE_SECRET_FOR_TEST\n",
        ".env.test": "APP_ENV=test\nBAZ=wxyz1234\n",
      },
    });
    const secrets = readEnvSecrets(dir);
    expect(secrets.values).toContain("abcd");
    expect(secrets.values).toContain("wxyz1234");
    expect(secrets.values).toContain("FAKE_SECRET_FOR_TEST");
    expect(secrets.values).not.toContain("abc");
    expect(secrets.values).not.toContain("development");
    expect(secrets.hasShortSecret).toBe(false);
    // 長いものから順
    expect(secrets.values[0]).toBe("FAKE_SECRET_FOR_TEST");
  });

  it("R7：秘密の項目に8文字未満の値があると、hasShortSecret になる（秘密でない項目の短い値はならない）", () => {
    const short = makeProject({ files: { ".env.test": "APP_ENV=test\nPOSTGRES_PASSWORD=abc\n" } });
    expect(readEnvSecrets(short.dir).hasShortSecret).toBe(true);
    const notSecret = makeProject({ files: { ".env.test": "APP_ENV=test\nAPP_PORT=51\n" } });
    expect(readEnvSecrets(notSecret.dir).hasShortSecret).toBe(false);
    const none = makeProject();
    expect(readEnvSecrets(none.dir)).toEqual({ values: [], hasShortSecret: false });
  });

  it("伏せ字：値・URL の中のパスワードを [REDACTED] にする。長い値から先に置き換える", () => {
    const redact = buildRedactor({
      values: ["FAKE_SECRET_FOR_TEST_LONG", "FAKE_SECRET_FOR_TEST"],
      hasShortSecret: false,
    });
    expect(redact("a FAKE_SECRET_FOR_TEST_LONG b")).toBe("a [REDACTED] b");
    expect(redact("postgresql://testuser_001:FAKE_PW_9999@localhost:5432/x")).toBe(
      "postgresql://testuser_001:[REDACTED]@localhost:5432/x",
    );
    expect(redact("https://example.com/path のあとに user:pw@x は URL ではない")).toContain(
      "user:pw@x",
    );
  });

  it("実ファイルに書いた値は、URL に入れた形（エンコード）でも伏せる", () => {
    const { dir } = makeProject({
      files: { ".env.test": "APP_ENV=test\nSESSION_SECRET=FAKE secret/for+test\n" },
    });
    writeFileSync(path.join(dir, ".env.development"), "APP_ENV=development\n");
    const redact = buildRedactor(readEnvSecrets(dir));
    expect(redact(`x ${encodeURIComponent("FAKE secret/for+test")} y`)).toBe("x [REDACTED] y");
  });
});
