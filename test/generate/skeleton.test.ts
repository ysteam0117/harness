// #56 動くアプリの土台：生成するプロジェクトの内容（メモリ上の buildProject の結果）のテスト
//
// 計画（plan-56.md）の「2. 生成するプロジェクトの構成」「4. テストケース」と、計画レビューの R1〜R10 をテストにしたもの。
// npm install・開発サーバーの起動・docker は、ここでは行わない（scripts/smoke-generated.ts が CI で行う）。
//
// 想定する仕様（実装の役割はこの形に合わせる）
//   出るファイル（組み合わせ：認証 none・app・oidc・both × DB d1・postgresql・none × アップロードあり・なし のうち有効なもの。
//   無効な組み合わせ「DB なし＋独自認証」「DB なし＋アップロード」は整合性チェックのエラー）
//     常に：tsconfig.json・index.html・wrangler.jsonc・docker-compose.yml・.env.example・.gitignore・README.md・
//           vite.config.ts・vitest.config.ts・backend/src/{index,app}.ts・backend/src/routes/health{,.test}.ts・
//           backend/src/services/health.service.ts・frontend/src/{main,App}.tsx・frontend/src/pages/HomePage.tsx・
//           frontend/src/features/health/api/health.ts・frontend/src/features/health/HealthStatus{,.test}.tsx・
//           frontend/src/test/setup.ts
//     DB ありのとき：drizzle.config.ts・backend/db/schema.ts・backend/db/migrations/0000_init.sql・
//           backend/db/migrations/meta/_journal.json・backend/db/migrations/meta/0000_snapshot.json・
//           backend/db/seeds/seed.sql・backend/db/seeds/cleanup.sql（testuser_ の行だけを消す）・backend/src/db/ の下に Repository の層
//     D1 のときだけ：backend/test/apply-migrations.ts
//   wrangler.jsonc：先頭の「//」の行（説明）以外は JSON。d1_databases（binding "DB"・migrations_dir "backend/db/migrations"）は D1、
//     hyperdrive（binding "HYPERDRIVE"・接続文字列は書かない）は PostgreSQL、r2_buckets（binding "UPLOADS"）はアップロードありのとき
//   docker-compose.yml：name はアプリ名。コンテナ名は <アプリ名>-backend（PostgreSQL のときだけ <アプリ名>-db も）。
//     認証情報は ${VAR} で .env から読み、直接書かない。使う ${VAR} はすべて .env.example にある
//   .env.example：APP_ENV・ALLOWED_ORIGINS。PostgreSQL は DATABASE_URL と CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE。
//     認証あり（none 以外）は SESSION_SECRET、oidc・both は OIDC_CLIENT_ID・OIDC_CLIENT_SECRET。値は空かプレースホルダ（changeme…）
//   package.json の scripts：dev・build・preview・test（vitest run）・check・types（wrangler types）・env:check・
//     predev・pretest・pretypecheck（npm run types を先に実行）。DB ありのとき db:generate・db:seed:local・db:reset:local・db:cleanup。
//     D1 は db:migrate:local（wrangler d1 migrations apply --local）、PostgreSQL は db:migrate（drizzle-kit migrate）
//   devDependencies に @types/react・@types/react-dom（正確な版）
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules, loadRules, type Facts } from "../../src/checks/rules.js";
import { buildProject } from "../../src/generate/project.js";
import { baseAnswers } from "../questions/helpers.js";
import { LEFTOVER_NAME } from "./helpers.js";
import { projectInput } from "./project-helpers.js";
import {
  APP_NAME,
  composeVariables,
  contentOf,
  generated,
  parseCompose,
  parseEnvExample,
  parseWranglerJsonc,
  pathsOf,
  validCombos,
  type Combo,
} from "./skeleton-helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const combos = validCombos();
const hasDb = (c: Combo) => c.database !== "none";
const withAuth = (c: Combo) => c.auth !== "none";
const withOidc = (c: Combo) => c.auth === "oidc" || c.auth === "both";
const containerName = (role: "backend" | "db") =>
  `${APP_NAME}-${"${APP_ENV:-development}"}-${role}`;

const COMMON_FILES = [
  "tsconfig.json",
  "index.html",
  "wrangler.jsonc",
  "docker-compose.yml",
  ".env.example",
  ".gitignore",
  "README.md",
  "vite.config.ts",
  "vitest.config.ts",
  "package.json",
  "backend/src/index.ts",
  "backend/src/app.ts",
  "backend/src/routes/health.ts",
  "backend/src/routes/health.test.ts",
  "backend/src/services/health.service.ts",
  "frontend/src/main.tsx",
  "frontend/src/App.tsx",
  "frontend/src/pages/HomePage.tsx",
  "frontend/src/features/health/api/health.ts",
  "frontend/src/features/health/HealthStatus.tsx",
  "frontend/src/features/health/HealthStatus.test.tsx",
  "frontend/src/test/setup.ts",
];

const DB_FILES = [
  "drizzle.config.ts",
  "backend/db/schema.ts",
  "backend/db/migrations/0000_init.sql",
  "backend/db/migrations/meta/_journal.json",
  "backend/db/migrations/meta/0000_snapshot.json",
  "backend/db/seeds/seed.sql",
  "backend/db/seeds/cleanup.sql",
];

describe("#56 AC-3: 組み合わせ（認証 × DB × アップロード）は、有効なものだけを対象にする", () => {
  it("#56 AC-3: 有効な組み合わせは 18 通り（none 3・d1 8・postgresql 8 のうち DB なしは 2）", () => {
    expect(combos).toHaveLength(18);
    expect(combos.filter((c) => c.database === "none")).toHaveLength(2);
  });
});

describe("#56 R7: 無効な組み合わせは、整合性チェックでエラーになる", () => {
  const rules = loadRules();
  const facts: Facts = {
    versions_newer_than_verified: false,
    missing_tools: [],
    target_dir_not_empty: false,
    invalid_app_name: false,
  };
  const errorIds = (over: Record<string, unknown>) =>
    evaluateRules(rules, baseAnswers(over), facts).errors.map((e) => e.id);

  it("#56 R7: DB なし＋独自認証（app・both）は auth-needs-db のエラー", () => {
    expect(errorIds({ database: "none", auth: "app" })).toContain("auth-needs-db");
    expect(errorIds({ database: "none", auth: "both" })).toContain("auth-needs-db");
  });

  it("#56 R7: DB なし＋アップロードは upload-needs-db のエラー", () => {
    expect(errorIds({ database: "none", auth: "none", file_upload: "yes" })).toContain(
      "upload-needs-db",
    );
  });

  it("#56 R7: DB なしでも、認証 none・oidc でアップロードなしならエラーにならない", () => {
    expect(errorIds({ database: "none", auth: "none" })).toEqual([]);
    expect(errorIds({ database: "none", auth: "oidc" })).toEqual([]);
  });

  it("#56 R7: 有効な 18 通りの組み合わせは、どれもエラーにならない", () => {
    for (const c of combos) {
      const over = {
        database: c.database,
        auth: c.auth,
        file_upload: c.upload ? "yes" : "no",
      };
      expect(errorIds(over), c.label).toEqual([]);
    }
  });
});

describe.each(combos)("#56 AC-3: 生成の結果（$label）", (c) => {
  it("#56 AC-3: 常に出るファイル・DB ありのときのファイル・D1 のときだけのファイルが、回答のとおりに出る", async () => {
    const paths = pathsOf(await generated(c));
    for (const p of COMMON_FILES) expect(paths, p).toContain(p);
    for (const p of DB_FILES) {
      if (hasDb(c)) expect(paths, p).toContain(p);
      else expect(paths, p).not.toContain(p);
    }
    if (hasDb(c)) expect(paths.some((p) => p.startsWith("backend/src/db/"))).toBe(true);
    else expect(paths.some((p) => p.startsWith("backend/src/db/"))).toBe(false);
    if (c.database === "d1") expect(paths).toContain("backend/test/apply-migrations.ts");
    else expect(paths).not.toContain("backend/test/apply-migrations.ts");
  });

  it("#56 AC-3: 新しいファイルはプロジェクトのもの（ハーネスが管理するファイルではない）", async () => {
    const files = await generated(c);
    for (const p of [...COMMON_FILES, ...(hasDb(c) ? DB_FILES : [])]) {
      expect(files.find((f) => f.path === p)?.managed, p).toBe(false);
    }
  });

  it("#56 AC-3: wrangler.jsonc の d1_databases・hyperdrive・r2_buckets の有無が回答のとおり", async () => {
    const w = parseWranglerJsonc(contentOf(await generated(c), "wrangler.jsonc"));
    expect(w["name"]).toBe(APP_NAME);
    expect(w["main"]).toBe("backend/src/index.ts");
    expect(w["assets"]).toMatchObject({
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*"],
    });
    if (c.database === "d1") {
      const d1 = w["d1_databases"] as { binding: string; migrations_dir?: string }[];
      expect(d1).toHaveLength(1);
      expect(d1[0]?.binding).toBe("DB");
      expect(d1[0]?.migrations_dir).toBe("backend/db/migrations");
    } else {
      expect(w).not.toHaveProperty("d1_databases");
    }
    if (c.database === "postgresql") {
      const hd = w["hyperdrive"] as { binding: string }[];
      expect(hd).toHaveLength(1);
      expect(hd[0]?.binding).toBe("HYPERDRIVE");
    } else {
      expect(w).not.toHaveProperty("hyperdrive");
    }
    if (c.upload) {
      const r2 = w["r2_buckets"] as { binding: string }[];
      expect(r2).toHaveLength(1);
      expect(r2[0]?.binding).toBe("UPLOADS");
    } else {
      expect(w).not.toHaveProperty("r2_buckets");
    }
  });

  it("#56 R2: wrangler.jsonc に接続文字列を書かない（手元の接続は環境変数で渡す）", async () => {
    const text = contentOf(await generated(c), "wrangler.jsonc");
    expect(text).not.toMatch(/localConnectionString|postgres(ql)?:\/\//i);
    expect(text).not.toMatch(/\{\{/);
  });

  it("#56 AC-3: docker-compose.yml の name・コンテナ名（C-36）と、db のコンテナの有無", async () => {
    const compose = parseCompose(contentOf(await generated(c), "docker-compose.yml"));
    expect(compose.name).toBe(APP_NAME);
    const names = Object.values(compose.services).map((s) => s.container_name);
    if (c.database === "postgresql") {
      expect(names.sort()).toEqual([containerName("backend"), containerName("db")]);
    } else {
      expect(names).toEqual([containerName("backend")]);
    }
  });

  it("#56 AC-3: .env.example の項目が回答のとおり（APP_ENV・DB・認証・OIDC の出し分け）", async () => {
    const env = parseEnvExample(contentOf(await generated(c), ".env.example"));
    const names = Object.keys(env);
    expect(names).toContain("APP_ENV");
    expect(names).toContain("ALLOWED_ORIGINS");
    const pgNames = ["DATABASE_URL", "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"];
    for (const n of pgNames) {
      if (c.database === "postgresql") expect(names, n).toContain(n);
      else expect(names, n).not.toContain(n);
    }
    if (withAuth(c)) expect(names).toContain("SESSION_SECRET");
    else expect(names).not.toContain("SESSION_SECRET");
    for (const n of ["OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]) {
      if (withOidc(c)) expect(names, n).toContain(n);
      else expect(names, n).not.toContain(n);
    }
  });

  it("#56 AC-3: docker-compose.yml の ${VAR} は、すべて .env.example に項目がある（.env から読める）", async () => {
    const files = await generated(c);
    const env = parseEnvExample(contentOf(files, ".env.example"));
    for (const v of composeVariables(contentOf(files, "docker-compose.yml"))) {
      expect(Object.keys(env), `${v} が .env.example にありません`).toContain(v);
    }
  });

  it("#56 AC-3: vitest.config.ts は DB の回答で変わる（D1 だけ readD1Migrations）。frontend の setupFiles を登録する", async () => {
    const text = contentOf(await generated(c), "vitest.config.ts");
    if (c.database === "d1") expect(text).toContain("readD1Migrations");
    else expect(text).not.toContain("readD1Migrations");
    expect(text).toContain("frontend/src/test/setup.ts");
  });

  it("#56 AC-3: drizzle の設定とスキーマが DB の種類に合う", async () => {
    if (!hasDb(c)) return;
    const files = await generated(c);
    const config = contentOf(files, "drizzle.config.ts");
    const schema = contentOf(files, "backend/db/schema.ts");
    if (c.database === "d1") {
      expect(config).toMatch(/dialect:\s*["']sqlite["']/);
      expect(schema).toContain("drizzle-orm/sqlite-core");
    } else {
      expect(config).toMatch(/dialect:\s*["']postgresql["']/);
      expect(config).toContain("DATABASE_URL");
      expect(schema).toContain("drizzle-orm/pg-core");
    }
    expect(config).toContain("backend/db/migrations");
  });

  it("#56 R3: 最初のマイグレーション（SQL と meta の journal・snapshot）が JSON として読める", async () => {
    if (!hasDb(c)) return;
    const files = await generated(c);
    const journal = JSON.parse(contentOf(files, "backend/db/migrations/meta/_journal.json")) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.length).toBeGreaterThanOrEqual(1);
    expect(journal.entries[0]?.tag).toBe("0000_init");
    expect(() =>
      JSON.parse(contentOf(files, "backend/db/migrations/meta/0000_snapshot.json")),
    ).not.toThrow();
    expect(contentOf(files, "backend/db/migrations/0000_init.sql")).toMatch(/CREATE TABLE/i);
  });

  it("#56 R3: シードは架空のデータ（testuser_・example.com）で、後始末（cleanup.sql）は識別子だけで消す（C-05）", async () => {
    if (!hasDb(c)) return;
    const files = await generated(c);
    const seed = contentOf(files, "backend/db/seeds/seed.sql");
    const cleanup = contentOf(files, "backend/db/seeds/cleanup.sql");
    expect(seed).toContain("testuser_");
    for (const m of seed.matchAll(/[\w.+-]+@([\w-]+\.)+\w+/g)) {
      expect(m[0], "シードのメールアドレスは example.com 等だけ").toMatch(
        /@example\.(com|org|net)$/,
      );
    }
    expect(cleanup).toMatch(/DELETE FROM/i);
    expect(cleanup).toContain("testuser_");
  });

  it("#56 R1・R3: package.json の scripts（dev・build・preview・test・check・types・pre* と db:*）", async () => {
    const pkg = JSON.parse(contentOf(await generated(c), "package.json")) as {
      scripts: Record<string, string>;
    };
    const s = pkg.scripts;
    for (const name of ["dev", "build", "preview", "test", "check", "types", "env:check"]) {
      expect(s[name], name).toBeTypeOf("string");
    }
    expect(s["types"]).toContain("wrangler types");
    expect(s["test"]).toMatch(/scripts\/run-local\.ts test vitest run/);
    for (const name of ["predev", "pretest", "pretypecheck"]) {
      expect(s[name], name).toContain("npm run types");
    }
    const dbScripts = Object.keys(s).filter((k) => k.startsWith("db:"));
    if (!hasDb(c)) {
      expect(dbScripts).toEqual([]);
      return;
    }
    for (const name of ["db:generate", "db:seed:local", "db:reset:local", "db:cleanup"]) {
      expect(s[name], name).toBeTypeOf("string");
    }
    expect(s["db:generate"]).toMatch(/scripts\/db-local\.ts development generate/);
    if (c.database === "d1") {
      expect(s["db:migrate:local"]).toMatch(/scripts\/db-local\.ts development migrate/);
      expect(s).not.toHaveProperty("db:migrate");
    } else {
      expect(s["db:migrate"]).toMatch(/scripts\/db-local\.ts development migrate/);
      expect(s).not.toHaveProperty("db:migrate:local");
    }
  });

  it("#56 R1: @types/react・@types/react-dom を devDependencies に正確な版で入れる", async () => {
    const pkg = JSON.parse(contentOf(await generated(c), "package.json")) as {
      devDependencies: Record<string, string>;
      dependencies: Record<string, string>;
    };
    for (const name of ["@types/react", "@types/react-dom"]) {
      expect(pkg.devDependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(pkg.dependencies, name).not.toHaveProperty(name);
    }
  });

  it("#56 R1: .gitignore が、型のファイル・.env.* を除外し、.env.example は除外しない", async () => {
    const lines = contentOf(await generated(c), ".gitignore")
      .split("\n")
      .map((l) => l.trim());
    for (const p of ["node_modules", "dist", ".wrangler", "worker-configuration.d.ts"]) {
      expect(
        lines.some((l) => l === p || l === `${p}/` || l === `/${p}`),
        `${p} を除外していません`,
      ).toBe(true);
    }
    expect(lines.some((l) => l === ".env")).toBe(true);
    const star = lines.findIndex((l) => l === ".env.*" || l === ".env*");
    expect(star, ".env.* を除外していません").toBeGreaterThanOrEqual(0);
    const keep = lines.indexOf("!.env.example");
    expect(keep, "!.env.example がありません").toBeGreaterThan(star);
    expect(lines).not.toContain(".env.example");
  });

  it("#56 R1: tsconfig.json は strict で、wrangler types の型（worker-configuration.d.ts）を読む", async () => {
    const text = contentOf(await generated(c), "tsconfig.json")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    const ts = JSON.parse(text) as { compilerOptions: { strict: boolean } };
    expect(ts.compilerOptions.strict).toBe(true);
    expect(text).toContain("worker-configuration.d.ts");
  });

  it("#56 R1: ESLint は生成した型のファイル（worker-configuration.d.ts）を対象から外す", async () => {
    expect(contentOf(await generated(c), "eslint.config.mjs")).toContain(
      "worker-configuration.d.ts",
    );
  });

  it("#56 R2: pg を読み込むのは backend/src/db/ の下だけ（PostgreSQL 以外では、どこにも出ない）", async () => {
    const files = await generated(c);
    const importsPg = /from\s+["']pg["']|require\(\s*["']pg["']\s*\)|import\(\s*["']pg["']\s*\)/;
    for (const f of files) {
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(f.path)) continue;
      if (!importsPg.test(f.content)) continue;
      expect(c.database, `${f.path} が pg を読み込んでいます`).toBe("postgresql");
      expect(f.path.startsWith("backend/src/db/"), `${f.path} は Repository の層の外です`).toBe(
        true,
      );
    }
  });

  it("#56 R10・C-06・C-03: 層の依存の向き（pages は組み合わせだけ、services は Hono を知らない）", async () => {
    const files = await generated(c);
    const home = contentOf(files, "frontend/src/pages/HomePage.tsx");
    expect(home).toMatch(/features\/health/);
    expect(home).not.toMatch(/features\/[^/"']+\/api/);
    expect(home).not.toMatch(/axios|fetch\(/);
    const service = contentOf(files, "backend/src/services/health.service.ts");
    expect(service).not.toMatch(/from\s+["']hono/);
    expect(contentOf(files, "backend/src/routes/health.ts")).toMatch(/services\/health\.service/);
    const app = contentOf(files, "backend/src/app.ts");
    for (const word of ["securityHeaders", "originCheck", "onError"]) {
      expect(app, word).toContain(word);
    }
    expect(app + contentOf(files, "backend/src/routes/health.ts")).toContain("/api/health");
  });

  it("#56 R8・R10: dependency-cruiser の層の判定が、routes・services・db の名前に合い、pages から api・services を直接参照することを禁じる", async () => {
    const text = contentOf(await generated(c), ".dependency-cruiser.cjs");
    expect(text).not.toMatch(/controllers/);
    for (const word of ["routes", "services", "pages"]) expect(text, word).toContain(word);
    expect(text).toMatch(/features[^\n]*api/);
  });

  it("#56 AC-3: 生成したコードに {{名前}} の残りと「もとになった共通仕様」の印がない", async () => {
    for (const f of await generated(c)) {
      expect(f.content, f.path).not.toMatch(LEFTOVER_NAME);
      // GitHub Actions の式（${{ ... }}）は、ハーネスの差し込みの残りではないため除く（#63）
      expect(f.content.replace(/\$\{\{ [^}]+ \}\}/g, ""), f.path).not.toContain("{{");
      expect(f.content, f.path).not.toContain("もとになった共通仕様");
      expect(f.content, f.path).not.toContain("\r");
    }
  });
});

describe("#56 AC-3: docker-compose.yml の中身（C-36・R5）", () => {
  const pg = combos.find((c) => c.database === "postgresql" && c.auth === "oidc" && !c.upload);
  const d1 = combos.find((c) => c.database === "d1" && c.auth === "oidc" && !c.upload);

  it("#56 R5: backend は .node-version と同じ版の node の公式イメージで、npm run dev を動かし、0.0.0.0 で待ち受ける", async () => {
    const files = await generated(d1 as Combo);
    const node = contentOf(files, ".node-version").trim();
    const compose = parseCompose(contentOf(files, "docker-compose.yml"));
    const backend = Object.values(compose.services).find(
      (s) => s.container_name === containerName("backend"),
    );
    expect(backend?.image).toMatch(/^node:/);
    expect(backend?.image).toContain(node);
    expect(backend?.image).not.toMatch(/latest/);
    const command = Array.isArray(backend?.command) ? backend.command.join(" ") : backend?.command;
    expect(command).toContain("npm run dev");
    expect(JSON.stringify(backend)).toContain("0.0.0.0");
  });

  it("#56 R5: node_modules はコンテナの中のボリューム、.wrangler/state はボリュームで保つ", async () => {
    const compose = parseCompose(contentOf(await generated(d1 as Combo), "docker-compose.yml"));
    const backend = Object.values(compose.services).find(
      (s) => s.container_name === containerName("backend"),
    );
    const volumes = (backend?.volumes ?? []).map(String);
    expect(volumes.some((v) => v.includes("node_modules"))).toBe(true);
    expect(volumes.some((v) => v.includes(".wrangler"))).toBe(true);
    const nodeModules = volumes.find((v) => v.includes("node_modules")) ?? "";
    expect(
      nodeModules.startsWith("./") || nodeModules.startsWith("."),
      "Windows の手元の node_modules と分ける",
    ).toBe(false);
  });

  it("#56 R5: PostgreSQL のとき、db のイメージは版を固定し、ヘルスチェックを持ち、backend は db が健全になるのを待つ", async () => {
    const compose = parseCompose(contentOf(await generated(pg as Combo), "docker-compose.yml"));
    const entries = Object.entries(compose.services);
    const db = entries.find(([, s]) => s.container_name === containerName("db"));
    const backend = entries.find(([, s]) => s.container_name === containerName("backend"));
    expect(db?.[1].image).toMatch(/^postgres:\d/);
    expect(db?.[1].image).not.toMatch(/latest/);
    expect(db?.[1].healthcheck).toBeTruthy();
    const depends = backend?.[1].depends_on as Record<string, { condition?: string }>;
    expect(depends[db?.[0] as string]?.condition).toBe("service_healthy");
  });

  it("#51 AC-2: PostgreSQL の Docker backend は選択した環境を受け取り、接続先は検証済み設定から決める", async () => {
    const compose = parseCompose(contentOf(await generated(pg as Combo), "docker-compose.yml"));
    const entries = Object.entries(compose.services);
    const backend = entries.find(([, s]) => s.container_name === containerName("backend"))?.[1];
    const env = backend?.environment;
    const text = Array.isArray(env) ? env.join("\n") : JSON.stringify(env ?? {});
    expect(text).toContain("APP_ENV");
    expect(text).not.toContain("DATABASE_URL");
    expect(text).not.toContain("CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE");
    expect(contentOf(await generated(pg as Combo), "scripts/local-env.ts")).toMatch(
      /hostname\s*=.*["']db["']/,
    );
  });

  for (const c of combos) {
    it(`#56 AC-3: 認証情報を直接書かず \${...} で .env から読む（${c.label}）`, async () => {
      const text = contentOf(await generated(c), "docker-compose.yml");
      expect(text).not.toMatch(/:\/\/[^\s:@/$]+:[^\s@$]+@/);
      const compose = parseCompose(text);
      for (const s of Object.values(compose.services)) {
        const env = s.environment ?? {};
        const pairs: [string, string][] = Array.isArray(env)
          ? env.map((e) => [e.split("=")[0] as string, e.slice(e.indexOf("=") + 1)])
          : Object.entries(env).map(([k, v]) => [k, String(v ?? "")]);
        for (const [name, value] of pairs) {
          if (/PASSWORD|SECRET|TOKEN|KEY|URL|CONNECTION|USER/.test(name)) {
            expect(value, `${name} は \${...} で .env から読んでください`).toContain("${");
          }
        }
      }
    });
  }
});

describe("#56 AC-3: .env.example は実在しうる値を書かない（C-05・秘密情報の標準）", () => {
  for (const c of combos) {
    it(`#56 AC-3: 秘密・接続先の項目の値は空かプレースホルダだけ（${c.label}）`, async () => {
      const files = await generated(c);
      const env = parseEnvExample(contentOf(files, ".env.example"));
      for (const [name, value] of Object.entries(env)) {
        if (/SECRET|PASSWORD|TOKEN|KEY|URL|CONNECTION|USER|CLIENT_ID/.test(name)) {
          expect(
            value === "" || /^changeme/.test(value) || /^<[^>]+>$/.test(value),
            `${name} の値が空でもプレースホルダでもありません`,
          ).toBe(true);
        }
        expect(value, name).not.toMatch(/^(root|password|admin|postgres)$/i);
      }
    });

    it(`#56 AC-3: 新しいファイルに実在しうるメールアドレス・ドメインがない（${c.label}）`, async () => {
      const targets = (await generated(c)).filter(
        (f) =>
          f.path.startsWith("backend/") ||
          f.path.startsWith("frontend/") ||
          [
            ".env.example",
            "docker-compose.yml",
            "wrangler.jsonc",
            "README.md",
            "drizzle.config.ts",
          ].includes(f.path),
      );
      for (const f of targets) {
        for (const m of f.content.matchAll(/[\w.+-]+@([\w-]+\.)+[A-Za-z]{2,}/g)) {
          expect(m[0], `${f.path} のメールアドレス`).toMatch(/@example\.(com|org|net)$/);
        }
        expect(f.content, f.path).not.toMatch(/gmail\.com|yahoo\.co\.jp|outlook\.com/);
      }
    });
  }
});

describe("#56 AC-1・AC-2: README の最初の手順と、動かすための設定", () => {
  const c = combos.find((x) => x.database === "d1" && x.auth === "oidc" && !x.upload) as Combo;

  it("#56 AC-1・#51 AC-2: README に、開発・テストの環境ファイルと Docker wrapper を使う手順がある", async () => {
    const text = contentOf(await generated(c), "README.md");
    for (const word of [
      "npm install",
      ".env.example",
      ".env.development",
      "APP_ENV=development",
      ".env.test",
      "npm run dev",
      "npm run docker:up:local",
      "npm run docker:up:test",
      "npm run check",
    ]) {
      expect(text, word).toContain(word);
    }
    expect(text).toContain(APP_NAME);
  });

  it("#56 AC-2: npm run check は品質チェックとテストを含む（lint・typecheck・test）", async () => {
    const pkg = JSON.parse(contentOf(await generated(c), "package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check"]).toContain("lint");
    expect(pkg.scripts["check"]).toContain("typecheck");
    expect(pkg.scripts["check"]).toMatch(/npm (run )?test/);
  });

  it("#56 AC-1: index.html は Vite の入口（frontend/src/main.tsx を読む）で、vite.config.ts は Cloudflare の部品を使う", async () => {
    const files = await generated(c);
    expect(contentOf(files, "index.html")).toContain("/frontend/src/main.tsx");
    expect(contentOf(files, "vite.config.ts")).toContain("@cloudflare/vite-plugin");
  });

  it("#56 R9: 同じ入力なら、生成の結果は何度やっても同じ", async () => {
    const input = await projectInput({ database: "d1" });
    expect(JSON.stringify(buildProject(input).files)).toBe(
      JSON.stringify(buildProject(input).files),
    );
  });
});

describe("#56 R5: 共通仕様 C-36 の書き直し", () => {
  it("#56 R5: C-36 の「実行環境」が、wrangler dev、または Cloudflare の Vite の部品の開発サーバー、と書かれている", () => {
    const text = readFileSync(
      path.join(repoRoot, "docs/requirements/common/project-env.md"),
      "utf8",
    );
    const start = text.indexOf("## C-36");
    const end = text.indexOf('<a id="c-39"', start);
    const section = text.slice(start, end === -1 ? undefined : end);
    expect(section).toMatch(/Vite/);
    expect(section).toContain("wrangler dev");
  });
});
