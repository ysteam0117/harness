// 想定する型：src/versions/targets.ts（test/versions/helpers.ts の冒頭も参照）
//   buildTargets(profiles: Profile[], answers: Partial<Answers>): Target[]
//     - 先頭に Node.js（kind "node"・name "node"・verified は data/runtimes.yaml の node.verified）
//     - 続けて、選んだプロファイルの packages と、回答が when に合う packages_when のパッケージを、名前ごとに1つ（重複なし）
//     - 範囲：version_ranges（複数のプロファイルにあれば交わり。range は semver.satisfies で使える文字列）
//     - external_tools・optional_packages は含めない
//     - verified_versions がなく unverified でもないパッケージ、同じパッケージの検証済みが食い違う、範囲の交わりが空 → GenerateError（名前を示す）
//   targetsFor(answers, templatesDir?) = selectProfiles → resolveProfiles → buildTargets
//   data/runtimes.yaml：node: { verified: "24.19.0", policy: lts }（ハーネスの .node-version と同じ版）
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { satisfies } from "semver";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { GenerateError } from "../../src/generate/errors.js";
import { loadProfile } from "../../src/generate/profile.js";
import { buildTargets, targetsFor } from "../../src/versions/targets.js";
import { cleanupTemplates, makeTemplates } from "../generate/helpers.js";
import { baseAnswers } from "../questions/helpers.js";

afterAll(cleanupTemplates);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function profileYaml(id: string, body: string): string {
  return `id: ${id}\ncategory: lib\nname: ${id}\nskill_name: lib-${id}\n${body}`;
}

function load(files: Record<string, string>, keys: string[]) {
  const dir = makeTemplates(
    Object.fromEntries(
      Object.entries(files).flatMap(([id, yaml]) => [
        [`profiles/lib/${id}/profile.yaml`, profileYaml(id, yaml)],
        [`profiles/lib/${id}/SKILL.md`, `# ${id}\n`],
      ]),
    ),
  );
  return keys.map((k) => loadProfile(dir, k));
}

const byName = (targets: ReturnType<typeof buildTargets>, name: string) =>
  targets.find((t) => t.name === name);

describe("#33 調べる対象：Node.js", () => {
  it("#33 AC-1: data/runtimes.yaml の node.verified は、ハーネスの .node-version と同じ版で、方針は lts", () => {
    const runtimes = parse(readFileSync(path.join(root, "data", "runtimes.yaml"), "utf8")) as {
      node: { verified: string; policy: string };
    };
    expect(runtimes.node.policy).toBe("lts");
    expect(runtimes.node.verified).toBe(
      readFileSync(path.join(root, ".node-version"), "utf8").trim(),
    );
  });

  it("#33 AC-1: 対象の先頭は Node.js（検証済みは runtimes.yaml の版、範囲なし・プロファイルなし）", () => {
    const targets = buildTargets(load({ alpha: "packages: []\n" }, ["lib/alpha"]), baseAnswers());
    const node = targets[0];
    expect(node?.kind).toBe("node");
    expect(node?.name).toBe("node");
    expect(node?.verified).toBe(readFileSync(path.join(root, ".node-version"), "utf8").trim());
    expect(node?.range).toBeUndefined();
    expect(node?.unverified).toBe(false);
    expect(node?.profiles).toEqual([]);
  });
});

describe("#33 AC-2: プロファイルから調べる対象を作る", () => {
  it("#33 AC-2: packages の名前・検証済み・範囲・持つプロファイルを持つ", () => {
    const profiles = load(
      {
        alpha: `packages: [pkg-a, pkg-b]
verified_versions:
  pkg-a: "4.1.0"
  pkg-b: "1.0.0"
version_ranges:
  pkg-a: "^4"
`,
      },
      ["lib/alpha"],
    );
    const targets = buildTargets(profiles, baseAnswers());
    const a = byName(targets, "pkg-a");
    expect(a).toMatchObject({
      kind: "npm",
      name: "pkg-a",
      verified: "4.1.0",
      unverified: false,
      profiles: ["lib/alpha"],
    });
    expect(satisfies("4.9.0", a?.range ?? "")).toBe(true);
    expect(satisfies("5.0.0", a?.range ?? "")).toBe(false);
    const b = byName(targets, "pkg-b");
    expect(b?.verified).toBe("1.0.0");
    expect(b?.range).toBeUndefined();
  });

  it("#33 AC-2: 同じパッケージを持つ2つのプロファイルは、1つの対象にまとまり、範囲は交わり（両方に合う版だけ）になる", () => {
    const profiles = load(
      {
        alpha: `packages: [pkg-x]
verified_versions:
  pkg-x: "2.1.0"
version_ranges:
  pkg-x: ">=2.0.0 <4.0.0"
`,
        beta: `packages: [pkg-x]
verified_versions:
  pkg-x: "2.1.0"
version_ranges:
  pkg-x: "^2.1.0 || ^3.0.0"
`,
      },
      ["lib/alpha", "lib/beta"],
    );
    const targets = buildTargets(profiles, baseAnswers());
    expect(targets.filter((t) => t.name === "pkg-x")).toHaveLength(1);
    const x = byName(targets, "pkg-x");
    expect(x?.profiles.sort()).toEqual(["lib/alpha", "lib/beta"]);
    const ok = (v: string) => satisfies(v, x?.range ?? "");
    expect(ok("2.1.0")).toBe(true);
    expect(ok("3.5.0")).toBe(true);
    expect(ok("2.0.5")).toBe(false); // 片方（^2.1.0 || ^3）に合わない
    expect(ok("4.0.0")).toBe(false); // もう片方（<4）に合わない
  });

  it("#33 R5: 範囲の交わりが空ならエラー（パッケージ名を示す）", () => {
    const profiles = load(
      {
        alpha:
          'packages: [pkg-x]\nverified_versions:\n  pkg-x: "2.1.0"\nversion_ranges:\n  pkg-x: "^2"\n',
        beta: 'packages: [pkg-x]\nunverified: [pkg-x]\nversion_ranges:\n  pkg-x: "^3"\n',
      },
      ["lib/alpha", "lib/beta"],
    );
    expect(() => buildTargets(profiles, baseAnswers())).toThrow(GenerateError);
    expect(() => buildTargets(profiles, baseAnswers())).toThrow(/pkg-x/);
  });

  it("#33 R5: 同じパッケージの検証済みが、プロファイル同士で食い違うとエラー", () => {
    const profiles = load(
      {
        alpha: 'packages: [pkg-x]\nverified_versions:\n  pkg-x: "2.1.0"\n',
        beta: 'packages: [pkg-x]\nverified_versions:\n  pkg-x: "2.2.0"\n',
      },
      ["lib/alpha", "lib/beta"],
    );
    expect(() => buildTargets(profiles, baseAnswers())).toThrow(GenerateError);
    expect(() => buildTargets(profiles, baseAnswers())).toThrow(/pkg-x/);
  });

  it("#33 R5: 同じ検証済みなら、2つのプロファイルがあってもエラーにならない（zod のように）", () => {
    const profiles = load(
      {
        alpha: 'packages: [pkg-x]\nverified_versions:\n  pkg-x: "2.1.0"\n',
        beta: 'packages: [pkg-x]\nverified_versions:\n  pkg-x: "2.1.0"\n',
      },
      ["lib/alpha", "lib/beta"],
    );
    expect(() => buildTargets(profiles, baseAnswers())).not.toThrow();
  });

  it("#33 AC-2: 検証済みがなく unverified でもないパッケージは、プロファイルの誤りとしてエラー（名前を示す）", () => {
    const profiles = load(
      { alpha: 'packages: [pkg-a, pkg-b]\nverified_versions:\n  pkg-a: "1.0.0"\n' },
      ["lib/alpha"],
    );
    expect(() => buildTargets(profiles, baseAnswers())).toThrow(GenerateError);
    expect(() => buildTargets(profiles, baseAnswers())).toThrow(/pkg-b/);
  });

  it("#33 R1: unverified のパッケージは、検証済みを持たない対象（unverified が真）になる", () => {
    const profiles = load(
      {
        alpha:
          'packages: [pkg-a, pkg-new]\nverified_versions:\n  pkg-a: "1.0.0"\nunverified: [pkg-new]\nversion_ranges:\n  pkg-new: "^14"\n',
      },
      ["lib/alpha"],
    );
    const n = byName(buildTargets(profiles, baseAnswers()), "pkg-new");
    expect(n?.unverified).toBe(true);
    expect(n?.verified).toBeUndefined();
    expect(satisfies("14.6.1", n?.range ?? "")).toBe(true);
  });

  it("#33 R1: external_tools と optional_packages は、調べる対象に含めない", () => {
    const profiles = load(
      {
        alpha:
          'packages: [pkg-a]\nverified_versions:\n  pkg-a: "1.0.0"\nexternal_tools: [fake-bench]\noptional_packages: [pkg-opt]\n',
      },
      ["lib/alpha"],
    );
    const names = buildTargets(profiles, baseAnswers()).map((t) => t.name);
    expect(names).toContain("pkg-a");
    expect(names).not.toContain("fake-bench");
    expect(names).not.toContain("pkg-opt");
  });
});

describe("#33 R2・R9: packages_when は、回答に合うときだけ対象に加える", () => {
  const yaml = `packages: [pkg-a]
packages_when:
  - when: { database: postgresql }
    packages: [pkg-pg]
verified_versions:
  pkg-a: "1.0.0"
  pkg-pg: "8.23.0"
version_ranges:
  pkg-pg: ">=8.13.0"
`;

  it("#33 R2: database が postgresql のときだけ pkg-pg を加える（範囲・検証済みつき）", () => {
    const profiles = load({ alpha: yaml }, ["lib/alpha"]);
    const pg = byName(
      buildTargets(profiles, baseAnswers({ database: "postgresql", postgres_provider: "neon" })),
      "pkg-pg",
    );
    expect(pg?.verified).toBe("8.23.0");
    expect(satisfies("8.13.0", pg?.range ?? "")).toBe(true);
    expect(satisfies("8.12.9", pg?.range ?? "")).toBe(false);
    for (const database of ["d1", "none"]) {
      const names = buildTargets(profiles, baseAnswers({ database })).map((t) => t.name);
      expect(names).not.toContain("pkg-pg");
      expect(names).toContain("pkg-a");
    }
  });
});

describe("#33 R1・R2・R9: 実際のプロファイルから、調べる対象の一覧を作る", () => {
  const names = (answers: Partial<ReturnType<typeof baseAnswers>>) =>
    targetsFor(baseAnswers(answers as Record<string, unknown>)).map((t) => t.name);

  it("#33 R2: D1 では drizzle-orm・drizzle-kit を含み、pg を含まない", () => {
    const n = names({ database: "d1" });
    expect(n).toEqual(expect.arrayContaining(["drizzle-orm", "drizzle-kit"]));
    expect(n).not.toContain("pg");
  });

  it("#33 R2: PostgreSQL では pg を含む", () => {
    expect(names({ database: "postgresql", postgres_provider: "neon" } as never)).toEqual(
      expect.arrayContaining(["drizzle-orm", "drizzle-kit", "pg"]),
    );
  });

  it("#33 R2: DB なしでは drizzle も pg も含まない", () => {
    const n = names({ database: "none", auth: "none", idp: undefined } as never);
    expect(n).not.toContain("drizzle-orm");
    expect(n).not.toContain("drizzle-kit");
    expect(n).not.toContain("pg");
  });

  it("#33 R1: k6（外部の道具）は含まない。Node.js と、主なパッケージ（vitest・typescript・hono）は含む", () => {
    const n = names({ database: "d1" });
    expect(n).not.toContain("k6");
    expect(n).toEqual(
      expect.arrayContaining([
        "node",
        "vitest",
        "typescript",
        "hono",
        "@testing-library/user-event",
      ]),
    );
  });

  it("#33 R1: 名前は重複しない（zod は hono と frontend-state の両方にあるが、1つの対象で、両方のプロファイルを持つ）", () => {
    const targets = targetsFor(baseAnswers({ database: "d1" }));
    const all = targets.map((t) => t.name);
    expect(new Set(all).size).toBe(all.length);
    const zod = targets.find((t) => t.name === "zod");
    expect(zod?.profiles.sort()).toEqual([
      "backend-framework/hono",
      "frontend-state/tanstack-query-rhf-zod",
    ]);
  });

  it("#33 AC-2: vitest は ^4（5 系は範囲外）、typescript は 6.0 系だけ、pg は 8.13.0 以上", () => {
    const targets = targetsFor(baseAnswers({ database: "postgresql", postgres_provider: "neon" }));
    const range = (n: string) => targets.find((t) => t.name === n)?.range ?? "";
    expect(satisfies("4.9.9", range("vitest"))).toBe(true);
    expect(satisfies("5.0.0", range("vitest"))).toBe(false);
    expect(satisfies("6.0.9", range("typescript"))).toBe(true);
    expect(satisfies("6.1.0", range("typescript"))).toBe(false);
    expect(satisfies("8.13.0", range("pg"))).toBe(true);
    expect(satisfies("8.12.0", range("pg"))).toBe(false);
  });

  it("#33 R8: 今の8つのプロファイルには unverified のパッケージがない（user-event も検証済みの版を持つ）", () => {
    for (const database of ["d1", "postgresql", "none"]) {
      const targets = targetsFor(
        baseAnswers(
          database === "none"
            ? { database, auth: "none", idp: undefined }
            : { database, ...(database === "postgresql" ? { postgres_provider: "neon" } : {}) },
        ),
      );
      for (const t of targets) {
        expect(t.unverified, `${database} の ${t.name}`).toBe(false);
        expect(t.verified, `${database} の ${t.name}`).toBeDefined();
      }
    }
  });

  it("#33 R8: user-event の検証済みの版は、範囲に合う安定版である", () => {
    const t = targetsFor(baseAnswers()).find((x) => x.name === "@testing-library/user-event");
    expect(t?.verified).toMatch(/^\d+\.\d+\.\d+$/); // 試験版（-rc など）でない
    if (t?.range) expect(satisfies(t.verified ?? "", t.range)).toBe(true);
  });

  it("#33 R5: すべての対象で、検証済みの版は範囲に合う", () => {
    for (const t of targetsFor(
      baseAnswers({ database: "postgresql", postgres_provider: "neon" }),
    )) {
      if (t.verified && t.range) expect(satisfies(t.verified, t.range), t.name).toBe(true);
    }
  });
});
