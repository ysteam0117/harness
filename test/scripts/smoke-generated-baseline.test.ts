// #21 smoke：導入先に置く baseline-check.mjs を、実際に Node.js で動かす（Docker は使わない）。
// 1) 偽の ESLint・tsc・Prettier（件数は環境変数で決める）で、--init → 同じ → 増えると失敗 → 減ると通る → --update の流れと、異常終了で失敗する経路。
// 2) このリポジトリの開発依存にある本物の ESLint・Prettier・TypeScript で、架空の小さなアプリを測る。
//    baseline.json・スクリプト・.harness/ の下のファイルが、件数に数えられないことを確かめる。
// 架空の値だけを使う（実データ・個人名は使わない）。
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { BASELINE_SCRIPT_PATH, buildBaselineScript } from "../../src/adopt/ci.js";
import { findTemplatesDir } from "../../src/generate/templates-dir.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const roots: string[] = [];
const links: string[] = [];

afterAll(() => {
  // node_modules へのリンクは、先にリンクだけを外す（リンク先の中身を消さない）
  for (const link of links.splice(0)) {
    try {
      rmdirSync(link);
    } catch {
      // 無ければ何もしない
    }
  }
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});

/** 一時のリポジトリのルート。.harness/scripts/baseline-check.mjs を置く */
function newRoot(dirs: string[]): string {
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "harness-smoke-baseline-")));
  roots.push(root);
  const script = path.join(root, ...BASELINE_SCRIPT_PATH.split("/"));
  mkdirSync(path.dirname(script), { recursive: true });
  writeFileSync(
    script,
    buildBaselineScript({ templatesDir: findTemplatesDir(), dirs, harnessVersion: "0.0.0" }),
  );
  return root;
}

function put(root: string, rel: string, text: string): void {
  const file = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

interface Result {
  status: number | null;
  out: string;
}

function baselineCheck(root: string, args: string[], env: Record<string, string> = {}): Result {
  const script = path.join(root, ...BASELINE_SCRIPT_PATH.split("/"));
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const readBaseline = (root: string): { apps: Record<string, Record<string, number | null>> } =>
  JSON.parse(readFileSync(path.join(root, ".harness", "baseline.json"), "utf8")) as {
    apps: Record<string, Record<string, number | null>>;
  };

// ---- 偽の道具 ----

const FAKE_ESLINT = `const path = require("node:path");
const e = Number(process.env.FAKE_ESLINT_ERROR ?? 0);
const w = Number(process.env.FAKE_ESLINT_WARNING ?? 0);
if (process.env.FAKE_ESLINT_EXIT !== undefined) process.exit(Number(process.env.FAKE_ESLINT_EXIT));
process.stdout.write(JSON.stringify([{ filePath: path.resolve("src", "a.js"), errorCount: e, warningCount: w }]));
process.exitCode = e > 0 ? 1 : 0;
`;
const FAKE_TSC = `const n = Number(process.env.FAKE_TSC_ERROR ?? 0);
const h = Number(process.env.FAKE_TSC_HARNESS ?? 0);
for (let i = 0; i < n; i += 1) console.log("src/a.ts(" + String(i + 1) + ",1): error TS2322: fake");
for (let i = 0; i < h; i += 1) console.log(".harness/x.ts(" + String(i + 1) + ",1): error TS2322: fake");
process.exitCode = n + h > 0 ? 1 : 0;
`;
const FAKE_PRETTIER = `const n = Number(process.env.FAKE_PRETTIER_FILES ?? 0);
for (let i = 0; i < n; i += 1) console.log("src/f" + String(i) + ".ts");
process.exitCode = n > 0 ? 1 : 0;
`;

function fakeTool(root: string, dir: string, pkg: string, bin: string, source: string): void {
  put(
    root,
    `${dir}/node_modules/${pkg}/package.json`,
    JSON.stringify({ name: pkg, bin: { [bin]: "bin.cjs" } }),
  );
  put(root, `${dir}/node_modules/${pkg}/bin.cjs`, source);
}

/** shared: ESLint・Prettier の設定をリポジトリの根に置く（アプリの直下には置かない） */
function fakeApp(dirs: string[] = ["app"], shared = false): string {
  const root = newRoot(dirs);
  for (const dir of dirs) {
    fakeTool(root, dir, "eslint", "eslint", FAKE_ESLINT);
    fakeTool(root, dir, "typescript", "tsc", FAKE_TSC);
    fakeTool(root, dir, "prettier", "prettier", FAKE_PRETTIER);
    put(root, `${dir}/tsconfig.json`, "{}\n");
    if (!shared) {
      put(root, `${dir}/eslint.config.mjs`, "export default [];\n");
      put(root, `${dir}/.prettierrc`, "{}\n");
    }
  }
  if (shared) {
    put(root, "eslint.config.mjs", "export default [];\n");
    put(root, "package.json", JSON.stringify({ prettier: {} }));
  }
  return root;
}

const counts = (e: number, w: number, t: number, p: number): Record<string, string> => ({
  FAKE_ESLINT_ERROR: String(e),
  FAKE_ESLINT_WARNING: String(w),
  FAKE_TSC_ERROR: String(t),
  FAKE_PRETTIER_FILES: String(p),
});

describe("#21 smoke：偽の道具で、基準線の流れを確かめる", () => {
  it("--init → 同じ件数は通る → 1件増えると失敗 → 減ると通って案内 → --update で下がる", () => {
    const root = fakeApp();

    // baseline.json が無い：失敗し、作り方を出す
    const none = baselineCheck(root, [], counts(2, 3, 4, 5));
    expect(none.status).not.toBe(0);
    expect(none.out).toContain("--init");

    const init = baselineCheck(root, ["--init"], counts(2, 3, 4, 5));
    expect(init.status, init.out).toBe(0);
    expect(readBaseline(root).apps["app"]).toEqual({
      eslint_error: 2,
      eslint_warning: 3,
      tsc_error: 4,
      prettier_files: 5,
    });
    // 既にあるときの --init は、上書きしない
    expect(baselineCheck(root, ["--init"], counts(0, 0, 0, 0)).status).not.toBe(0);
    expect(readBaseline(root).apps["app"]?.["eslint_error"]).toBe(2);

    // 同じ
    expect(baselineCheck(root, [], counts(2, 3, 4, 5)).status).toBe(0);

    // 種類ごとに、1件増えると失敗する
    for (const [e, w, t, p] of [
      [3, 3, 4, 5],
      [2, 4, 4, 5],
      [2, 3, 5, 5],
      [2, 3, 4, 6],
    ] as const) {
      const r = baselineCheck(root, [], counts(e, w, t, p));
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain("app");
      expect(r.out).not.toContain("fake");
      expect(r.out).not.toContain("a.ts");
    }

    // 減ると通り、下げる案内が出る
    const less = baselineCheck(root, [], counts(1, 3, 4, 5));
    expect(less.status, less.out).toBe(0);
    expect(less.out).toContain("--update");

    // 増えた値があると、--update は書かず失敗する（ほかが減っていても）
    const mixed = baselineCheck(root, ["--update"], counts(0, 9, 4, 5));
    expect(mixed.status).not.toBe(0);
    expect(readBaseline(root).apps["app"]?.["eslint_error"]).toBe(2);
    expect(readBaseline(root).apps["app"]?.["eslint_warning"]).toBe(3);

    // 減っただけなら、--update で下がる。その後は、新しい件数が基準線
    const lowered = baselineCheck(root, ["--update"], counts(1, 3, 4, 5));
    expect(lowered.status, lowered.out).toBe(0);
    expect(readBaseline(root).apps["app"]?.["eslint_error"]).toBe(1);
    expect(baselineCheck(root, [], counts(2, 3, 4, 5)).status).not.toBe(0);

    // 上げるのは --allow-increase のときだけ。ADR と承認の案内が出る
    const raised = baselineCheck(root, ["--update", "--allow-increase"], counts(2, 3, 4, 5));
    expect(raised.status, raised.out).toBe(0);
    expect(raised.out).toContain("ADR");
    expect(readBaseline(root).apps["app"]?.["eslint_error"]).toBe(2);
  });

  it("道具が異常終了・出力が読めない：0 件にせず失敗する。道具の出力・ソースは表示しない", () => {
    const root = fakeApp();
    expect(baselineCheck(root, ["--init"], counts(1, 1, 1, 1)).status).toBe(0);
    const crashed = baselineCheck(root, [], { ...counts(1, 1, 1, 1), FAKE_ESLINT_EXIT: "2" });
    expect(crashed.status).not.toBe(0);
    expect(crashed.out).toContain("ESLint");
    // --init も、測れなければ書かない
    const other = fakeApp();
    const failedInit = baselineCheck(other, ["--init"], { FAKE_ESLINT_EXIT: "2" });
    expect(failedInit.status).not.toBe(0);
    expect(existsSync(path.join(other, ".harness", "baseline.json"))).toBe(false);
  });

  it("道具が無くなった（数値だった項目が測れない）：失敗する。道具と設定が無い項目は対象外（null）", () => {
    const root = fakeApp();
    expect(baselineCheck(root, ["--init"], counts(1, 0, 0, 0)).status).toBe(0);
    rmSync(path.join(root, "app", "node_modules", "prettier"), { recursive: true, force: true });
    const r = baselineCheck(root, [], counts(1, 0, 0, 0));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Prettier");

    const bare = newRoot(["app"]);
    mkdirSync(path.join(bare, "app"));
    expect(baselineCheck(bare, ["--init"]).status).toBe(0);
    expect(readBaseline(bare).apps["app"]).toEqual({
      eslint_error: null,
      eslint_warning: null,
      tsc_error: null,
      prettier_files: null,
    });
    expect(baselineCheck(bare, []).status).toBe(0);
  });

  it("tsc の出力が .harness/ の下の診断だけ：0 件で通る。混在するときは、除いた数を使う", () => {
    const root = fakeApp();
    const only = baselineCheck(root, ["--init"], { FAKE_TSC_HARNESS: "2" });
    expect(only.status, only.out).toBe(0);
    expect(readBaseline(root).apps["app"]?.["tsc_error"]).toBe(0);
    expect(baselineCheck(root, [], { FAKE_TSC_HARNESS: "3" }).status).toBe(0);
    const mixed = baselineCheck(root, [], { FAKE_TSC_HARNESS: "2", FAKE_TSC_ERROR: "1" });
    expect(mixed.status).not.toBe(0);
    const other = fakeApp();
    expect(
      baselineCheck(other, ["--init"], { FAKE_TSC_HARNESS: "2", FAKE_TSC_ERROR: "1" }).status,
    ).toBe(0);
    expect(readBaseline(other).apps["app"]?.["tsc_error"]).toBe(1);
  });

  it("リポジトリの根の共有設定を使うアプリ（アプリごとに node_modules）：測れて、増えると失敗する", () => {
    const root = fakeApp(["a", "b"], true);
    const init = baselineCheck(root, ["--init"], counts(1, 1, 1, 1));
    expect(init.status, init.out).toBe(0);
    for (const d of ["a", "b"]) {
      expect(readBaseline(root).apps[d]).toEqual({
        eslint_error: 1,
        eslint_warning: 1,
        tsc_error: 1,
        prettier_files: 1,
      });
    }
    expect(baselineCheck(root, [], counts(1, 1, 1, 1)).status).toBe(0);
    expect(baselineCheck(root, [], counts(2, 1, 1, 1)).status).not.toBe(0);
    expect(baselineCheck(root, [], counts(1, 1, 1, 2)).status).not.toBe(0);
  });

  it("__proto__ というフォルダも記録され、増えると失敗する", () => {
    const root = fakeApp(["__proto__"]);
    expect(baselineCheck(root, ["--init"], counts(1, 0, 0, 0)).status).toBe(0);
    const text = readFileSync(path.join(root, ".harness", "baseline.json"), "utf8");
    expect(text).toContain('"__proto__"');
    expect(baselineCheck(root, [], counts(1, 0, 0, 0)).status).toBe(0);
    expect(baselineCheck(root, [], counts(2, 0, 0, 0)).status).not.toBe(0);
    expect(baselineCheck(root, ["--update"], counts(2, 0, 0, 0)).status).not.toBe(0);
  });

  it("baseline.json が壊れている・版が違う：失敗する", () => {
    const root = fakeApp();
    put(root, ".harness/baseline.json", "{ broken");
    expect(baselineCheck(root, [], counts(0, 0, 0, 0)).status).not.toBe(0);
    put(root, ".harness/baseline.json", JSON.stringify({ version: 9, apps: {} }));
    expect(baselineCheck(root, [], counts(0, 0, 0, 0)).status).not.toBe(0);
  });
});

// ---- 本物の道具（このリポジトリの開発依存）----

function realApp(): string {
  const root = newRoot(["app"]);
  mkdirSync(path.join(root, "app"), { recursive: true });
  const link = path.join(root, "app", "node_modules");
  symlinkSync(path.join(REPO, "node_modules"), link, "junction");
  links.push(link);
  // どのファイル（.mjs を含む）でも console.log を警告にする：.harness/ の下のスクリプトが数えられるなら、件数が増える
  put(
    root,
    "app/eslint.config.mjs",
    'export default [{ files: ["**/*.js", "**/*.mjs"], rules: { "no-unused-vars": "error", "no-console": "warn" } }];\n',
  );
  put(
    root,
    "app/tsconfig.json",
    '{\n  "compilerOptions": { "noEmit": true, "strict": true, "target": "es2022", "module": "esnext", "moduleResolution": "bundler", "types": [] },\n  "include": ["src"]\n}\n',
  );
  put(root, "app/.prettierrc", "{}\n");
  put(root, "app/src/a.js", 'var unused = 1;\nconsole.log("x");\n');
  put(root, "app/src/b.ts", 'export const n: number = "x";\n');
  put(root, "app/src/c.js", "export   const   c=1\n");
  // ハーネス自身のファイルは、整形されていなくても数えない
  put(root, "app/.harness/config.yaml", "a:     1\nb:    [1,2]\n");
  put(root, "app/.harness/scripts/other.mjs", 'console.log( "x" )\n');
  return root;
}

describe("#21 smoke：本物の ESLint・tsc・Prettier で、架空のアプリを測る", () => {
  it("--init の直後に比べて通る（baseline.json・スクリプト・.harness/ の下は数えない）。違反を1つ足すと失敗する", () => {
    const root = realApp();
    const init = baselineCheck(root, ["--init"]);
    expect(init.status, init.out).toBe(0);
    const recorded = readBaseline(root).apps["app"];
    expect(recorded?.["eslint_error"]).toBe(1);
    expect(recorded?.["eslint_warning"]).toBe(1);
    expect(recorded?.["tsc_error"]).toBe(1);
    expect(typeof recorded?.["prettier_files"]).toBe("number");
    expect(recorded?.["prettier_files"]).toBeGreaterThanOrEqual(1);
    // 表示に、ソースの中身は出ない
    expect(init.out).not.toContain("unused");
    expect(init.out).not.toContain('"x"');

    const same = baselineCheck(root, []);
    expect(same.status, same.out).toBe(0);

    // ESLint の warning を1つ足す
    put(root, "app/src/d.js", 'console.log("y");\n');
    const worse = baselineCheck(root, []);
    expect(worse.status, worse.out).not.toBe(0);
    expect(worse.out).toContain("ESLint");
    expect(worse.out).not.toContain('"y"');
  });
});
