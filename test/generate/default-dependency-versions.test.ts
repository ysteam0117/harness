import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { buildProject } from "../../src/generate/project.js";
import { cleanupProjectTmp, contentOf, projectInput } from "./project-helpers.js";

afterAll(cleanupProjectTmp);

const scenarios = [
  {
    name: "GitHub Actions のみ",
    answers: { repository: "github", check_location: "github_actions" },
  },
  { name: "手元のみ", answers: { repository: "github", check_location: "local" } },
  { name: "両方", answers: { repository: "github", check_location: "both" } },
  {
    name: "ローカル Git",
    answers: { repository: "local", check_location: "local", visibility: "private" },
  },
];

describe.each([
  { backend: "hono", infra: "cloudflare" },
  { backend: "spring_boot", infra: "container" },
])("F-16 F-19 #103 $backend", ({ backend, infra }) => {
  it.each(scenarios)("AC-1 AC-3: $name で検証済みの依存と監査手順が届く", async ({ answers }) => {
    const input = await projectInput({
      ...answers,
      backend,
      infra,
      database: "none",
      auth: "none",
      ais: ["claude", "codex"],
      version_policy: "verified",
    });
    const files = buildProject(input).files;
    const manifest = JSON.parse(contentOf(files, "package.json")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    const records = parse(contentOf(files, ".harness/config.yaml")) as {
      versions: { name: string; version: string; verified?: string }[];
      managed_files: Record<string, string>;
    };
    const stack = contentOf(files, "docs/tech-stack.md");
    const pins = Object.fromEntries(
      Object.entries(manifest.dependencies).filter(([name]) => name === "hono" || name === "zod"),
    );
    expect(pins).toEqual(backend === "hono" ? { hono: "4.13.23", zod: "4.6.7" } : { zod: "4.6.7" });
    for (const [name, version] of Object.entries(pins)) {
      expect(records.versions.filter((record) => record.name === name)).toMatchObject([
        { name, version, verified: version },
      ]);
      expect(stack).toContain(`| ${name} | ${version} |`);
    }
    if (backend === "spring_boot") {
      expect(records.versions.some((record) => record.name === "hono")).toBe(false);
      expect(stack).not.toContain("| hono |");
    }
    for (const file of ["package.json", ".harness/config.yaml", "docs/tech-stack.md"]) {
      expect(contentOf(files, file)).not.toMatch(/4\.13\.12|4\.6\.5/);
    }
    expect(records.managed_files).not.toHaveProperty(["package.json"]);
    expect(manifest.scripts["audit:prod"]).toBe("npm audit --omit=dev --audit-level=high");
    expect(manifest.scripts["check:app"]).toContain("npm test && npm run audit:prod");
  });
});

it("C-08 #103 AC-2: パッチ版の両マニフェストと変更履歴がそろう", () => {
  const bundled = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const changelog = bundled("CHANGELOG.md").replace(/\r\n/g, "\n");
  const current = changelog.match(/^## (\d+\.\d+\.\d+)$/m)?.[1];
  expect(current).toBeDefined();
  expect(JSON.parse(bundled("package.json"))).toMatchObject({ version: current });
  expect(JSON.parse(bundled("package-lock.json"))).toMatchObject({
    version: current,
    packages: { "": { version: current } },
  });
  const release = changelog.match(/^## 0\.7\.1\n([\s\S]*?)^## /m)?.[1] ?? "";
  expect(release).toContain("Hono 4.13.23");
  expect(release).toContain("Zod 4.6.7");
  expect(release).toContain("プロジェクト側で依存を更新する");
  expect(release).toContain("同じ系列の修正版");
});
