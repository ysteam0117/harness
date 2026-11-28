import { readFileSync } from "node:fs";
import { intersects } from "semver";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadProfile } from "../../src/generate/profile.js";
import { buildProject } from "../../src/generate/project.js";
import { realTemplatesDir } from "./helpers.js";
import { cleanupProjectTmp, contentOf, projectInput } from "./project-helpers.js";

afterAll(cleanupProjectTmp);

const dependabot = ".github/dependabot.yml";
const securityDoc = "docs/testing/security.md";
const oldComment = "本番の依存は、1つの PR にまとめる。開発用の依存は、別にまとめる";
const oldGithubGuide =
  "`.github/dependabot.yml` が、npm・GitHub Actions・Docker Compose の依存を、毎週確かめて、更新の PR を作る。npm の本番の依存は、1つの PR にまとめる。更新の PR は、品質チェックを通したうえで、固定したまま動作を確かめてから取り込む（C-62）。";
const localGuide =
  "GitHub を使わない（手元の Git だけの）ため、Dependabot は使わない。依存の更新は、定期的に `npm outdated` で確かめ、Issue にして、固定したまま動作を確かめてから取り込む（C-62）。";

const githubLocations = ["github_actions", "local", "both"];
const backends = [
  { backend: "hono", infra: "cloudflare" },
  { backend: "spring_boot", infra: "container" },
];

type UpdateEntry = {
  "package-ecosystem": string;
  directory: string;
  schedule: { interval: string };
  groups?: Record<string, unknown>;
  ignore?: unknown;
};

function readDependabot(text: string): { version: number; updates: UpdateEntry[] } {
  return parse(text) as { version: number; updates: UpdateEntry[] };
}

async function generated(answers: Record<string, unknown>) {
  return buildProject(
    await projectInput({ database: "none", auth: "none", ais: ["claude", "codex"], ...answers }),
  ).files;
}

describe.each(backends)("C-62 C-82 #105 $backend", ({ backend, infra }) => {
  it.each(githubLocations)(
    "C-62 C-82 #105 AC-1 AC-3: %s で専用グループと構成別の制限・案内が届く",
    async (check_location) => {
      const files = await generated({ backend, infra, repository: "github", check_location });
      const yaml = contentOf(files, dependabot);
      const settings = readDependabot(yaml);
      const npm = settings.updates[0];
      const guide = contentOf(files, securityDoc);
      expect(settings.version).toBe(2);
      expect(settings.updates.map((entry) => entry["package-ecosystem"])).toEqual([
        "npm",
        "github-actions",
        "docker-compose",
      ]);
      for (const entry of settings.updates) {
        expect(entry.directory).toBe("/");
        expect(entry.schedule).toEqual({ interval: "weekly" });
        if (entry["package-ecosystem"] !== "npm") {
          expect(entry).not.toHaveProperty("groups");
          expect(entry).not.toHaveProperty("ignore");
        }
      }
      expect(Object.keys(npm?.groups ?? {})).toEqual([
        "vitest-packages",
        "production-dependencies",
        "development-dependencies",
      ]);
      expect(npm?.groups).toEqual({
        "vitest-packages": {
          "applies-to": "version-updates",
          patterns: ["vitest", "@cloudflare/vitest-pool-workers"],
        },
        "production-dependencies": { "dependency-type": "production" },
        "development-dependencies": { "dependency-type": "development" },
      });
      expect(yaml).not.toContain("もとになった共通仕様");
      expect(yaml).not.toMatch(/#105\b/);
      expect(yaml).not.toContain("組み合わせの動作を確かめたら外す");
      expect(yaml).not.toContain(oldComment);
      expect(yaml).not.toContain("{{");
      expect(guide).not.toContain(oldGithubGuide);
      expect(guide).toContain("残りの npm の依存は本番用と開発用に分ける");
      expect(guide).toContain(
        "品質チェックを通したうえで、固定したまま動作を確かめてから取り込む（C-62）",
      );
      expect(guide).toContain("`vitest-packages`");

      if (backend === "hono") {
        expect(npm?.ignore).toEqual([
          { "dependency-name": "vitest", "update-types": ["version-update:semver-major"] },
        ]);
        expect(yaml).toContain(
          "Workers 用パッケージの Vitest 5 対応をハーネスが検証したら、harness update で制限が外れる。根拠は docs/tech-stack.md の「組み合わせの条件」を参照する。",
        );
        for (const phrase of [
          "Vitest のメジャー版の定期更新を止める",
          "4系のマイナー・パッチとセキュリティ更新は対象に残る",
          "`docs/tech-stack.md` の「組み合わせの条件」",
          "`harness update` で解除を反映する",
          "先に手で外すと、管理ファイルの編集として更新時に差分が出る",
          "peer 依存を確かめる",
          "4系に修正版があるかを確かめる",
          "影響範囲、開発用の依存であること、追跡先を Issue に記録する",
          "互換性のない更新 PR を閉じる",
          "互換性を確かめた組み合わせで別の更新を行う（C-62）",
        ]) {
          expect(guide).toContain(phrase);
        }
      } else {
        expect(npm).not.toHaveProperty("ignore");
        const comments = yaml
          .split("\n")
          .filter((line) => line.trimStart().startsWith("#"))
          .join("\n");
        expect(comments).not.toMatch(/pool-workers|Workers|ignore|メジャー/i);
        expect(guide).toContain("Vitest の定期更新は専用の");
        expect(guide).not.toMatch(/pool-workers|メジャー版の定期更新を止める/);
      }
    },
  );

  it("C-82 #105 AC-2: ローカル Git では Dependabot を生成せず手元の案内を維持する", async () => {
    const files = await generated({
      backend,
      infra,
      repository: "local",
      visibility: "private",
      check_location: "local",
    });
    expect(files.some(({ path }) => path === dependabot)).toBe(false);
    expect(contentOf(files, securityDoc)).toContain(localGuide);
  });
});

it("C-62 #105 AC-1 AC-3: Workers の peer の範囲が 5 未満の場合だけメジャー制限が出る", async () => {
  const profile = loadProfile(realTemplatesDir, "test-framework/vitest-playwright");
  const range = profile.versionRanges["vitest"];
  const cause = profile.rangeCauses["vitest"];
  const restrictedByWorkers =
    cause?.kind === "peer" &&
    cause.package === "@cloudflare/vitest-pool-workers" &&
    range !== undefined &&
    !intersects(range, ">=5.0.0", { includePrerelease: true });
  const npm = readDependabot(contentOf(await generated({ backend: "hono" }), dependabot))
    .updates[0];
  expect(npm?.ignore !== undefined).toBe(restrictedByWorkers);
});

it("C-08 C-62 F-27 #105 AC-3: 保守時の解除手順、版と既存の更新経路を記録する", () => {
  const repoFile = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const design = repoFile("docs/design/security-tools.md");
  for (const phrase of [
    "`vitest-packages`",
    "`harness status` などの範囲の見直し（`src/versions/range-review.ts`）",
    "`version_ranges` と `range_causes`",
    "ひな形の `ignore` を同じ変更で直す",
    "セキュリティ更新に適用しない",
  ]) {
    expect(design).toContain(phrase);
  }
  const changelog = repoFile("CHANGELOG.md");
  const current = changelog.match(/^## (\d+\.\d+\.\d+)$/m)?.[1];
  expect(current).toBeDefined();
  expect(JSON.parse(repoFile("package.json"))).toMatchObject({ version: current });
  expect(JSON.parse(repoFile("package-lock.json"))).toMatchObject({
    version: current,
    packages: { "": { version: current } },
  });
  const release = changelog.match(/^## 0\.8\.0\n([\s\S]*?)^## /m)?.[1] ?? "";
  for (const phrase of [
    "`vitest-packages`",
    "Vitest 5 に対応",
    "`harness update`",
    "`.harness-new`",
    "`docs/testing/security.md`",
    "手で反映",
    "0.7.1 は Hono・Zod の公開勧告に対応",
    "Hono 4.13.16・Zod 4.6.6",
  ]) {
    expect(release).toContain(phrase);
  }
});
