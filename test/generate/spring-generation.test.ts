// #40：Spring Boot の構成の生成物（backend=spring_boot、infra=container）。
// Hono の構成の生成結果が変わらないことは、project.test.ts のスナップショットと hono-baseline.test.ts が守る。
// Gradle の実行（./gradlew check）と、生成先の npm ci〜build は、ここでは行わない（手元で確かめて PR に記録する）。
import { afterEach, describe, expect, it } from "vitest";
import { evaluateRules, loadRules } from "../../src/checks/rules.js";
import { parseAnswersYaml } from "../../src/questions/answers.js";
import { questionDefinitions } from "../../src/questions/definitions.js";
import { findMissing } from "../../src/questions/flow.js";
import { fingerprint } from "../../src/generate/config.js";
import { buildProject, type ProjectFile } from "../../src/generate/project.js";
import { chooseVersions } from "../../src/versions/choose.js";
import { rangeTargetsFor } from "../../src/versions/range-review.js";
import { targetsFor } from "../../src/versions/targets.js";
import { FakePrompter } from "../questions/helpers.js";
import { FIXED_NOW } from "../versions/helpers.js";
import { fakeMaven, metadataXml } from "../versions/maven-helpers.js";
import { cleanupProjectTmp, contentOf, pathsOf, projectInput } from "./project-helpers.js";

afterEach(cleanupProjectTmp);

const SPRING = {
  backend: "spring_boot",
  infra: "container",
  auth: "none",
  idp: undefined,
};
const SPRING_DBS: Record<string, Record<string, unknown>> = {
  none: { database: "none" },
  postgresql: { database: "postgresql", postgres_provider: "neon" },
};

async function generate(over: Record<string, unknown> = {}): Promise<ProjectFile[]> {
  return buildProject(await projectInput({ ...SPRING, ...over })).files;
}

/** スナップショットに残す、Spring Boot の構成の主なファイル（中身を残す。Gradle の設定・画面の設定・package.json） */
const KEY_FILES = [
  "backend/build.gradle.kts",
  "backend/settings.gradle.kts",
  "backend/gradle/libs.versions.toml",
  "backend/src/main/java/com/example/testapp001/Application.java",
  "backend/src/main/java/com/example/testapp001/health/HealthController.java",
  "backend/src/main/resources/application.yaml",
  "backend/src/main/resources/logback-spring.xml",
  "backend/src/test/java/com/example/testapp001/PostgresContainerTest.java",
  "backend/src/test/java/com/example/testapp001/health/HealthControllerTest.java",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
];

describe.each(Object.keys(SPRING_DBS))("#40: Spring Boot の生成物（database=%s）", (db) => {
  const over = SPRING_DBS[db] ?? {};

  it("ファイルの一覧（管理する・しないの別）と指紋のスナップショット", async () => {
    const files = await generate(over);
    expect(
      files.map((f) => `${f.managed ? "M" : "P"} ${f.path} ${fingerprint(f.content)}`),
    ).toMatchSnapshot();
  });

  it("主なファイルの中身のスナップショット", async () => {
    const files = await generate(over);
    const picked = Object.fromEntries(KEY_FILES.map((p) => [p, contentOf(files, p)]));
    expect(picked).toMatchSnapshot();
  });

  it("Cloudflare・Hono・Docker の開発環境のファイルが出ない", async () => {
    const files = await generate(over);
    const paths = pathsOf(files);
    for (const p of [
      "wrangler.jsonc",
      "docs/api/openapi.json",
      "scripts/db-local.ts",
      "playwright.config.ts",
      "public/_headers",
      "backend/src/index.ts",
    ]) {
      expect(paths, p).not.toContain(p);
    }
    expect(paths.filter((p) => /^docker-compose.*\.ya?ml$/.test(p) || p === "Dockerfile")).toEqual(
      [],
    );
    expect(paths.filter((p) => p.startsWith("infra/") || p.startsWith("e2e/"))).toEqual([]);
  });

  it("GitHub Actions の check.yml が呼ぶ npm run は、すべて package.json の scripts にある（Compose の起動など Hono 専用のステップを含まない）", async () => {
    const files = await generate({ ...over, repository: "github", check_location: "both" });
    const workflow = contentOf(files, ".github/workflows/check.yml");
    const scripts = Object.keys(
      (JSON.parse(contentOf(files, "package.json")) as { scripts: Record<string, string> }).scripts,
    );
    const called = [...workflow.matchAll(/npm run ([\w:.-]+)/g)].map((m) => m[1] ?? "");
    expect(called.length).toBeGreaterThan(0);
    expect(called.filter((name) => !scripts.includes(name))).toEqual([]);
    expect(workflow).not.toContain("docker:up");
  });

  it("vite.config.ts に cloudflare が無く、/api を :8080 へ中継する", async () => {
    const vite = contentOf(await generate(over), "vite.config.ts");
    expect(vite).not.toContain("cloudflare");
    expect(vite).not.toContain("readWorkerConfig");
    expect(vite).toContain("http://localhost:8080");
  });

  it("tsconfig.json に vitest-pool-workers・worker-configuration.d.ts・backend が無い", async () => {
    const tsconfig = contentOf(await generate(over), "tsconfig.json");
    expect(tsconfig).not.toContain("vitest-pool-workers");
    expect(tsconfig).not.toContain("worker-configuration");
    expect(tsconfig).not.toContain('"backend"');
  });

  it("vitest.config.ts は画面（jsdom）だけで、cloudflare を読まない", async () => {
    const vitest = contentOf(await generate(over), "vitest.config.ts");
    expect(vitest).not.toContain("cloudflare");
    expect(vitest).toContain("jsdom");
    expect(vitest).not.toContain('"backend');
  });

  it("package.json に wrangler・@cloudflare/*・hono・@types/pg・Docker と型の生成の scripts が無い", async () => {
    const pkg = JSON.parse(contentOf(await generate(over), "package.json")) as {
      scripts: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      allowScripts?: Record<string, boolean>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(
      names.filter(
        (n) => n.startsWith("@cloudflare/") || ["wrangler", "hono", "@types/pg"].includes(n),
      ),
    ).toEqual([]);
    const scripts = Object.keys(pkg.scripts);
    expect(
      scripts.filter((s) =>
        /^docker:|^types|^pretypecheck$|^predev:test$|^dev:test$|^test:e2e$|^pretest:e2e$|^posttest$/.test(
          s,
        ),
      ),
    ).toEqual([]);
    expect(pkg.scripts["dev"]).toBe("node scripts/run-local.ts development vite");
    expect(pkg.scripts["build"]).toBe("vite build");
    expect(pkg.scripts["deps:check"]).toBe(
      "depcruise frontend/src --config .dependency-cruiser.cjs",
    );
    expect(pkg.scripts["dup:check"]).toBe("jscpd frontend/src");
    expect(pkg.allowScripts).not.toHaveProperty("workerd");
  });

  it("Gradle のファイル：プラグインは [plugins]、starter は版なしの [libraries]", async () => {
    const files = await generate(over);
    const catalog = contentOf(files, "backend/gradle/libs.versions.toml");
    expect(catalog).toContain(
      'spring-boot = { id = "org.springframework.boot", version.ref = "spring-boot" }',
    );
    expect(catalog).toContain(
      'spring-dependency-management = { id = "io.spring.dependency-management", version.ref = "spring-dependency-management" }',
    );
    expect(catalog).toContain(
      'spring-boot-starter-webmvc = { module = "org.springframework.boot:spring-boot-starter-webmvc" }',
    );
    expect(catalog).toContain(
      'spring-boot-starter-webmvc-test = { module = "org.springframework.boot:spring-boot-starter-webmvc-test" }',
    );
    expect(catalog).toContain(
      'testcontainers-postgresql = { module = "org.testcontainers:testcontainers-postgresql" }',
    );
    const build = contentOf(files, "backend/build.gradle.kts");
    expect(build).toContain("alias(libs.plugins.spring.boot)");
    expect(build).toContain("alias(libs.plugins.spring.dependency.management)");
    expect(build).toContain("testImplementation(libs.spring.boot.starter.webmvc.test)");
    expect(build).toContain('dependsOn("test")');
    expect(contentOf(files, "backend/settings.gradle.kts")).toContain("pluginManagement");
  });

  it("README.md は Spring Boot 用で、Docker の開発環境が今は無いことと起動の手順を書く", async () => {
    const readme = contentOf(await generate(over), "README.md");
    expect(readme).toContain("./gradlew bootRun");
    expect(readme).toContain("npm run dev");
    expect(readme).toContain("Gradle の使い方");
    expect(readme).toContain("まだ用意していません");
    expect(readme).not.toContain("wrangler");
    expect(readme).not.toContain("npm run docker:up");
  });

  it("docs/tech-stack.md に Terraform の節がなく、BOM が管理する依存の注記がある", async () => {
    const stack = contentOf(await generate(over), "docs/tech-stack.md");
    expect(stack).not.toContain("Terraform");
    expect(stack).toContain("BOM が管理する依存");
    expect(stack).toContain("org.springframework.boot:org.springframework.boot.gradle.plugin");
  });

  it("AGENTS.md の必読の表は、存在する Skill だけを案内する", async () => {
    const files = await generate({ ...over, ais: ["claude"] });
    const paths = pathsOf(files);
    const agents = contentOf(files, "AGENTS.md");
    expect(agents).toContain("backend-spring-boot");
    expect(agents).not.toContain("backend-hono");
    expect(agents).not.toContain("data-access-drizzle");
    for (const skill of ["backend-spring-boot", "build-gradle", "test-junit", "logger"]) {
      expect(paths).toContain(`.claude/skills/${skill}/SKILL.md`);
    }
  });
});

describe("#40: Java のパッケージ名と出力先（アプリ名から決まる）", () => {
  it.each([
    ["testapp-001", "com.example.testapp001", "com/example/testapp001"],
    ["123-app", "com.example._123app", "com/example/_123app"],
    ["class", "com.example.class_", "com/example/class_"],
  ])("アプリ名 %s → package %s", async (appName, pkg, dir) => {
    const files = await generate({ app_name: appName, database: "none" });
    const app = contentOf(files, `backend/src/main/java/${dir}/Application.java`);
    expect(app.split("\n")[0]).toBe(`package ${pkg};`);
    expect(contentOf(files, `backend/src/main/java/${dir}/health/HealthController.java`)).toContain(
      `package ${pkg}.health;`,
    );
    expect(contentOf(files, `backend/src/test/java/${dir}/ApplicationTests.java`)).toContain(
      `package ${pkg};`,
    );
    expect(contentOf(files, "backend/build.gradle.kts")).toContain(`group = "${pkg}"`);
    // Java のソースは、この階層以外に出ない
    expect(
      pathsOf(files).filter((p) => p.endsWith(".java") && !p.includes(`/java/${dir}/`)),
    ).toEqual([]);
  });
});

describe("#40: Spring Boot の版の調査", () => {
  const springAnswers = async (): Promise<Parameters<typeof targetsFor>[0]> =>
    (await projectInput({ ...SPRING, database: "none" })).answers;

  it("調べる対象は、2つのプラグインのマーカーと Java だけ（managed の starter・Cloudflare の2パッケージは対象外）", async () => {
    const targets = targetsFor(await springAnswers());
    const names = targets.map((t) => t.name);
    expect(names).toContain("org.springframework.boot:org.springframework.boot.gradle.plugin");
    expect(names).toContain(
      "io.spring.dependency-management:io.spring.dependency-management.gradle.plugin",
    );
    expect(names).toContain("java");
    expect(names.filter((n) => n.includes("starter") || n.includes("testcontainers"))).toEqual([]);
    expect(names.filter((n) => n.startsWith("@cloudflare/") || n === "wrangler")).toEqual([]);
    expect(targets.find((t) => t.name === "java")?.range).toBe(">=17 <27");
  });

  it("Hono の構成では、@cloudflare/vite-plugin・@cloudflare/vitest-pool-workers が対象に入る", async () => {
    const answers = (await projectInput({ database: "none", auth: "none", idp: undefined }))
      .answers;
    const names = targetsFor(answers).map((t) => t.name);
    expect(names).toContain("@cloudflare/vite-plugin");
    expect(names).toContain("@cloudflare/vitest-pool-workers");
  });

  it("最新の安定版を調べると、試験版（4.2.0-M2）は除かれ、検証済みより新しい版は fact が立つ", async () => {
    const targets = targetsFor(await springAnswers()).filter(
      (t) => t.kind === "maven" || t.kind === "java",
    );
    const fake = fakeMaven({
      maven: {
        "org.springframework.boot:org.springframework.boot.gradle.plugin": metadataXml(
          "org.springframework.boot",
          "org.springframework.boot.gradle.plugin",
          ["4.0.0", "4.1.1", "4.1.2", "4.2.0-M2"],
        ),
        "io.spring.dependency-management:io.spring.dependency-management.gradle.plugin":
          metadataXml(
            "io.spring.dependency-management",
            "io.spring.dependency-management.gradle.plugin",
            ["1.1.6", "1.1.7"],
          ),
      },
      java: { available_lts_releases: [17, 21, 25] },
    });
    const out = await chooseVersions({
      targets,
      policy: "latest",
      interactive: false,
      prompter: new FakePrompter({}),
      fetch: fake.fn,
      now: FIXED_NOW,
    });
    if (out.status !== "ok") throw new Error(out.message);
    const boot = out.result.entries.find((e) => e.name.startsWith("org.springframework.boot:"));
    expect(boot).toMatchObject({ version: "4.1.2", latestStable: "4.1.2", verified: "4.1.1" });
    expect(boot?.newerThanVerified).toBe(true);
    expect(out.result.newerThanVerified).toBe(true);
    expect(out.result.entries.find((e) => e.name.startsWith("io.spring"))?.version).toBe("1.1.7");
  });

  it("範囲の見直しは、原因のパッケージが対象にない範囲（vitest の範囲の原因 @cloudflare/vitest-pool-workers）を飛ばす", async () => {
    const spring = rangeTargetsFor(await springAnswers()).map((t) => t.name);
    expect(spring).not.toContain("vitest");
    expect(spring).toContain("typescript");
    const hono = (await projectInput({ database: "none", auth: "none", idp: undefined })).answers;
    expect(rangeTargetsFor(hono).map((t) => t.name)).toContain("vitest");
  });
});

describe("#40: Spring Boot の回答ファイルの例（database: none）", () => {
  // 手元の確認（harness create --answers <このファイル> --yes）に使える最小の回答。架空の値だけ
  const EXAMPLE = `app_name: testapp-001
ais: [claude]
repository: github
visibility: private
team_size: solo
backend: spring_boot
infra: container
database: none
check_location: both
version_policy: verified
`;

  it("足りない回答がなく、整合性チェックのエラーに当たらない", () => {
    const { answers } = parseAnswersYaml(EXAMPLE);
    expect(findMissing(questionDefinitions, answers)).toEqual([]);
  });

  it("buildProject で生成でき、Java のソースと Gradle のファイルが出る", async () => {
    const input = await projectInput({ ...SPRING, database: "none" });
    const hits = evaluateRules(loadRules(), input.answers, {
      versions_newer_than_verified: false,
      missing_tools: [],
      target_dir_not_empty: false,
      invalid_app_name: false,
    });
    expect(hits.errors).toEqual([]);
    expect(pathsOf(buildProject(input).files)).toContain("backend/build.gradle.kts");
  });
});
