// #18 既存の技術の判定（src/adopt/detect.ts）。偽の fs で、読んだパスを記録して確かめる。
// 架空のデータだけ。秘密らしいダミーの値は、実行時に連結して作る。
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectStack, loadDetectionRules, type DetectedStack } from "../../src/adopt/detect.js";
import { realUpdateFs } from "../../src/update/fs.js";
import { dummySecret, memFs, pkg, type MemEntry } from "./detect-helpers.js";

const rules = loadDetectionRules();
const detect = async (entries: Record<string, MemEntry>) => {
  const fs = memFs(entries);
  const stack = await detectStack("/proj", fs, rules);
  return { stack, fs };
};
const find = (stack: DetectedStack, dir: string, technology: string) =>
  stack.apps.find((a) => a.dir === dir)?.items.find((i) => i.technology === technology);
const notePaths = (stack: DetectedStack): string[] => stack.notes.map((n) => n.path);

describe("技術の判定：基本", () => {
  it("package.json の依存・設定ファイル・CI から、分類・技術・根拠を出す", async () => {
    const { stack } = await detect({
      "/proj/backend/package.json": pkg(
        { hono: "^4.0.0", "drizzle-orm": "^0.45.0" },
        { devDependencies: { vitest: "^4.0.0", typescript: "^6.0.0" } },
      ),
      "/proj/frontend/package.json": pkg({
        react: "^19.0.0",
        "react-router": "^8.0.0",
        vite: "^8.0.0",
      }),
      "/proj/.eslintrc.json": "{}",
      "/proj/.github/workflows/ci.yml": "name: ci\n",
    });
    expect(find(stack, "backend", "Hono")).toEqual({
      class: "backend",
      technology: "Hono",
      evidence: ["backend/package.json"],
    });
    expect(find(stack, "backend", "Drizzle ORM")?.class).toBe("db");
    expect(find(stack, "backend", "Vitest")?.class).toBe("test");
    expect(find(stack, "backend", "TypeScript")?.class).toBe("language");
    expect(find(stack, "frontend", "Vite")?.class).toBe("frontend");
    expect(find(stack, ".", "ESLint")).toEqual({
      class: "quality",
      technology: "ESLint",
      evidence: [".eslintrc.json"],
    });
    expect(find(stack, ".", "GitHub Actions")).toEqual({
      class: "ci",
      technology: "GitHub Actions",
      evidence: [".github/workflows/ci.yml"],
    });
  });

  it("Python（manage.py・pyproject.toml）と Go（go.mod の go 行の版）を判定する", async () => {
    const { stack } = await detect({
      "/proj/manage.py": "# django entry\n",
      "/proj/pyproject.toml": '[project]\ndependencies = ["django>=5", "pytest"]\n',
      "/proj/frontend/go.mod": "module example.com/sample\n\ngo 1.23\n",
    });
    expect(find(stack, ".", "Python")).toMatchObject({
      class: "language",
      evidence: ["manage.py", "pyproject.toml"],
    });
    // フレームワーク・依存の名前は判定しない（後の #19 で AI が根拠つきで補う）
    expect(find(stack, ".", "Django")).toBeUndefined();
    expect(find(stack, ".", "pytest")).toBeUndefined();
    expect(find(stack, "frontend", "Go")).toEqual({
      class: "language",
      technology: "Go",
      version: "1.23",
      evidence: ["frontend/go.mod"],
    });
  });

  it("実行環境の版：.node-version・.nvmrc・engines.node・.python-version", async () => {
    const { stack } = await detect({
      "/proj/.node-version": "v24.1.0\n",
      "/proj/package.json": pkg({}),
      "/proj/backend/.nvmrc": "22\n",
      "/proj/backend/package.json": pkg({}),
      "/proj/frontend/.python-version": "3.13\n",
      "/proj/frontend/requirements.txt": "pytest\n",
    });
    expect(find(stack, ".", "Node.js")?.version).toBe("24.1.0");
    expect(find(stack, "backend", "Node.js")?.version).toBe("22");
    expect(find(stack, "frontend", "Python")).toBeDefined();
    expect(find(stack, "frontend", "Python")?.class).toBe("language");
    expect(stack.apps.find((a) => a.dir === "frontend")?.items.map((i) => i.version)).toContain(
      "3.13",
    );
  });

  it("engines.node だけでも版が分かる。変な版の文字列は使わない", async () => {
    const { stack } = await detect({
      "/proj/package.json": pkg({}, { engines: { node: ">=24" } }),
      "/proj/backend/package.json": pkg({}, { engines: { node: "x; rm -rf" } }),
    });
    expect(find(stack, ".", "Node.js")?.version).toBe(">=24");
    expect(find(stack, "backend", "Node.js")).toBeUndefined();
  });

  it("指摘2：workspaces の所属の子は、ルートの typescript を使うので言語が TypeScript になる。独立した子は JavaScript のまま", async () => {
    const { stack } = await detect({
      "/proj/package.json": pkg(
        {},
        { workspaces: ["apps/*"], devDependencies: { typescript: "^6" } },
      ),
      "/proj/apps/api/package.json": pkg({ hono: "^4" }),
      "/proj/frontend/package.json": pkg({ vue: "^3" }),
    });
    expect(find(stack, "apps/api", "TypeScript")?.class).toBe("language");
    expect(find(stack, "apps/api", "JavaScript")).toBeUndefined();
    expect(stack.apps.find((a) => a.dir === "apps/api")?.member).toBe(true);
    expect(stack.apps.find((a) => a.dir === ".")?.workspaces).toBe(true);
    expect(find(stack, "frontend", "JavaScript")).toBeDefined();
    expect(stack.apps.find((a) => a.dir === "frontend")?.member).toBeFalsy();
  });

  it("Node.js 以外は、ファイルの有無で言語だけを判定する（依存の名前・説明文・URL は見ない）。読めなかったとも記録しない", async () => {
    const { stack } = await detect({
      "/proj/pyproject.toml": [
        "[project]",
        'description = "django flask fastapi"',
        'dependencies = ["django", "pytest"]',
      ].join("\n"),
      "/proj/frontend/pyproject.toml": '[project]\ndependencies = [\n "django"\n',
      "/proj/a/Gemfile": "gem 'rails'\n",
      "/proj/b/pom.xml": "<project><artifactId>spring-boot-starter</artifactId></project>\n",
    });
    expect(find(stack, ".", "Python")).toBeDefined();
    expect(find(stack, "frontend", "Python")).toBeDefined();
    expect(find(stack, "a", "Ruby")).toBeUndefined(); // a/ は調べる場所ではない
    const techs = stack.apps.flatMap((x) => x.items.map((i) => i.technology));
    for (const name of ["Django", "Flask", "FastAPI", "pytest", "Ruby on Rails", "Spring Boot"]) {
      expect(techs).not.toContain(name);
    }
    expect(stack.notes).toEqual([]);
  });

  it("Ruby（Gemfile）・Java（pom.xml）も、言語だけを判定する", async () => {
    const { stack } = await detect({
      "/proj/backend/Gemfile": "gem 'rails'\n",
      "/proj/frontend/pom.xml": "<project></project>\n",
    });
    expect(find(stack, "backend", "Ruby")?.class).toBe("language");
    expect(find(stack, "frontend", "Java")?.class).toBe("language");
    expect(find(stack, "backend", "Ruby on Rails")).toBeUndefined();
  });

  it("BOM 付きの package.json も読める", async () => {
    const bom = String.fromCharCode(0xfeff);
    const { stack } = await detect({ "/proj/package.json": bom + pkg({ hono: "^4" }) });
    expect(find(stack, ".", "Hono")).toBeDefined();
    expect(stack.notes).toEqual([]);
  });

  it("アプリがなければ、項目は空", async () => {
    const { stack } = await detect({ "/proj/README.md": "# sample\n" });
    expect(stack.apps.every((a) => a.items.length === 0)).toBe(true);
  });
});

describe("技術の判定：秘密情報のファイルを開かない", () => {
  const entries = (): Record<string, MemEntry> => ({
    "/proj/package.json": pkg({ hono: "^4" }),
    "/proj/.env": `DATABASE_URL=${dummySecret()}\n`,
    "/proj/.env.local": `API_TOKEN=${dummySecret()}\n`,
    "/proj/.env.production": `API_TOKEN=${dummySecret()}\n`,
    "/proj/backend/.env": `API_TOKEN=${dummySecret()}\n`,
    "/proj/.dev.vars": `API_TOKEN=${dummySecret()}\n`,
    "/proj/.env.example": `DATABASE_URL=${dummySecret()}\nOTHER=1\n`,
  });

  it(".env・.env.*・.dev.vars は開かない（.env.example だけ開く）", async () => {
    const { fs } = await detect(entries());
    const bad = fs.reads.filter(
      (p) => /\/\.env($|\.)|\.dev\.vars/.test(p) && !p.endsWith("/.env.example"),
    );
    expect(bad).toEqual([]);
    expect(fs.reads).toContain("/proj/.env.example");
  });

  it(".env.example は、キーの名前だけを使い、値は結果のどこにも出ない", async () => {
    const { stack } = await detect(entries());
    expect(find(stack, ".", "データベース（DATABASE_URL）")).toMatchObject({
      class: "db",
      evidence: [".env.example"],
    });
    const text = JSON.stringify(stack);
    expect(text).not.toContain(dummySecret());
    expect(text).not.toContain("OTHER");
  });

  it("壊れた package.json は止めず、読めなかったと記録する（中身・エラーの文は出さない）", async () => {
    const broken = `{ "name": "${dummySecret()}", `;
    const { stack } = await detect({
      "/proj/package.json": broken,
      "/proj/backend/package.json": pkg({ hono: "^4" }),
    });
    expect(find(stack, "backend", "Hono")).toBeDefined();
    expect(stack.notes).toEqual([
      { path: "package.json", reason: "読めませんでした（JSON として誤っています）" },
    ]);
    expect(JSON.stringify(stack)).not.toContain(dummySecret());
  });

  it("package.json が配列などの形でも止めない", async () => {
    const { stack } = await detect({ "/proj/package.json": "[1,2]" });
    expect(notePaths(stack)).toEqual(["package.json"]);
  });

  it("大きすぎるファイルは読まない", async () => {
    const big = "x".repeat(2 * 1024 * 1024);
    const { stack, fs } = await detect({ "/proj/package.json": big });
    expect(fs.reads).not.toContain("/proj/package.json");
    expect(stack.notes[0]).toMatchObject({
      path: "package.json",
      reason: "大きすぎるため読まない",
    });
  });
});

describe("技術の判定：範囲と順序", () => {
  it("workspaces・apps/*・packages/* を調べ、深さ2を超えるものと node_modules は見ない", async () => {
    const { stack, fs } = await detect({
      "/proj/package.json": pkg({}, { workspaces: ["tools/*", "libs/core", "deep/a/b"] }),
      "/proj/apps/web/package.json": pkg({ vite: "^8" }),
      "/proj/packages/ui/package.json": pkg({ react: "^19" }),
      "/proj/tools/cli/package.json": pkg({ express: "^5" }),
      "/proj/libs/core/package.json": pkg({ fastify: "^5" }),
      "/proj/deep/a/b/package.json": pkg({ koa: "^3" }),
      "/proj/apps/web/src/x/package.json": pkg({ koa: "^3" }),
      "/proj/node_modules/hono/package.json": pkg({ hono: "^4" }),
      "/proj/apps/node_modules/pkg/package.json": pkg({ hono: "^4" }),
      "/proj/.git/package.json": pkg({ hono: "^4" }),
    });
    expect(find(stack, "apps/web", "Vite")).toBeDefined();
    expect(find(stack, "packages/ui", "React")).toBeDefined();
    expect(find(stack, "tools/cli", "Express")).toBeDefined();
    expect(find(stack, "libs/core", "Fastify")).toBeDefined();
    expect(stack.apps.some((a) => a.dir === "deep/a/b")).toBe(false);
    expect(fs.reads.some((p) => p.includes("node_modules") || p.includes("/.git/"))).toBe(false);
    expect(fs.lists.some((p) => p.includes("node_modules") || p.includes("/.git"))).toBe(false);
    expect(fs.reads).not.toContain("/proj/deep/a/b/package.json");
    expect(fs.reads).not.toContain("/proj/apps/web/src/x/package.json");
  });

  it("package.json の workspaces がオブジェクトの形（packages）でも読む", async () => {
    const { stack } = await detect({
      "/proj/package.json": pkg({}, { workspaces: { packages: ["services/*"] } }),
      "/proj/services/api/package.json": pkg({ hono: "^4" }),
    });
    expect(find(stack, "services/api", "Hono")).toBeDefined();
  });

  it("同じ入力なら、ファイルを置く順が違っても、同じ結果になる", async () => {
    const a: Record<string, MemEntry> = {
      "/proj/backend/package.json": pkg({ hono: "^4", zod: "^4" }),
      "/proj/frontend/package.json": pkg({ vite: "^8", react: "^19" }),
      "/proj/.eslintrc.json": "{}",
      "/proj/.github/workflows/b.yml": "",
      "/proj/.github/workflows/a.yml": "",
    };
    const b = Object.fromEntries(Object.entries(a).reverse());
    const first = (await detect(a)).stack;
    expect(first).toEqual((await detect(b)).stack);
    const dirs = first.apps.map((x) => x.dir);
    expect(dirs[0]).toBe(".");
    expect(dirs.slice(1)).toEqual([...dirs.slice(1)].sort());
    expect(find(first, ".", "GitHub Actions")?.evidence).toEqual([
      ".github/workflows/a.yml",
      ".github/workflows/b.yml",
    ]);
  });
});

describe("技術の判定：リンクとルートの外（偽の fs）", () => {
  it("package.json が .env へのリンクなら、読まずに、リンクのため読まないと記録する", async () => {
    const { stack, fs } = await detect({
      "/proj/.env": `DATABASE_URL=${dummySecret()}\n`,
      "/proj/package.json": { link: "/proj/.env" },
    });
    expect(fs.reads).toEqual([]);
    expect(stack.notes).toContainEqual({ path: "package.json", reason: "リンクのため読まない" });
    expect(JSON.stringify(stack)).not.toContain(dummySecret());
  });

  it(".env.example が .env へのリンクなら、読まない", async () => {
    const { stack, fs } = await detect({
      "/proj/.env": `DATABASE_URL=${dummySecret()}\n`,
      "/proj/.env.example": { link: "/proj/.env" },
    });
    expect(fs.reads).toEqual([]);
    expect(stack.notes).toContainEqual({ path: ".env.example", reason: "リンクのため読まない" });
    expect(JSON.stringify(stack)).not.toContain(dummySecret());
  });

  it("workspaces の ../・絶対パス・ルートの外を指す書き方は読まない", async () => {
    const { stack, fs } = await detect({
      "/proj/package.json": pkg(
        {},
        { workspaces: ["../outside", "/outside", "a/../../outside", "C:/outside"] },
      ),
      "/outside/package.json": pkg({ hono: "^4" }),
    });
    expect(fs.reads.filter((p) => p.startsWith("/outside"))).toEqual([]);
    expect(fs.lists.filter((p) => p.startsWith("/outside"))).toEqual([]);
    expect(stack.apps.some((a) => find(stack, a.dir, "Hono") !== undefined)).toBe(false);
    expect(notePaths(stack)).toContain("../outside");
  });

  it("ルートの外を指すリンク（ジャンクション）のフォルダは、中に入らない", async () => {
    const { stack, fs } = await detect({
      "/proj/package.json": pkg({}, { workspaces: ["apps/*"] }),
      "/outside/package.json": pkg({ hono: "^4" }),
      "/proj/apps/evil": { link: "/outside" },
      "/proj/backend": { link: "/outside" },
    });
    expect(fs.reads.filter((p) => p.startsWith("/outside"))).toEqual([]);
    expect(fs.reads.filter((p) => p.includes("/evil/") || p.includes("/proj/backend/"))).toEqual(
      [],
    );
    expect(notePaths(stack)).toEqual(expect.arrayContaining(["apps/evil", "backend"]));
    expect(stack.notes.every((n) => n.reason === "リンクのため読まない")).toBe(true);
    expect(find(stack, "apps/evil", "Hono")).toBeUndefined();
  });

  it("ルートの中を指すリンクのフォルダも、読まない（リンクはたどらない）", async () => {
    const { stack, fs } = await detect({
      "/proj/real/package.json": pkg({ hono: "^4" }),
      "/proj/backend": { link: "/proj/real" },
    });
    expect(fs.reads).not.toContain("/proj/backend/package.json");
    expect(notePaths(stack)).toContain("backend");
  });

  it("途中がリンクのフォルダの下は読まない（.github がリンク）", async () => {
    const { stack, fs } = await detect({
      "/outside/workflows/ci.yml": "name: x\n",
      "/proj/.github": { link: "/outside" },
    });
    expect(fs.lists.filter((p) => p.startsWith("/outside"))).toEqual([]);
    expect(notePaths(stack)).toContain(".github");
  });
});

describe("技術の判定：本物のファイルシステム", () => {
  it("本物のフォルダを読める。リンクを作れる環境では、リンクを読まない", async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "harness-q18-"));
    try {
      const root = await realpath(base);
      mkdirSync(path.join(root, "proj", "backend"), { recursive: true });
      mkdirSync(path.join(root, "outside"), { recursive: true });
      writeFileSync(path.join(root, "proj", "backend", "package.json"), pkg({ hono: "^4" }));
      writeFileSync(path.join(root, "outside", "package.json"), pkg({ express: "^5" }));
      writeFileSync(path.join(root, "outside", "secret.txt"), dummySecret());
      const stack1 = await detectStack(path.join(root, "proj"), realUpdateFs, rules);
      expect(find(stack1, "backend", "Hono")).toBeDefined();

      let linked = true;
      try {
        symlinkSync(path.join(root, "outside"), path.join(root, "proj", "apps"), "junction");
        symlinkSync(
          path.join(root, "outside", "secret.txt"),
          path.join(root, "proj", ".env.example"),
        );
      } catch {
        linked = false; // リンクを作れない環境。上の偽の fs のテストが、同じことを確かめている
      }
      if (linked && existsSync(path.join(root, "proj", "apps"))) {
        const stack2 = await detectStack(path.join(root, "proj"), realUpdateFs, rules);
        expect(find(stack2, "apps", "Express")).toBeUndefined();
        expect(JSON.stringify(stack2)).not.toContain(dummySecret());
      }
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    }
  });
});
