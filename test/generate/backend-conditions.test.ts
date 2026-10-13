// #40：Hono（Workers）のためのファイル・設定を、backend が hono のときだけ出す。
// spring_boot の選択肢はまだ無い（Spring Boot のプロファイルを入れる PR で開く）ので、ここでは回答を直接書き換えて、条件の働きだけを確かめる。
// Hono の生成結果が変わらないことは、既存のスナップショット（project.test.ts）・auth-none-baseline・hono-baseline が守る。
import type { Answers } from "../../src/questions/answers.js";
import { afterEach, describe, expect, it } from "vitest";
import { buildProject, type ProjectFile } from "../../src/generate/project.js";
import { selectProfiles } from "../../src/versions/profile-selection.js";
import {
  contentOf,
  cleanupProjectTmp,
  completeAnswers,
  pathsOf,
  surveyVersions,
} from "./project-helpers.js";
import { FIXED_NOW } from "../versions/helpers.js";

afterEach(cleanupProjectTmp);

async function generate(over: Record<string, unknown>): Promise<ProjectFile[]> {
  // 質問の流れは backend を hono に決めるため、別の値は、回答ができた後で書き換える
  const { backend, infra, ...rest } = over;
  const answers = {
    ...(await completeAnswers(rest)),
    ...(backend ? { backend } : {}),
    ...(infra ? { infra } : {}),
  } as Answers;
  return buildProject({
    answers,
    acceptedWarnings: [],
    versions: await surveyVersions(answers),
    now: FIXED_NOW,
  }).files;
}

const HONO_ONLY_FILES = [
  "backend/src/app.ts",
  "backend/src/config.ts",
  "backend/src/index.ts",
  "backend/src/openapi.test.ts",
  "backend/src/routes/health.ts",
  "backend/src/services/health.service.ts",
  "docs/api/openapi.json",
  "wrangler.jsonc",
  "scripts/db-local.ts",
  "docker-compose.yml",
  "vite.config.ts",
  "tsconfig.json",
  "vitest.config.ts",
  "playwright.config.ts",
  "public/_headers",
  "e2e/health.spec.ts",
  "infra/versions.tf",
  "infra/d1.tf",
];

describe("#40: backend が hono のときは、Hono のためのファイルを出す", () => {
  it("DB なし・d1・postgresql のどれでも、Hono の土台・wrangler.jsonc・OpenAPI・Docker の開発環境・フロントの設定が出る", async () => {
    for (const over of [
      { database: "none", auth: "none", idp: undefined },
      { database: "d1" },
      { database: "postgresql", postgres_provider: "neon" },
    ]) {
      const paths = pathsOf(await generate(over));
      for (const p of [
        "backend/src/app.ts",
        "backend/src/index.ts",
        "docs/api/openapi.json",
        "wrangler.jsonc",
        "docker-compose.yml",
        "vite.config.ts",
        "tsconfig.json",
        "playwright.config.ts",
        "public/_headers",
        "infra/versions.tf",
      ]) {
        expect(paths, `${JSON.stringify(over)}：${p}`).toContain(p);
      }
    }
  });

  it("package.json に、Hono の構成の scripts（types・docker:*・pretest）が入る", async () => {
    const pkg = JSON.parse(contentOf(await generate({ database: "d1" }), "package.json")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    for (const name of ["dev", "types", "predev", "docker:up:local", "pretypecheck", "pretest"]) {
      expect(pkg.scripts, name).toHaveProperty(name);
    }
    expect(pkg.devDependencies).toHaveProperty("@cloudflare/vite-plugin");
    expect(pkg.devDependencies).toHaveProperty("@cloudflare/vitest-pool-workers");
  });
});

describe("#40: backend が hono でないときは、Hono のためのファイル・設定を出さない（条件の働き）", () => {
  const SPRING = {
    backend: "spring_boot",
    infra: "container",
    database: "none",
    auth: "none",
    idp: undefined,
  };

  it("backend=hono の条件のプロファイル（hono・structured-logger・drizzle・auth）を選ばない", async () => {
    // DB あり・認証ありでも、drizzle・auth/* は backend=hono のときだけ
    const answers = {
      ...(await completeAnswers({ database: "d1", auth: "app", idp: undefined })),
      backend: "spring_boot",
      infra: "container",
    } as unknown as Answers;
    const keys = selectProfiles(answers);
    expect(keys).not.toContain("backend-framework/hono");
    expect(keys).not.toContain("logger/structured-logger");
    expect(keys).not.toContain("data-access/drizzle");
    expect(keys.filter((k) => k.startsWith("auth/"))).toEqual([]);
    expect(keys).toContain("frontend-build/vite-react-router");
    expect(selectProfiles({ ...answers, backend: "hono" } as Answers)).toEqual(
      expect.arrayContaining(["backend-framework/hono", "data-access/drizzle", "auth/session"]),
    );
  });

  it("Hono の土台・wrangler.jsonc・OpenAPI・Docker の開発環境・Hono の設定ファイル・infra/ を出さない", async () => {
    const paths = pathsOf(await generate(SPRING));
    for (const p of HONO_ONLY_FILES) expect(paths, p).not.toContain(p);
    expect(paths.filter((p) => p.startsWith("infra/") || p.startsWith("backend/src/"))).toEqual([]);
    expect(paths.filter((p) => /^docker-compose/.test(p))).toEqual([]);
  });

  it("package.json に、wrangler・Cloudflare の部品・Hono の構成の scripts が入らない", async () => {
    const pkg = JSON.parse(contentOf(await generate(SPRING), "package.json")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(
      names.filter((n) => n.startsWith("@cloudflare/") || n === "wrangler" || n === "hono"),
    ).toEqual([]);
    const scripts = Object.keys(pkg.scripts ?? {});
    expect(scripts.filter((s) => /^docker:|^types|^pretypecheck$|^dev$|^pretest/.test(s))).toEqual(
      [],
    );
  });
});
