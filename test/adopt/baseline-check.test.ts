// #21：導入先に置く基準線の確認（.harness/scripts/baseline-check.mjs）の、数え方・比べ方・下げ方。
// ひな形に値を差し込んだスクリプトを、一時フォルダに置いて import して確かめる（道具を実際に動かすのは smoke）。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { buildBaselineScript } from "../../src/adopt/ci.js";
import { findTemplatesDir } from "../../src/generate/templates-dir.js";

type Metrics = Record<string, number | null>;
type Apps = Record<string, Metrics>;
interface Change {
  dir: string;
  metric: string;
  from: number | null;
  to: number | null;
}
interface Compared {
  ok: boolean;
  increases: Change[];
  decreases: Change[];
  recordable: Change[];
  problems: Change[];
}
interface Lowered {
  ok: boolean;
  next?: Apps;
  reasons: string[];
}
interface Mod {
  compare(baseline: Apps, current: Apps): Compared;
  lower(baseline: Apps, current: Apps, opts: { allowIncrease: boolean }): Lowered;
  parseBaseline(text: string): { ok: boolean; baseline?: { apps: Apps }; reason?: string };
  formatCompare(result: Compared): string[];
  countEslint(stdout: string, appDir: string): number[] | undefined;
  countTsc(stdout: string): number;
  countPrettier(stdout: string): number;
  PRETTIER_CONFIGS: string[];
  ESLINT_CONFIGS: string[];
}

const base = mkdtempSync(path.join(os.tmpdir(), "harness-baseline-unit-"));
afterAll(() => {
  rmSync(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
});

async function load(): Promise<Mod> {
  const file = path.join(base, "baseline-check.mjs");
  writeFileSync(
    file,
    buildBaselineScript({
      templatesDir: findTemplatesDir(),
      dirs: ["app"],
      harnessVersion: "0.0.0",
    }),
  );
  return (await import(pathToFileURL(file).href)) as Mod;
}

const m = (e: number | null, w: number | null, t: number | null, p: number | null): Metrics => ({
  eslint_error: e,
  eslint_warning: w,
  tsc_error: t,
  prettier_files: p,
});

describe("#21 R2: 設定ファイルの名前（漏れがあると、道具があっても対象外になり、増えても通ってしまう）", () => {
  it("Prettier の設定の名前をすべて含む（TypeScript の設定を含む）", async () => {
    const mod = await load();
    for (const name of [
      ".prettierrc",
      ".prettierrc.json",
      ".prettierrc.yml",
      ".prettierrc.yaml",
      ".prettierrc.json5",
      ".prettierrc.js",
      ".prettierrc.cjs",
      ".prettierrc.mjs",
      ".prettierrc.ts",
      ".prettierrc.mts",
      ".prettierrc.cts",
      ".prettierrc.toml",
      "prettier.config.js",
      "prettier.config.cjs",
      "prettier.config.mjs",
      "prettier.config.ts",
      "prettier.config.mts",
      "prettier.config.cts",
    ]) {
      expect(mod.PRETTIER_CONFIGS, name).toContain(name);
    }
  });

  it("ESLint の設定の名前をすべて含む", async () => {
    const mod = await load();
    for (const name of [
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
      "eslint.config.ts",
      "eslint.config.mts",
      "eslint.config.cts",
      ".eslintrc",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.json",
      ".eslintrc.yml",
      ".eslintrc.yaml",
    ]) {
      expect(mod.ESLINT_CONFIGS, name).toContain(name);
    }
  });
});

describe("#21 compare（増えると失敗、同じなら通る）", () => {
  it("同じなら通る", async () => {
    const mod = await load();
    const r = mod.compare({ app: m(3, 5, 0, 2) }, { app: m(3, 5, 0, 2) });
    expect(r.ok).toBe(true);
    expect(r.increases).toEqual([]);
    expect(r.decreases).toEqual([]);
  });

  it("どれか1つでも増えると失敗し、フォルダと種類が分かる", async () => {
    const mod = await load();
    const r = mod.compare({ app: m(3, 5, 0, 2) }, { app: m(3, 6, 0, 2) });
    expect(r.ok).toBe(false);
    expect(r.increases).toEqual([{ dir: "app", metric: "eslint_warning", from: 5, to: 6 }]);
    const text = mod.formatCompare(r).join("\n");
    expect(text).toContain("app");
    expect(text).toContain("ESLint");
    expect(text).toContain("5");
    expect(text).toContain("6");
  });

  it("ESLint の error と warning は別々に数える（片方が減っても、もう片方が増えれば失敗）", async () => {
    const mod = await load();
    const r = mod.compare({ app: m(3, 5, 0, 0) }, { app: m(1, 6, 0, 0) });
    expect(r.ok).toBe(false);
    expect(r.increases.map((x) => x.metric)).toEqual(["eslint_warning"]);
    expect(r.decreases.map((x) => x.metric)).toEqual(["eslint_error"]);
  });

  it("減っても通る。基準線を下げる案内（--update）を出す", async () => {
    const mod = await load();
    const r = mod.compare({ app: m(3, 5, 4, 2) }, { app: m(1, 5, 4, 2) });
    expect(r.ok).toBe(true);
    expect(r.decreases).toEqual([{ dir: "app", metric: "eslint_error", from: 3, to: 1 }]);
    expect(mod.formatCompare(r).join("\n")).toContain("--update");
  });

  it("基準線が null（対象外）で、今は数値：通る。--update で記録する案内", async () => {
    const mod = await load();
    const r = mod.compare({ app: m(null, null, 0, 0) }, { app: m(2, 0, 0, 0) });
    expect(r.ok).toBe(true);
    expect(r.recordable.map((x) => x.metric)).toEqual(["eslint_error", "eslint_warning"]);
    expect(mod.formatCompare(r).join("\n")).toContain("--update");
  });

  it("基準線は数値で、今は測れない（道具が無くなった）：失敗", async () => {
    const mod = await load();
    const r = mod.compare({ app: m(3, 0, 0, 0) }, { app: m(null, 0, 0, 0) });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([{ dir: "app", metric: "eslint_error", from: 3, to: null }]);
  });

  it("基準線にないフォルダ：失敗（--update で記録する案内）", async () => {
    const mod = await load();
    const r = mod.compare({}, { app: m(0, 0, 0, 0) });
    expect(r.ok).toBe(false);
    expect(mod.formatCompare(r).join("\n")).toContain("--update");
  });
});

describe("#21 lower（--update で下げる。上げるのは --allow-increase のときだけ）", () => {
  it("減ったときは、新しい値に下げられる", async () => {
    const mod = await load();
    const r = mod.lower({ app: m(3, 5, 4, 2) }, { app: m(1, 5, 4, 0) }, { allowIncrease: false });
    expect(r.ok).toBe(true);
    expect(r.next).toEqual({ app: m(1, 5, 4, 0) });
  });

  it("増えた値が1つでもあれば書かない（ほかの値が減っていても）", async () => {
    const mod = await load();
    const r = mod.lower({ app: m(3, 5, 4, 2) }, { app: m(1, 6, 4, 2) }, { allowIncrease: false });
    expect(r.ok).toBe(false);
    expect(r.next).toBeUndefined();
    expect(r.reasons.join("\n")).toContain("--allow-increase");
  });

  it("--allow-increase のときは上げられる。ADR と承認（C-80）の案内を出す", async () => {
    const mod = await load();
    const r = mod.lower({ app: m(3, 5, 4, 2) }, { app: m(1, 6, 4, 2) }, { allowIncrease: true });
    expect(r.ok).toBe(true);
    expect(r.next).toEqual({ app: m(1, 6, 4, 2) });
    expect(r.reasons.join("\n")).toContain("ADR");
    expect(r.reasons.join("\n")).toContain("C-80");
  });

  it("null から数値へは、--update で記録できる", async () => {
    const mod = await load();
    const r = mod.lower(
      { app: m(null, null, 0, 0) },
      { app: m(2, 1, 0, 0) },
      { allowIncrease: false },
    );
    expect(r.ok).toBe(true);
    expect(r.next).toEqual({ app: m(2, 1, 0, 0) });
  });

  it("数値から null（道具が無くなった）は、--allow-increase でも失敗", async () => {
    const mod = await load();
    for (const allowIncrease of [false, true]) {
      const r = mod.lower({ app: m(3, 0, 0, 0) }, { app: m(null, 0, 0, 0) }, { allowIncrease });
      expect(r.ok).toBe(false);
    }
  });

  it("基準線にないフォルダは、記録できる", async () => {
    const mod = await load();
    const r = mod.lower({}, { app: m(1, 0, 0, 0) }, { allowIncrease: false });
    expect(r.ok).toBe(true);
    expect(r.next).toEqual({ app: m(1, 0, 0, 0) });
  });
});

describe("#21 フォルダ名が __proto__ のとき", () => {
  const proto = (mm: Metrics): Apps => JSON.parse(`{"__proto__": ${JSON.stringify(mm)}}`) as Apps;

  it("比べると、増えたことが分かる。基準線にないフォルダも見落とさない", async () => {
    const mod = await load();
    const r = mod.compare(proto(m(1, 0, 0, 0)), proto(m(2, 0, 0, 0)));
    expect(r.ok).toBe(false);
    expect(r.increases).toHaveLength(1);
    expect(mod.compare({}, proto(m(0, 0, 0, 0))).ok).toBe(false);
  });

  it("lower の結果と parseBaseline の結果に、__proto__ が自分のキーとして残る", async () => {
    const mod = await load();
    const r = mod.lower({}, proto(m(1, 0, 0, 0)), { allowIncrease: false });
    expect(Object.keys(r.next ?? {})).toEqual(["__proto__"]);
    const text = JSON.stringify({
      version: 1,
      harness_version: "0.0.0",
      measured_at: "x",
      apps: proto(m(1, 0, 0, 0)),
    });
    const parsed = mod.parseBaseline(text);
    expect(parsed.ok).toBe(true);
    expect(Object.keys(parsed.baseline?.apps ?? {})).toEqual(["__proto__"]);
    expect(mod.compare(parsed.baseline?.apps ?? {}, proto(m(2, 0, 0, 0))).increases).toHaveLength(
      1,
    );
  });
});

describe("#21 baseline.json の読み込み", () => {
  const good = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({
      version: 1,
      harness_version: "0.0.0",
      measured_at: "2026-01-01T00:00:00.000Z",
      apps: { app: m(1, 2, 3, 4) },
      ...over,
    });

  it("正しいものは読める", async () => {
    const mod = await load();
    const r = mod.parseBaseline(good());
    expect(r.ok).toBe(true);
    expect(r.baseline?.apps).toEqual({ app: m(1, 2, 3, 4) });
  });

  it("壊れている・版が違う・値が数でも null でもない：失敗", async () => {
    const mod = await load();
    expect(mod.parseBaseline("{ not json").ok).toBe(false);
    expect(mod.parseBaseline(good({ version: 2 })).ok).toBe(false);
    expect(mod.parseBaseline(good({ apps: null })).ok).toBe(false);
    expect(
      mod.parseBaseline(good({ apps: { app: { ...m(1, 2, 3, 4), tsc_error: "3" } } })).ok,
    ).toBe(false);
    expect(mod.parseBaseline(good({ apps: { app: { ...m(1, 2, 3, 4), tsc_error: -1 } } })).ok).toBe(
      false,
    );
    expect(mod.parseBaseline(good({ apps: { app: { eslint_error: 1 } } })).ok).toBe(false);
    expect(mod.parseBaseline("[]").ok).toBe(false);
  });
});

describe("#21 道具の出力の数え方（ソースの中身は読まない・出さない）", () => {
  it("ESLint：JSON の errorCount・warningCount の合計。.harness/ の下のファイルは数えない", async () => {
    const mod = await load();
    const appDir = path.join(base, "myapp");
    const results = [
      { filePath: path.join(appDir, "src", "a.js"), errorCount: 2, warningCount: 1 },
      { filePath: path.join(appDir, "src", "b.js"), errorCount: 0, warningCount: 4 },
      {
        filePath: path.join(appDir, ".harness", "scripts", "baseline-check.mjs"),
        errorCount: 9,
        warningCount: 9,
      },
    ];
    expect(mod.countEslint(JSON.stringify(results), appDir)).toEqual([2, 5]);
    expect(mod.countEslint("[]", appDir)).toEqual([0, 0]);
  });

  it("ESLint：JSON として読めない・形が違うときは undefined（0 件にしない）", async () => {
    const mod = await load();
    expect(mod.countEslint("not json", base)).toBeUndefined();
    expect(mod.countEslint("{}", base)).toBeUndefined();
    expect(mod.countEslint('[{"filePath":"x"}]', base)).toBeUndefined();
  });

  it("tsc：error TS の行の数。.harness/ の下のファイルの行は数えない", async () => {
    const mod = await load();
    const out = [
      "src/a.ts(1,2): error TS2322: Type mismatch.",
      "  詳細の続きの行",
      "src/b.ts(3,4): error TS2304: Cannot find name.",
      ".harness/scripts/x.ts(1,1): error TS1005: oops.",
      "error TS5058: The specified path does not exist.",
    ].join("\n");
    expect(mod.countTsc(out)).toBe(3);
    expect(mod.countTsc("")).toBe(0);
  });

  it("Prettier：--list-different の行の数。.harness/ の下は数えない（Windows の区切りも同じ）", async () => {
    const mod = await load();
    expect(
      mod.countPrettier("a.ts\nsrc/b.ts\n.harness/config.yaml\n.harness\\baseline.json\n"),
    ).toBe(2);
    expect(mod.countPrettier("")).toBe(0);
  });
});
