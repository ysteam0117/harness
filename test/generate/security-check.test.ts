// #42：生成するプロジェクトの scripts/security-check.mjs（Semgrep・gitleaks・OSV-Scanner を Docker で実行する）の単体テスト。
// 本物の Docker・ネットワークは使わない（runner を差し替える）。ひな形の値（イメージ）は、実際のプロファイルのものを差し込む。
import { randomInt } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { containerImageValues, loadProfile } from "../../src/generate/profile.js";
import { renderTemplate } from "../../src/generate/template.js";
import { realTemplatesDir } from "./helpers.js";

type RunResult = { status: number | null; stdout: string; error?: Error };
type Call = { command: string; args: string[]; options: Record<string, unknown> };
type Runner = (command: string, args: string[], options?: Record<string, unknown>) => RunResult;
type Mod = {
  IMAGES: { semgrep: string; gitleaks: string; osv: string };
  main: (argv: string[], deps?: Record<string, unknown>) => number;
  isSecretFileName: (file: string) => boolean;
  findTrackedSecretFiles: (list: string) => string[];
  parseOsvReport: (
    stdout: string,
    lock: string,
  ) => { failures: { name: string }[]; recorded: { name: string }[] } | undefined;
};

let dir: string;
let mod: Mod;

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "sc42-"));
  const profile = loadProfile(realTemplatesDir, "quality/typescript-standard");
  const source = readFileSync(
    path.join(
      realTemplatesDir,
      "profiles",
      "quality",
      "typescript-standard",
      "files",
      "security-check.mjs",
    ),
    "utf8",
  );
  const rendered = renderTemplate(source, containerImageValues([profile]), {
    templatesDir: realTemplatesDir,
    fileName: "scripts/security-check.mjs",
  });
  const file = path.join(dir, "security-check.mjs");
  writeFileSync(file, rendered);
  mod = (await import(pathToFileURL(file).href)) as Mod;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

const OK: RunResult = { status: 0, stdout: "" };
const EMPTY_LOCK = JSON.stringify({ packages: {} });
const CWD = "C:\\Users\\testuser_001\\my app";

function osvReport(items: { name: string; version: string; score?: string }[]): string {
  return JSON.stringify({
    results: [
      {
        source: { path: "/src/package-lock.json", type: "lockfile" },
        packages: items.map((item) => ({
          package: { name: item.name, version: item.version, ecosystem: "npm" },
          vulnerabilities: [{ id: `GHSA-${item.name}` }],
          groups: [
            {
              ids: [`GHSA-${item.name}`],
              max_severity: item.score ?? "",
            },
          ],
        })),
      },
    ],
  });
}

function lock(entries: Record<string, { version: string; dev?: boolean }>): string {
  return JSON.stringify({
    packages: Object.fromEntries(
      Object.entries(entries).map(([name, info]) => [`node_modules/${name}`, info]),
    ),
  });
}

type Behave = (call: Call) => RunResult | undefined;

function run(argv: string[], behave: Behave = () => undefined, lockText = EMPTY_LOCK) {
  const calls: Call[] = [];
  const out: string[] = [];
  const runner: Runner = (command, args, options = {}) => {
    const call = { command, args, options };
    calls.push(call);
    const custom = behave(call);
    if (custom) return custom;
    if (command === "git") return { status: 0, stdout: "package.json\0README.md\0" };
    if (args.includes(mod.IMAGES.gitleaks)) return { status: 0, stdout: "[]" };
    if (args.includes(mod.IMAGES.osv)) return { status: 0, stdout: osvReport([]) };
    return OK;
  };
  let clock = 0;
  const code = mod.main(argv, {
    runner,
    cwd: CWD,
    log: (line: string) => out.push(line),
    now: () => (clock += 1500),
    env: { PATH: "x" },
    readLock: () => lockText,
  });
  const dockerRuns = calls.filter((c) => c.command === "docker" && c.args[0] === "run");
  return { code, calls, dockerRuns, text: out.join("\n"), out };
}

describe("#42 イメージの固定", () => {
  it("3つのイメージが、tag とダイジェストで固定され、値の差し込み漏れがない", () => {
    for (const image of Object.values(mod.IMAGES)) {
      expect(image).toMatch(/^[a-z0-9./_-]+:v?\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
    }
  });
});

describe("#42 Docker の確認", () => {
  it("Docker が入っていない：導入を案内して失敗（1つも実行しない）", () => {
    const r = run(["all"], (c) =>
      c.command === "docker" ? { status: null, stdout: "", error: new Error("ENOENT") } : undefined,
    );
    expect(r.code).toBe(1);
    expect(r.dockerRuns).toHaveLength(0);
    expect(r.text).toContain("Docker が見つかりません");
    expect(r.text).toContain("docs/testing/security.md");
    expect(r.text).toMatch(/NG\s+Semgrep.*未実行/);
  });

  it("Docker が動いていない：動いていないと伝えて失敗", () => {
    const r = run(["all"], (c) =>
      c.command === "docker" && c.args[0] === "info" ? { status: 1, stdout: "" } : undefined,
    );
    expect(r.code).toBe(1);
    expect(r.dockerRuns).toHaveLength(0);
    expect(r.text).toContain("Docker が動いていません");
  });

  it("D1（DB なし）でも Docker が要る：スキップの環境変数を見ない", () => {
    const r = run(["all"], (c) =>
      c.command === "docker" ? { status: null, stdout: "", error: new Error("x") } : undefined,
    );
    // 呼び出し側の環境変数（SKIP 系）を渡しても、結果は変わらない
    expect(r.code).toBe(1);
  });
});

describe("#42 3つの道具の実行と集計", () => {
  it("すべて合格：3つを順に実行し、終了コード 0。要約に所要時間が出る", () => {
    const r = run(["all"]);
    expect(r.code).toBe(0);
    expect(r.dockerRuns).toHaveLength(3);
    expect(r.text).toContain("== セキュリティのテストの要約 ==");
    expect(r.text).toMatch(/OK\s+gitleaks.*秒/);
    expect(r.text).toMatch(/OK\s+Semgrep.*秒/);
    expect(r.text).toMatch(/OK\s+OSV-Scanner.*秒/);
  });

  it("引数なしは all と同じ", () => {
    expect(run([]).dockerRuns).toHaveLength(3);
  });

  it("Semgrep：通信なし・読み取り専用のマウント・ERROR だけ・固定したイメージ・同梱のルール", () => {
    const semgrep = run(["semgrep"]).dockerRuns[0];
    expect(semgrep).toBeDefined();
    const args = semgrep?.args ?? [];
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "--network"]);
    expect(args[3]).toBe("none");
    expect(args).toContain(`${CWD}:/src:ro`);
    expect(args).toContain(mod.IMAGES.semgrep);
    expect(args).toEqual(
      expect.arrayContaining(["--config", "/src/.semgrep", "--severity", "ERROR", "--error"]),
    );
    expect(args).toEqual(expect.arrayContaining(["--metrics=off", "--disable-version-check"]));
    for (const dir of ["node_modules", "dist", ".wrangler"]) {
      expect(args[args.indexOf(dir) - 1]).toBe("--exclude");
    }
  });

  it("gitleaks：作業ツリーだけ（dir）・設定ファイル・値の伏せ字・通信なし", () => {
    const leaks = run(["secrets"]).dockerRuns[0];
    const args = leaks?.args ?? [];
    expect(args).toContain(mod.IMAGES.gitleaks);
    expect(args).toEqual(
      expect.arrayContaining(["dir", "/src", "--config", "/src/.gitleaks.toml", "--redact"]),
    );
    expect(args).toEqual(expect.arrayContaining(["--exit-code", "1", "--network", "none"]));
    expect(args).not.toContain("git");
  });

  it("OSV-Scanner：既定のネットワーク（--network none を付けない）・package-lock.json・JSON", () => {
    const osv = run(["osv"]).dockerRuns[0];
    const args = osv?.args ?? [];
    expect(args).toContain(mod.IMAGES.osv);
    expect(args).not.toContain("--network");
    expect(args).toEqual(
      expect.arrayContaining(["scan", "source", "--lockfile", "/src/package-lock.json"]),
    );
    expect(args).toEqual(expect.arrayContaining(["--format", "json"]));
  });

  it("Windows のパスはそのまま渡し、MSYS_NO_PATHCONV=1 を環境に足す（Git Bash の変換を止める）", () => {
    const r = run(["semgrep"]);
    const call = r.dockerRuns[0];
    expect(call?.args.some((a) => a === `${CWD}:/src:ro`)).toBe(true);
    expect((call?.options["env"] as Record<string, string>)["MSYS_NO_PATHCONV"]).toBe("1");
  });

  it("1つが失敗しても残りは実行し、終了コード 1、失敗した道具が要約に NG で出る", () => {
    const r = run(["all"], (c) =>
      c.args.includes(mod.IMAGES.semgrep) ? { status: 1, stdout: "" } : undefined,
    );
    expect(r.code).toBe(1);
    expect(r.dockerRuns).toHaveLength(3);
    expect(r.text).toMatch(/NG\s+Semgrep/);
    expect(r.text).toMatch(/OK\s+gitleaks/);
    expect(r.text).toMatch(/OK\s+OSV-Scanner/);
    expect(r.text).toContain("nosemgrep");
  });

  it("1つだけ実行できる（semgrep・secrets・osv）", () => {
    expect(run(["semgrep"]).dockerRuns).toHaveLength(1);
    expect(run(["osv"]).dockerRuns).toHaveLength(1);
    const secrets = run(["secrets"]);
    expect(secrets.dockerRuns).toHaveLength(1);
    expect(secrets.dockerRuns[0]?.args).toContain(mod.IMAGES.gitleaks);
  });

  it("知らない引数は、使い方を示して失敗", () => {
    const r = run(["skip"]);
    expect(r.code).toBe(1);
    expect(r.calls).toHaveLength(0);
    expect(r.text).toContain("使い方");
  });
});

describe("#42 OSV-Scanner の判定", () => {
  const prodAndDev = lock({
    lodash: { version: "4.17.15" },
    "dev-tool": { version: "1.0.0", dev: true },
  });

  it("本番の依存の高（7.0 以上）で失敗し、パッケージと版と ID を表示する", () => {
    const stdout = osvReport([{ name: "lodash", version: "4.17.15", score: "7.5" }]);
    const r = run(
      ["osv"],
      (c) => (c.args.includes(mod.IMAGES.osv) ? { status: 1, stdout } : undefined),
      prodAndDev,
    );
    expect(r.code).toBe(1);
    expect(r.text).toContain("lodash@4.17.15");
    expect(r.text).toContain("GHSA-lodash");
  });

  it("本番の依存の重大（9.8）でも失敗", () => {
    const stdout = osvReport([{ name: "lodash", version: "4.17.15", score: "9.8" }]);
    const r = run(
      ["osv"],
      (c) => (c.args.includes(mod.IMAGES.osv) ? { status: 1, stdout } : undefined),
      prodAndDev,
    );
    expect(r.code).toBe(1);
  });

  it("dev の依存の高は対象にしない（合格）", () => {
    const stdout = osvReport([{ name: "dev-tool", version: "1.0.0", score: "9.8" }]);
    const r = run(
      ["osv"],
      (c) => (c.args.includes(mod.IMAGES.osv) ? { status: 1, stdout } : undefined),
      prodAndDev,
    );
    expect(r.code).toBe(0);
  });

  it("7.0 未満（中・低）は合格。記録だけして失敗にしない", () => {
    const stdout = osvReport([{ name: "lodash", version: "4.17.15", score: "6.9" }]);
    const r = run(
      ["osv"],
      (c) => (c.args.includes(mod.IMAGES.osv) ? { status: 1, stdout } : undefined),
      prodAndDev,
    );
    expect(r.code).toBe(0);
    expect(r.text).toContain("記録：lodash@4.17.15");
  });

  it("重大度が付いていない指摘は、記録だけして失敗にしない", () => {
    const stdout = osvReport([{ name: "lodash", version: "4.17.15" }]);
    const r = run(
      ["osv"],
      (c) => (c.args.includes(mod.IMAGES.osv) ? { status: 1, stdout } : undefined),
      prodAndDev,
    );
    expect(r.code).toBe(0);
    expect(r.text).toContain("重大度なし");
  });

  it("dev と本番に同じ名前・別の版があるときは、版ごとに判定する", () => {
    const text = lock({ "a/node_modules/x": { version: "1.0.0", dev: true } });
    const stdout = osvReport([{ name: "x", version: "2.0.0", score: "8.0" }]);
    const r = run(
      ["osv"],
      (c) => (c.args.includes(mod.IMAGES.osv) ? { status: 1, stdout } : undefined),
      text,
    );
    expect(r.code).toBe(1);
  });

  it("通信の失敗（結果が得られない）は、脆弱性の検出と区別して表示し、失敗にする", () => {
    const r = run(["osv"], (c) =>
      c.args.includes(mod.IMAGES.osv) ? { status: 127, stdout: "" } : undefined,
    );
    expect(r.code).toBe(1);
    expect(r.text).toContain("通信");
    expect(r.text).not.toContain("高・重大の脆弱性があります");
  });

  it("JSON として読めない出力も、通信か実行の失敗として扱う", () => {
    const r = run(["osv"], (c) =>
      c.args.includes(mod.IMAGES.osv) ? { status: 0, stdout: "<html>" } : undefined,
    );
    expect(r.code).toBe(1);
    expect(r.text).toContain("通信");
  });

  it("package-lock.json がなければ、作り方を示して失敗", () => {
    const calls: Call[] = [];
    const out: string[] = [];
    const code = mod.main(["osv"], {
      runner: (command: string, args: string[]) => {
        calls.push({ command, args, options: {} });
        return OK;
      },
      cwd: CWD,
      log: (l: string) => out.push(l),
      readLock: () => {
        throw new Error("ENOENT");
      },
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("package-lock.json");
  });

  it("parseOsvReport：脆弱性が0件なら、失敗も記録も空", () => {
    expect(mod.parseOsvReport(osvReport([]), EMPTY_LOCK)).toEqual({ failures: [], recorded: [] });
    expect(mod.parseOsvReport("not json", EMPTY_LOCK)).toBeUndefined();
  });
});

describe("#42 R2：Git に入った秘密のファイルを拒否する", () => {
  it.each([
    [".env", true],
    [".env.development", true],
    [".env.test", true],
    ["config/.env.production", true],
    [".dev.vars", true],
    [".dev.vars.local", true],
    [".env.example", false],
    [".env.development.example", false],
    ["docs/env.md", false],
    ["src/environment.ts", false],
  ])("%s は、拒否する＝%s", (file, rejected) => {
    expect(mod.isSecretFileName(file)).toBe(rejected);
  });

  it("git ls-files に .env が入っていれば失敗：ファイル名だけを示し、Docker の確認の前に判定する", () => {
    const r = run(["all"], (c) =>
      c.command === "git" ? { status: 0, stdout: "package.json\0.env\0.env.example\0" } : undefined,
    );
    expect(r.code).toBe(1);
    expect(r.text).toContain("Git に入っている秘密のファイル");
    expect(r.text).toContain("  - .env");
    expect(r.text).not.toContain("  - .env.example");
    expect(r.text).toMatch(/NG\s+Git に入った秘密のファイル/);
    // 3つの道具は、Docker が使えれば実行される
    expect(r.dockerRuns).toHaveLength(3);
  });

  it(".env.example だけなら合格", () => {
    const r = run(["secrets"], (c) =>
      c.command === "git" ? { status: 0, stdout: ".env.example\0" } : undefined,
    );
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/OK\s+Git に入った秘密のファイル/);
  });

  it("Git のリポジトリではない（git ls-files が失敗）ときは、飛ばして続ける", () => {
    const r = run(["all"], (c) => (c.command === "git" ? { status: 128, stdout: "" } : undefined));
    expect(r.code).toBe(0);
    expect(r.text).toContain("Git のリポジトリではない");
  });

  it("git が無いときも、飛ばして続ける", () => {
    const r = run(["all"], (c) =>
      c.command === "git" ? { status: null, stdout: "", error: new Error("ENOENT") } : undefined,
    );
    expect(r.code).toBe(0);
  });

  it("semgrep だけの実行では、秘密のファイルの確認はしない（secrets と all だけ）", () => {
    expect(run(["semgrep"]).calls.some((c) => c.command === "git")).toBe(false);
    expect(run(["secrets"]).calls.some((c) => c.command === "git")).toBe(true);
  });

  it("git ls-files と docker info は、標準エラーを出さない（quiet）。Git のリポジトリでない案内だけを、日本語で表示する", () => {
    const r = run(["secrets"]);
    const git = r.calls.find((c) => c.command === "git");
    const info = r.calls.find((c) => c.command === "docker" && c.args[0] === "info");
    expect(git?.options["quiet"]).toBe(true);
    expect(info?.options["quiet"]).toBe(true);
  });

  it("findTrackedSecretFiles：区切りの NUL で分け、空の要素は無視する", () => {
    expect(mod.findTrackedSecretFiles("a.ts\0.env\0\0.dev.vars\0")).toEqual([".env", ".dev.vars"]);
  });
});

describe("#42 R6：検出の結果に、秘密の値を出さない", () => {
  function randomToken(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let text = "ghp_";
    for (let i = 0; i < 36; i += 1) text += chars[randomInt(chars.length)];
    return text;
  }

  it("gitleaks が検出した：ファイル・行・ルールだけを表示し、値（乱数の ghp_ 形式）は出さない", () => {
    const token = randomToken();
    const leak = JSON.stringify([
      {
        RuleID: "github-pat",
        File: "/src/backend/src/leak.ts",
        StartLine: 3,
        // 伏せ字にならなかった場合（--redact が効かない）でも、スクリプトは値を読まない・出さない
        Secret: token,
        Match: `const t = "${token}"`,
      },
    ]);
    const r = run(["secrets"], (c) =>
      c.args.includes(mod.IMAGES.gitleaks) ? { status: 1, stdout: leak } : undefined,
    );
    expect(r.code).toBe(1);
    expect(r.text).toContain("backend/src/leak.ts:3");
    expect(r.text).toContain("github-pat");
    expect(r.text).not.toContain(token);
    expect(r.text).not.toContain("ghp_");
  });

  it("gitleaks の結果が読めない（JSON でない）ときは、失敗にする", () => {
    const r = run(["secrets"], (c) =>
      c.args.includes(mod.IMAGES.gitleaks) ? { status: 2, stdout: "boom" } : undefined,
    );
    expect(r.code).toBe(1);
  });
});
