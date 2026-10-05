// #64 E2E と IaC のひな形：生成するプロジェクトの内容（メモリ上の buildProject の結果）のテスト。
// 実際の実行（ブラウザの起動・terraform validate）は scripts/smoke-generated.ts が行う。ここでは行わない。
//
// 想定する仕様（実装はこの形に合わせる）
//   E2E（常に）：playwright.config.ts（webServer で npm run dev:test を起動。接続先の切り替えはない）、
//     e2e/health.spec.ts（画面と /api/health を確かめる）、e2e/console-guard.ts
//   E2E（DB あり）：e2e/seeds/health.sql（e2euser_health_001 を1行）、e2e/sample-users.spec.ts、cleanup.sql が e2euser_ も消す。
//     DB の初期化は globalSetup ではなく、サーバーの起動前に走る pretest:e2e で行う
//   IaC（infra/）：versions.tf・providers.tf・variables.tf・outputs.tf・README.md は常に。
//     d1.tf は D1、r2.tf はアップロードあり、hyperdrive.tf は PostgreSQL のときだけ
//   data/runtimes.yaml に、確かめた Cloudflare プロバイダーの版（terraform_cloudflare_provider）を置く
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildProject } from "../../src/generate/project.js";
import { contentOf, generated, pathsOf, validCombos, type Combo } from "./skeleton-helpers.js";
import { projectInput } from "./project-helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const combos = validCombos();
const dbCombos = combos.filter((c) => c.database !== "none");
const noDbCombos = combos.filter((c) => c.database === "none");
const d1Combos = combos.filter((c) => c.database === "d1");
const pgCombos = combos.filter((c) => c.database === "postgresql");
const uploadCombos = combos.filter((c) => c.upload);
const noUploadCombos = combos.filter((c) => !c.upload);

const runtimes = parseYaml(readFileSync(path.join(repoRoot, "data", "runtimes.yaml"), "utf8")) as {
  terraform_cloudflare_provider?: string;
  terraform_version?: string;
};

const INFRA_ALWAYS = [
  "infra/versions.tf",
  "infra/providers.tf",
  "infra/variables.tf",
  "infra/outputs.tf",
  "infra/README.md",
];

const scripts = async (c: Combo): Promise<Record<string, string>> => {
  const files = await generated(c);
  return (JSON.parse(contentOf(files, "package.json")) as { scripts: Record<string, string> })
    .scripts;
};

/** HCL の variable "名前" { ... } の本体 */
function variableBlock(hcl: string, name: string): string {
  const start = hcl.indexOf(`variable "${name}" {`);
  if (start < 0) throw new Error(`variable ${name} がありません`);
  const next = hcl.indexOf("\nvariable ", start + 1);
  return hcl.slice(start, next < 0 ? undefined : next);
}

describe("#64 AC-1: E2E のひな形（常に出る）", () => {
  it.each(combos)("#64 AC-1: %j は e2e/health.spec.ts と console-guard を出す", async (c) => {
    const files = await generated(c);
    expect(pathsOf(files)).toEqual(
      expect.arrayContaining([
        "e2e/health.spec.ts",
        "e2e/console-guard.ts",
        "playwright.config.ts",
      ]),
    );
  });

  it.each(combos)("#64 AC-1: %j の health.spec.ts は画面と /api/health を確かめる", async (c) => {
    const spec = contentOf(await generated(c), "e2e/health.spec.ts");
    expect(spec).toContain('from "./console-guard"');
    expect(spec).toContain("/api/health");
    expect(spec).toContain("サーバーの状態：ok");
    expect(spec).toContain("環境：test");
    expect(spec).toContain("サーバーにつながりません");
    expect(spec).not.toContain("@playwright/test");
  });

  it.each(combos)(
    "#64 AC-1: %j の playwright.config.ts は検証用サーバーを必ず起動する（接続先の切り替えはない）",
    async (c) => {
      const config = contentOf(await generated(c), "playwright.config.ts");
      expect(config).toContain("webServer");
      expect(config).toContain("npm run dev:test");
      expect(config).toMatch(/reuseExistingServer:\s*false/);
      expect(config).not.toContain("E2E_BASE_URL");
      expect(config).not.toContain("globalSetup");
      expect(config).toContain("chromium");
      expect(config).toMatch(/http:\/\/localhost:5173/);
    },
  );

  it.each(combos)("#64 AC-1: %j の package.json に test:e2e と pretest:e2e がある", async (c) => {
    const s = await scripts(c);
    expect(s["test:e2e"]).toBe("node scripts/run-local.ts test playwright test");
    expect(s["pretest:e2e"]).toContain("npm run env:check -- test");
    // E2E はブラウザが要るため、npm run check には入れない
    expect(s["check"]).not.toContain("e2e");
    expect(s["test"]).toBe("node scripts/run-local.ts test vitest run");
  });

  it.each(noDbCombos)("#64 AC-1: DB なし（%j）の pretest:e2e は環境の確認だけ", async (c) => {
    expect((await scripts(c))["pretest:e2e"]).toBe("npm run env:check -- test");
  });

  it.each(combos)(
    "#64 AC-1: %j の tsconfig は e2e/ を含み、vitest は e2e/ を読まない",
    async (c) => {
      const files = await generated(c);
      expect(contentOf(files, "tsconfig.json")).toContain('"e2e"');
      const vitest = contentOf(files, "vitest.config.ts");
      expect(vitest).not.toContain("e2e");
      for (const m of vitest.matchAll(/include:\s*\[([^\]]+)\]/g)) {
        expect(m[1]).not.toMatch(/e2e|\*\*\/\*\.spec/);
      }
    },
  );

  it.each(combos)("#64 AC-1: %j の docs/testing/e2e.md に実行と後始末の手順がある", async (c) => {
    const doc = contentOf(await generated(c), "docs/testing/e2e.md");
    expect(doc).toContain("npm run test:e2e");
    expect(doc).toContain("e2euser_");
    expect(doc).toContain("npm run check");
    expect(doc).not.toMatch(/^`npx playwright test`/m);
  });
});

describe("#64 AC-1: E2E のシード（DB あり）", () => {
  it.each(dbCombos)("#64 C-37: %j は架空のシードと、シードを読むシナリオを出す", async (c) => {
    const files = await generated(c);
    const seed = contentOf(files, "e2e/seeds/health.sql");
    expect(seed).toContain("e2euser_health_001");
    expect(seed).toContain("ON CONFLICT");
    expect(seed).not.toMatch(/@(?!example\.)/);
    const spec = contentOf(files, "e2e/sample-users.spec.ts");
    expect(spec).toContain("/api/sample-users");
    expect(spec).toContain("e2euser_health_001");
    expect(spec).toContain("page.request");
  });

  it.each(dbCombos)("#64 C-05: %j の cleanup.sql は e2euser_ も識別して消す", async (c) => {
    const cleanup = contentOf(await generated(c), "backend/db/seeds/cleanup.sql");
    expect(cleanup).toContain("testuser!_%");
    expect(cleanup).toContain("e2euser!_%");
    expect(cleanup).toMatch(/SELECT COUNT\(\*\)/);
  });

  it.each(dbCombos)(
    "#64 R4: %j の pretest:e2e は、サーバーの起動前に DB を初期化してシードを入れる",
    async (c) => {
      const pre = (await scripts(c))["pretest:e2e"] as string;
      const steps = pre.split("&&").map((s) => s.trim());
      expect(steps).toEqual([
        "npm run env:check -- test",
        "npm run db:reset:test",
        "node scripts/db-local.ts test seed-file e2e/seeds/health.sql",
      ]);
    },
  );

  it.each(dbCombos)("#64 R4: %j は globalSetup のファイルを出さない", async (c) => {
    const paths = pathsOf(await generated(c));
    // 認証あり（#73）は、未認証のシナリオ（auth-session.spec.ts）が加わる。globalSetup のファイルは出さない
    expect(paths.filter((p) => p.startsWith("e2e/")).sort()).toEqual([
      ...(c.auth === "none" ? [] : ["e2e/auth-session.spec.ts"]),
      "e2e/console-guard.ts",
      "e2e/health.spec.ts",
      "e2e/sample-users.spec.ts",
      "e2e/seeds/health.sql",
    ]);
  });

  it.each(noDbCombos)("#64 AC-1: DB なし（%j）は、シードと DB のシナリオを出さない", async (c) => {
    const paths = pathsOf(await generated(c));
    expect(paths.filter((p) => p.startsWith("e2e/")).sort()).toEqual([
      "e2e/console-guard.ts",
      "e2e/health.spec.ts",
    ]);
    expect(paths).not.toContain("backend/db/seeds/cleanup.sql");
  });
});

describe("#64 AC-2: IaC のひな形（infra/）", () => {
  it.each(combos)("#64 AC-2: %j は infra/ の共通のファイルを出す", async (c) => {
    expect(pathsOf(await generated(c))).toEqual(expect.arrayContaining(INFRA_ALWAYS));
  });

  it.each(d1Combos)("#64 AC-2: D1（%j）だけ d1.tf を出す", async (c) => {
    const files = await generated(c);
    const d1 = contentOf(files, "infra/d1.tf");
    expect(d1).toContain('resource "cloudflare_d1_database"');
    expect(d1).toContain("${var.app_name}-db");
    expect(pathsOf(files)).not.toContain("infra/hyperdrive.tf");
  });

  it.each([...pgCombos, ...noDbCombos])(
    "#64 AC-2: D1 でない（%j）は d1.tf を出さない",
    async (c) => {
      expect(pathsOf(await generated(c))).not.toContain("infra/d1.tf");
    },
  );

  it.each(pgCombos)("#64 AC-2: PostgreSQL（%j）だけ hyperdrive.tf を出す", async (c) => {
    const hyper = contentOf(await generated(c), "infra/hyperdrive.tf");
    expect(hyper).toContain('resource "cloudflare_hyperdrive_config"');
    expect(hyper).toMatch(/password\s*=\s*var\./);
    for (const name of ["hyperdrive_host", "hyperdrive_user", "hyperdrive_password"]) {
      const block = variableBlock(hyper, name);
      expect(block, name).toMatch(/sensitive\s*=\s*true/);
      expect(block, name).not.toMatch(/default\s*=/);
    }
  });

  it.each([...d1Combos, ...noDbCombos])(
    "#64 AC-2: PostgreSQL でない（%j）は hyperdrive.tf を出さない",
    async (c) => {
      expect(pathsOf(await generated(c))).not.toContain("infra/hyperdrive.tf");
    },
  );

  it.each(uploadCombos)("#64 AC-2: アップロードあり（%j）は r2.tf を出す", async (c) => {
    const r2 = contentOf(await generated(c), "infra/r2.tf");
    expect(r2).toContain('resource "cloudflare_r2_bucket"');
    expect(r2).toContain("${var.app_name}-uploads");
  });

  it.each(noUploadCombos)("#64 AC-2: アップロードなし（%j）は r2.tf を出さない", async (c) => {
    expect(pathsOf(await generated(c))).not.toContain("infra/r2.tf");
  });

  it("#64 AC-2: r2.tf のバケット名は、wrangler.jsonc の bucket_name と同じ", async () => {
    const c = uploadCombos[0] as Combo;
    const files = await generated(c);
    const wrangler = contentOf(files, "wrangler.jsonc");
    expect(wrangler).toContain("testapp-001-uploads");
  });

  it("#64 C-62: versions.tf のプロバイダーの版は、data の版と一致し、= で固定する", async () => {
    const version = runtimes.terraform_cloudflare_provider;
    expect(version).toMatch(/^5\.\d+\.\d+$/);
    for (const c of [d1Combos[0], pgCombos[0], noDbCombos[0]] as Combo[]) {
      const versions = contentOf(await generated(c), "infra/versions.tf");
      expect(versions).toContain('source  = "cloudflare/cloudflare"');
      expect(versions).toContain(`version = "= ${version as string}"`);
      expect(versions).toContain("required_version");
      expect(versions).not.toMatch(/~>|>= *5/);
      expect(versions).not.toMatch(/\{\{/);
    }
  });

  it("#64 C-62: data/runtimes.yaml に、確かめた日と Terraform の版を書いている", () => {
    const text = readFileSync(path.join(repoRoot, "data", "runtimes.yaml"), "utf8");
    expect(text).toMatch(/terraform init -backend=false/);
    expect(text).toMatch(/terraform validate/);
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}.*cloudflare/is);
    expect(runtimes.terraform_version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(combos)(
    "#64 C-40: %j の variables.tf は account_id を sensitive・既定なしにする",
    async (c) => {
      const vars = contentOf(await generated(c), "infra/variables.tf");
      const account = variableBlock(vars, "account_id");
      expect(account).toMatch(/sensitive\s*=\s*true/);
      expect(account).not.toMatch(/default\s*=/);
      const environment = variableBlock(vars, "environment");
      expect(environment).toMatch(/default\s*=\s*"production"/);
      expect(environment).toContain("validation");
      expect(environment).toContain('var.environment == "production"');
      expect(variableBlock(vars, "app_name")).toContain('default     = "testapp-001"');
    },
  );

  it.each(combos)("#64 C-05: %j の infra/ に、秘密情報らしい値を書かない", async (c) => {
    const files = (await generated(c)).filter((f) => f.path.startsWith("infra/"));
    for (const f of files) {
      expect(f.content, f.path).not.toMatch(/\b[0-9a-f]{32}\b/);
      expect(f.content, f.path).not.toMatch(/(token|secret|password)\s*=\s*"[^"$\n]+"/i);
      expect(f.content, f.path).not.toMatch(/postgres(ql)?:\/\/[^\s:]+:[^\s@]+@/);
    }
  });

  it.each(combos)("#64 C-39: %j の infra/README.md に手順と役割の分け方を書く", async (c) => {
    const readme = contentOf(await generated(c), "infra/README.md");
    expect(readme).toContain("CLOUDFLARE_API_TOKEN");
    expect(readme).toContain("terraform -chdir=infra init");
    expect(readme).toContain("terraform -chdir=infra plan");
    expect(readme).toContain("terraform -chdir=infra apply");
    expect(readme).toContain("承認");
    expect(readme).toContain("wrangler");
    expect(readme).toContain("DNS");
    expect(readme).toContain("providers lock");
    expect(readme).toContain("状態");
    expect(readme).toContain("production");
  });

  it.each(combos)(
    "#64 C-39: %j の .gitignore は Terraform の状態を除き、lock は除かない",
    async (c) => {
      const ignore = contentOf(await generated(c), ".gitignore").split("\n");
      for (const entry of [
        ".terraform/",
        "*.tfstate",
        "*.tfstate.*",
        "*.tfvars",
        "crash.log",
        "*.tfplan",
      ]) {
        expect(ignore, entry).toContain(entry);
      }
      expect(ignore).not.toContain(".terraform.lock.hcl");
      expect(contentOf(await generated(c), ".prettierignore").split("\n")).toContain(".terraform");
    },
  );

  it.each(combos)(
    "#64 C-05: %j の docs/secrets.md の Terraform の節に項目を書き、.env.example には入れない",
    async (c) => {
      const files = await generated(c);
      const secrets = contentOf(files, "docs/secrets.md");
      const section = secrets.slice(secrets.indexOf("## Terraform"));
      expect(section).toContain("CLOUDFLARE_API_TOKEN");
      expect(section).toContain("TF_VAR_account_id");
      expect(contentOf(files, ".env.example")).not.toContain("CLOUDFLARE_API_TOKEN");
      expect(contentOf(files, ".env.example")).not.toContain("TF_VAR_");
    },
  );

  it("#64 C-62: docs/tech-stack.md に Terraform と Cloudflare プロバイダーの版を載せる", async () => {
    const files = await generated(combos[0] as Combo);
    const stack = contentOf(files, "docs/tech-stack.md");
    expect(stack).toContain("Terraform");
    expect(stack).toContain(runtimes.terraform_cloudflare_provider as string);
  });

  it("#64: 生成のたびに同じ結果になる", async () => {
    const a = buildProject(await projectInput()).files;
    const b = buildProject(await projectInput()).files;
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// scripts/（run-local.ts・db-local.ts）
// ---------------------------------------------------------------------------

const folders: string[] = [];
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harness-e2e64-test-"));
  folders.push(dir);
  writeFileSync(
    path.join(dir, ".env.test"),
    "APP_ENV=test\nALLOWED_ORIGINS=http://localhost:5173\n",
  );
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "example-app" }));
  return dir;
}

function run(script: string, dir: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [path.join(repoRoot, "templates", "scripts", script), ...args],
    {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env },
    },
  );
}

function fakePackage(dir: string, name: string, bin: string | Record<string, string>, out: string) {
  const target = path.join(dir, "node_modules", ...name.split("/"));
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, "package.json"), JSON.stringify({ name, bin, type: "module" }));
  const file = typeof bin === "string" ? bin : Object.values(bin)[0];
  writeFileSync(
    path.join(target, file as string),
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(out)}, JSON.stringify({ args: process.argv.slice(2), appEnv: process.env.APP_ENV }));`,
  );
}

describe("#64 R1: run-local.ts は playwright を起動できる", () => {
  it("道具名 playwright は、パッケージ @playwright/test の bin から起動し、APP_ENV=test を渡す", () => {
    const dir = workDir();
    fakePackage(dir, "@playwright/test", { playwright: "cli.js" }, "playwright-run.json");
    const result = run("run-local.ts", dir, ["test", "playwright", "test"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, "playwright-run.json"), "utf8"))).toEqual({
      args: ["test"],
      appEnv: "test",
    });
  });

  it("許可していない道具は、起動前に拒否する", () => {
    const dir = workDir();
    const result = run("run-local.ts", dir, ["test", "terraform", "apply"]);
    expect(result.status).toBe(1);
  });

  it("--remote は playwright でも拒否する", () => {
    const dir = workDir();
    fakePackage(dir, "@playwright/test", { playwright: "cli.js" }, "playwright-run.json");
    const result = run("run-local.ts", dir, ["test", "playwright", "test", "--remote"]);
    expect(result.status).toBe(1);
  });
});

describe("#64 R4: db-local.ts の seed-file は e2e/seeds/ の下の SQL だけを流す", () => {
  it("D1：e2e/seeds/health.sql を、検証環境の保存先へ流す", () => {
    const dir = workDir();
    fakePackage(dir, "wrangler", "cli.js", "wrangler-args.json");
    const result = run("db-local.ts", dir, ["test", "seed-file", "e2e/seeds/health.sql"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, "wrangler-args.json"), "utf8")).args).toEqual([
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      ".wrangler/state/test",
      "--file",
      "e2e/seeds/health.sql",
    ]);
  });

  it.each([
    ["../outside.sql"],
    ["e2e/seeds/../../outside.sql"],
    ["backend/db/seeds/seed.sql"],
    ["/etc/seed.sql"],
    ["C:/seed.sql"],
    ["e2e/seeds/health.txt"],
    ["e2e/seeds/health.sql", "extra"],
    [],
  ])("不許可の指定 %j は、道具を起動する前に拒否する", (...args) => {
    const dir = workDir();
    fakePackage(dir, "wrangler", "cli.js", "wrangler-args.json");
    const result = run("db-local.ts", dir, ["test", "seed-file", ...args]);
    expect(result.status).toBe(1);
    expect(() => readFileSync(path.join(dir, "wrangler-args.json"), "utf8")).toThrow();
  });

  it("seed-file 以外の操作に、追加の引数は付けられない（従来どおり）", () => {
    const dir = workDir();
    fakePackage(dir, "wrangler", "cli.js", "wrangler-args.json");
    const result = run("db-local.ts", dir, ["test", "migrate", "e2e/seeds/health.sql"]);
    expect(result.status).toBe(1);
  });
});
