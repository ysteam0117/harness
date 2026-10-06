import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { contentOf, generated, parseWranglerJsonc } from "./skeleton-helpers.js";

const folders: string[] = [];
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(test = "APP_ENV=test\nALLOWED_ORIGINS=http://localhost:5173\n") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harness-env51-test-"));
  folders.push(dir);
  writeFileSync(path.join(dir, ".env.example"), "APP_ENV=development\nALLOWED_ORIGINS=\n");
  writeFileSync(path.join(dir, ".env.test"), test);
  return dir;
}

function probe(dir: string, environment = "test", inherited: Record<string, string> = {}) {
  const module = pathToFileURL(path.resolve("templates/scripts/local-env.ts")).href;
  const script = `import { loadLocalEnvironment } from ${JSON.stringify(module)};
try {
  const result = loadLocalEnvironment(${JSON.stringify(environment)}, ${JSON.stringify(dir)});
  console.log(JSON.stringify(result));
} catch (error) { console.error(error.message); process.exitCode = 1; }`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...inherited },
  });
}

function execute(
  script: string,
  dir: string,
  args: string[] = [],
  inherited: Record<string, string> = {},
) {
  return spawnSync(process.execPath, [path.resolve(`templates/scripts/${script}`), ...args], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...inherited },
  });
}

function fakeTool(dir: string) {
  const target = path.join(dir, "node_modules", "vite");
  mkdirSync(target, { recursive: true });
  writeFileSync(
    path.join(target, "package.json"),
    JSON.stringify({ name: "vite", bin: "cli.mjs", type: "module" }),
  );
  writeFileSync(
    path.join(target, "cli.mjs"),
    `import { writeFileSync } from "node:fs";
writeFileSync("child-env.json", JSON.stringify({ APP_ENV: process.env.APP_ENV, DATABASE_URL: process.env.DATABASE_URL, LEAK: process.env.LEAK, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN, VITE_SECRET: process.env.VITE_SECRET }));`,
  );
}

function fakeWrangler(dir: string) {
  const target = path.join(dir, "node_modules", "wrangler");
  mkdirSync(target, { recursive: true });
  writeFileSync(
    path.join(target, "package.json"),
    JSON.stringify({ name: "wrangler", bin: "cli.mjs", type: "module" }),
  );
  writeFileSync(
    path.join(target, "cli.mjs"),
    `import { writeFileSync } from "node:fs";
writeFileSync("wrangler-args.json", JSON.stringify(process.argv.slice(2)));`,
  );
}

function fakeDrizzle(dir: string) {
  const target = path.join(dir, "node_modules", "drizzle-kit");
  mkdirSync(target, { recursive: true });
  writeFileSync(
    path.join(target, "package.json"),
    JSON.stringify({ name: "drizzle-kit", bin: "cli.mjs", type: "module" }),
  );
  writeFileSync(
    path.join(target, "cli.mjs"),
    `import { writeFileSync } from "node:fs";
writeFileSync("drizzle-args.json", JSON.stringify(process.argv.slice(2)));`,
  );
}

function expectIsolatedViteEnvDirectory(config: string, branches: number) {
  const dirs = [...config.matchAll(/\benvDir:\s*["']([^"']+)["']/g)].map((match) => {
    const dir = match[1];
    if (dir === undefined) throw new Error("envDir の値を読めません");
    return dir;
  });
  expect(dirs).toHaveLength(branches);
  for (const dir of dirs) {
    const normalized = path.posix.normalize(dir.replaceAll("\\", "/"));
    expect(
      normalized.startsWith("node_modules/"),
      `共通 .env を読まない専用ディレクトリ: ${dir}`,
    ).toBe(true);
    expect(normalized).not.toContain("../");
  }
  expect(config).not.toMatch(/\benvFile\s*:/);
}

describe("#51 環境ファイルを混ぜない・接続より前に拒否する", () => {
  it(".env.test だけを読み、共通・開発・親環境の値は混ぜない", () => {
    const dir = fixture();
    writeFileSync(path.join(dir, ".env"), "LEAK=common_secret\nAPP_ENV=production\n");
    writeFileSync(path.join(dir, ".env.local"), "LEAK=local_secret\n");
    writeFileSync(path.join(dir, ".env.development"), "LEAK=dev_secret\n");
    const result = probe(dir, "test", { LEAK: "parent_secret", APP_ENV: "production" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      APP_ENV: "test",
      ALLOWED_ORIGINS: "http://localhost:5173",
    });
  });

  it.each(["", "development", "production"])("APP_ENV=%s は値を漏らさず止まる", (value) => {
    const result = probe(fixture(`APP_ENV=${value}\nSESSION_SECRET=dummy_private_51\n`));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("APP_ENV");
    expect(result.stderr).not.toContain("dummy_private_51");
  });

  it.each([
    "postgresql://testuser:dummy_private_51@external.example.com/app_test",
    "postgresql://testuser:dummy_private_51@localhost/app_dev",
    "https://localhost/app_test",
  ])("危険なDB接続先を拒否し、接続文字列は表示しない", (url) => {
    const result = probe(fixture(`APP_ENV=test\nDATABASE_URL=${url}\n`));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stderr).not.toContain(url);
    expect(result.stderr).not.toContain("dummy_private_51");
  });

  it("DATABASE_URL が安全でも Hyperdrive が外部なら止まる", () => {
    const result = probe(
      fixture(
        "APP_ENV=test\nDATABASE_URL=postgresql://testuser:dummy@localhost/app_test\nCLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://testuser:dummy@external.example.com/app_test\n",
      ),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CLOUDFLARE_HYPERDRIVE");
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("手元のテスト専用DBを許可する：%s", (host) => {
    const url = `postgresql://testuser:dummy@${host}:5432/app_test`;
    const result = probe(
      fixture(
        `APP_ENV=test\nPOSTGRES_DB=app_test\nDATABASE_URL=${url}\nCLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=${url}\n`,
      ),
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it(".dev.vars による暗黙の混入を拒否する", () => {
    const dir = fixture();
    writeFileSync(path.join(dir, ".dev.vars"), "SECRET=dummy_private_51\n");
    const result = probe(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".dev.vars");
    expect(result.stderr).not.toContain("dummy_private_51");
  });

  it("#51 AC-1: .env.test.local と親環境の値を子プロセスへ渡さない", () => {
    const dir = fixture();
    writeFileSync(path.join(dir, ".env.example"), "APP_ENV=development\nALLOWED_ORIGINS=\nLEAK=\n");
    fakeTool(dir);
    writeFileSync(path.join(dir, ".env.test.local"), "LEAK=local_secret\n");
    const result = execute("run-local.ts", dir, ["test", "vite"], {
      LEAK: "parent_secret",
      APP_ENV: "production",
      DATABASE_URL: "postgresql://user:dummy@external.example.com/prod",
      CLOUDFLARE_API_TOKEN: "dummy_private_51",
      VITE_SECRET: "dummy_private_51",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, "child-env.json"), "utf8"))).toEqual({
      APP_ENV: "test",
    });
  });

  it.each([
    "APP_ENV=development\n",
    "APP_ENV=test\nDATABASE_URL=postgresql://user:dummy@external.example.com/app_test\n",
  ])("#51 AC-1: 設定が不正なら道具の起動前に停止する", (env) => {
    const dir = fixture(env);
    fakeTool(dir);
    const result = execute("run-local.ts", dir, ["test", "vite"]);
    expect(result.status).toBe(1);
    expect(() => readFileSync(path.join(dir, "child-env.json"), "utf8")).toThrow();
    expect(result.stdout + result.stderr).not.toContain("dummy");
  });

  it("#51 AC-1: 開発は専用の .env.development を読み、末尾 _test のDBを拒否する", () => {
    const dir = fixture();
    writeFileSync(
      path.join(dir, ".env.development"),
      "APP_ENV=development\nALLOWED_ORIGINS=http://localhost:5173\nDATABASE_URL=postgresql://user:dummy@localhost/app_test\n",
    );
    const result = probe(dir, "development");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stderr).not.toContain("dummy");
  });

  it("#51 AC-1: DATABASE_URL と Hyperdrive の接続先が異なる場合は拒否する", () => {
    const result = probe(
      fixture(
        "APP_ENV=test\nDATABASE_URL=postgresql://user:dummy@localhost/one_test\nCLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://user:dummy@localhost/two_test\n",
      ),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CLOUDFLARE_HYPERDRIVE");
    expect(result.stderr).not.toContain("dummy");
  });

  it.each(["test", "development"] as const)(
    "#51 AC-2: %s の POSTGRES_PORT と両接続URLの5432が異なれば接続前に拒否する",
    (environment) => {
      const name = environment === "test" ? "app_test" : "app_dev";
      const secret = "dummy_private_51";
      const url = `postgresql://user:${secret}@localhost:5432/${name}`;
      const values = `APP_ENV=${environment}\nPOSTGRES_PORT=5433\nPOSTGRES_DB=${name}\nDATABASE_URL=${url}\nCLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=${url}\n`;
      const dir = fixture();
      writeFileSync(path.join(dir, `.env.${environment}`), values);
      const result = probe(dir, environment);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("POSTGRES_PORT");
      expect(result.stderr).not.toContain(secret);
      expect(result.stderr).not.toContain(url);
    },
  );

  it.each(["test", "development"] as const)(
    "#51 AC-2: %s のURLでport省略時は5432として照合する",
    (environment) => {
      const name = environment === "test" ? "app_test" : "app_dev";
      const url = `postgresql://user:dummy@localhost/${name}`;
      const dir = fixture();
      const envFile = path.join(dir, `.env.${environment}`);
      const body = (port: string) =>
        `APP_ENV=${environment}\nPOSTGRES_PORT=${port}\nPOSTGRES_DB=${name}\nDATABASE_URL=${url}\nCLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=${url}\n`;
      writeFileSync(envFile, body("5432"));
      expect(probe(dir, environment).status).toBe(0);
      writeFileSync(envFile, body("5433"));
      const mismatch = probe(dir, environment);
      expect(mismatch.status).toBe(1);
      expect(mismatch.stderr).toContain("POSTGRES_PORT");
      expect(mismatch.stderr).not.toContain(url);
    },
  );

  it.each(["test", "development"] as const)(
    "#51 AC-2: %s の両URLとPOSTGRES_PORTが5433なら許可する",
    (environment) => {
      const name = environment === "test" ? "app_test" : "app_dev";
      const url = `postgresql://user:dummy@localhost:5433/${name}`;
      const dir = fixture();
      writeFileSync(
        path.join(dir, `.env.${environment}`),
        `APP_ENV=${environment}\nPOSTGRES_PORT=5433\nPOSTGRES_DB=${name}\nDATABASE_URL=${url}\nCLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=${url}\n`,
      );
      const result = probe(dir, environment);
      expect(result.status, result.stderr).toBe(0);
    },
  );

  it("#51 AC-1: JSONC の行内コメントと末尾カンマを読んで remote binding を拒否する", () => {
    const dir = fixture();
    writeFileSync(
      path.join(dir, "wrangler.jsonc"),
      '{ "r2_buckets": [{ "binding": "UPLOADS", "remote": true, /* local only */ }], }',
    );
    const result = probe(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("remote");
  });

  it("#51 AC-1: JSONC の行内コメントと末尾カンマを正常に読み取る", () => {
    const dir = fixture();
    writeFileSync(
      path.join(dir, "wrangler.jsonc"),
      '{ "r2_buckets": [{ "binding": "UPLOADS", /* local */ }], }',
    );
    const result = probe(dir);
    expect(result.status, result.stderr).toBe(0);
  });

  it("#51 AC-1: .dev.vars.test も拒否する", () => {
    const dir = fixture();
    writeFileSync(path.join(dir, ".dev.vars.test"), "SECRET=dummy_private_51\n");
    const result = probe(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".dev.vars");
  });
});

describe("#51 AC-3 環境確認の表示", () => {
  it("環境名と不足する名前だけを表示する", () => {
    const dir = fixture("APP_ENV=test\nSESSION_SECRET=dummy_private_51\n");
    const result = spawnSync(
      process.execPath,
      [path.resolve("templates/scripts/env-check.mjs"), "test"],
      {
        cwd: dir,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("環境：test");
    expect(result.stdout + result.stderr).toContain("ALLOWED_ORIGINS");
    expect(result.stdout + result.stderr).not.toContain("dummy_private_51");
  });

  it("#51 AC-3: 不正な接続先を表示せず失敗する", () => {
    const dir = fixture(
      "APP_ENV=test\nALLOWED_ORIGINS=http://localhost:5173\nDATABASE_URL=postgresql://user:dummy_private_51@external.example.com/app_test\n",
    );
    const result = execute("env-check.mjs", dir, ["test"]);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("DATABASE_URL");
    expect(result.stdout + result.stderr).not.toContain("dummy_private_51");
    expect(result.stdout + result.stderr).not.toContain("external.example.com");
  });
});

describe("#51 AC-4 テストから remote を呼ばない", () => {
  it.each([
    ["直接指定", { test: "wrangler dev --remote" }, {}],
    ["間接呼出", { test: "npm run inner", inner: "wrangler dev --remote" }, {}],
    ["npm フック", { test: "vitest run", pretest: "wrangler dev --remote" }, {}],
    [
      "静的 import",
      { test: "vitest run" },
      {
        "vitest.config.ts": 'import "./helper.ts";',
        "helper.ts": 'export const args = "--remote";',
      },
    ],
    [
      "拡張子なしの相対 import",
      { test: "vitest run" },
      { "vitest.config.ts": 'import "./helper";', "helper.ts": 'export const args = "--remote";' },
    ],
    [
      "Windows npm.cmd の間接呼出",
      { test: "npm.cmd run inner", inner: "wrangler dev --remote" },
      {},
    ],
    ["npm run -s の間接呼出", { test: "npm run -s inner", inner: "wrangler dev --remote" }, {}],
    [
      "npm --silent run の間接呼出",
      { test: "npm --silent run inner", inner: "wrangler dev --remote" },
      {},
    ],
  ])("#51 AC-4: %s での --remote を拒否する", (_label, scripts, files) => {
    const dir = fixture();
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts }));
    for (const [name, content] of Object.entries(files))
      writeFileSync(path.join(dir, name), content);
    const result = execute("test-safety.mjs", dir);
    expect(result.status, result.stdout + result.stderr).toBe(1);
  });

  it("#51 AC-4: 本番 deploy の --remote はテスト起動経路でなければ誤検出しない", () => {
    const dir = fixture();
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", deploy: "wrangler deploy --remote" } }),
    );
    const result = execute("test-safety.mjs", dir);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});

describe("#51 生成する設定", () => {
  it.each(["d1", "postgresql", "none"] as const)(
    "%s：共通処理と明示的な起動・テストを生成する",
    async (database) => {
      const files = await generated({
        auth: "none",
        database,
        upload: false,
        label: `env51-${database}`,
      });
      const pkg = JSON.parse(contentOf(files, "package.json")) as {
        scripts: Record<string, string>;
      };
      expect(contentOf(files, "scripts/local-env.ts")).toContain("loadLocalEnvironment");
      expect(pkg.scripts.test).toContain("test");
      expect(pkg.scripts.dev).toContain("development");
      // #42 R1：これまでの check の中身は check:app に移った（check は check:app と security をつなぐ）
      expect(pkg.scripts["check:app"]).toContain("test:safety");
      expect(contentOf(files, "vitest.config.ts")).toContain("loadLocalEnvironment");
      expectIsolatedViteEnvDirectory(contentOf(files, "vite.config.ts"), 2);
      expect(parseWranglerJsonc(contentOf(files, "wrangler.jsonc"))["vars"]).toMatchObject({
        APP_ENV: "production",
      });
    },
  );

  it("テスト安全性のチェックは生成物の実行スクリプトを検査する", () => {
    expect(readFileSync("templates/scripts/test-safety.mjs", "utf8")).toContain("--remote");
  });

  it.each(["d1", "postgresql", "none"] as const)(
    "#51 AC-1: %s の生成物にローカル起動と型検査対象の scripts を含める",
    async (database) => {
      const files = await generated({
        auth: "none",
        database,
        upload: false,
        label: `env51-${database}`,
      });
      const pkg = JSON.parse(contentOf(files, "package.json")) as {
        scripts: Record<string, string>;
      };
      const tsconfig = JSON.parse(
        contentOf(files, "tsconfig.json").replace(/^\s*\/\/.*$/gm, ""),
      ) as { include: string[] };
      for (const name of [
        "scripts/env-check.mjs",
        "scripts/local-env.ts",
        "scripts/run-local.ts",
        "scripts/test-safety.mjs",
        "scripts/db-local.ts",
        "scripts/compose-local.ts",
      ]) {
        expect(files.find((file) => file.path === name)?.managed, name).toBe(true);
      }
      expect(
        tsconfig.include.some(
          (item) => item === "scripts" || item === "scripts/**/*.ts" || item === "scripts/**/*",
        ),
      ).toBe(true);
      expect(pkg.scripts.predev).toContain("env:check");
      expect(pkg.scripts.pretest).toContain("env:check");
      expect(pkg.scripts["check:app"]).toMatch(/^npm run test:safety/);
      expect(pkg.scripts.build).toMatch(/run-local|env:check/);
      expect(pkg.scripts.dev).toMatch(/run-local|env:check/);
      expect(pkg.scripts.test).toMatch(/run-local|env:check/);
      expectIsolatedViteEnvDirectory(contentOf(files, "vite.config.ts"), 2);
      expectIsolatedViteEnvDirectory(contentOf(files, "vitest.config.ts"), 1);
      expect(
        files.some((file) => file.path === ".env.development" || file.path === ".env.test"),
      ).toBe(false);
    },
  );

  it("#51 AC-2: D1 と R2 の開発stateを分け、Vitestはテスト専用bindingとmigrationを使う", async () => {
    for (const upload of [false, true]) {
      const files = await generated({
        auth: "none",
        database: "d1",
        upload,
        label: `env51-d1-${upload}`,
      });
      const pkg = JSON.parse(contentOf(files, "package.json")) as {
        scripts: Record<string, string>;
      };
      const vite = contentOf(files, "vite.config.ts");
      const vitest = contentOf(files, "vitest.config.ts");
      expect(pkg.scripts.dev).toContain("development");
      expect(pkg.scripts.test).toContain("test");
      expect(pkg.scripts["db:migrate:local"]).toMatch(/scripts\/db-local\.ts development migrate/);
      const dbLocal = contentOf(files, "scripts/db-local.ts");
      expect(dbLocal).toContain('"--persist-to"');
      expect(dbLocal).toContain("localStatePath(environment");
      expect(dbLocal).toMatch(/migrations["'],\s*["']apply/);
      expect(vite).toContain("localStatePath");
      expect(vitest).toContain('loadLocalEnvironment("test")');
      expect(vitest).toContain("readD1Migrations");
      expect(vitest).toContain("TEST_MIGRATIONS");
      expect(vitest).toContain("apply-migrations.ts");
      expect(vitest).toMatch(/miniflare:\s*\{\s*bindings:/);
      expect(vitest).not.toContain("localStatePath");
      expect(vitest).not.toContain("persistState");
      // 開発DBの内容が変わらないことは smoke の実生成物・実行テストで検証する。
    }
  });

  it("#51 AC-2: PostgreSQL のDB操作と Docker 起動は選択した環境で検証する", async () => {
    const files = await generated({
      auth: "none",
      database: "postgresql",
      upload: false,
      label: "env51-pg",
    });
    const pkg = JSON.parse(contentOf(files, "package.json")) as { scripts: Record<string, string> };
    for (const name of [
      "db:generate",
      "db:migrate",
      "db:seed:local",
      "db:reset:local",
      "db:cleanup",
    ]) {
      expect(pkg.scripts[name], name).toMatch(/db-local|run-local/);
    }
    expect(files.some((file) => file.path === "scripts/db-local.ts")).toBe(true);
    expect(files.some((file) => file.path === "scripts/compose-local.ts")).toBe(true);
    expect(pkg.scripts["docker:up:local"]).toContain("compose-local");
    expect(contentOf(files, "scripts/compose-local.ts")).toContain("--env-file");
  });
});

describe("#51 AC-2: D1 wrapper が選択環境の保存先だけを渡す", () => {
  it.each(["development", "test"])(
    "%s の migration は専用 --persist-to を Wrangler に渡す",
    (environment) => {
      const dir = fixture();
      fakeWrangler(dir);
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "example-app" }));
      writeFileSync(
        path.join(dir, ".env.development"),
        "APP_ENV=development\nALLOWED_ORIGINS=http://localhost:5173\n",
      );
      const result = execute("db-local.ts", dir, [environment, "migrate"]);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const args = JSON.parse(
        readFileSync(path.join(dir, "wrangler-args.json"), "utf8"),
      ) as string[];
      expect(args).toEqual([
        "d1",
        "migrations",
        "apply",
        "DB",
        "--local",
        "--persist-to",
        `.wrangler/state/${environment}`,
      ]);
    },
  );
});

describe("#51 AC-2: db:generate の追加引数を限定する", () => {
  it("安全な --name は Drizzle の実引数へ伝える", () => {
    const dir = fixture();
    fakeDrizzle(dir);
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "example-app" }));
    const result = execute("db-local.ts", dir, ["test", "generate", "--name", "add-users_51"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, "drizzle-args.json"), "utf8"))).toEqual([
      "generate",
      "--name",
      "add-users_51",
    ]);
  });

  it.each([
    ["--remote"],
    ["--name", "../unsafe"],
    ["--name", "safe", "--remote"],
    ["--unknown", "value"],
  ])("不許可の追加引数 %j は Drizzle 起動前に拒否する", (...args) => {
    const dir = fixture();
    fakeDrizzle(dir);
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "example-app" }));
    const result = execute("db-local.ts", dir, ["test", "generate", ...args]);
    expect(result.status).toBe(1);
    expect(() => readFileSync(path.join(dir, "drizzle-args.json"), "utf8")).toThrow();
  });
});
