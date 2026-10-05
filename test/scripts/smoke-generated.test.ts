// #56 AC-1・AC-2・R4・R5：生成したプロジェクトが動くことを確かめるスクリプト（scripts/smoke-generated.ts）の部品の単体のテスト。
// 実際の実行（npm install・npm run check・開発サーバー・docker compose）は CI（ubuntu）で行う。ここでは行わない。
//
// 想定する型・関数（scripts/smoke-generated.ts が export する。import しただけでは実行されない（pack-check.ts と同じ））
//
//   export type SmokeCase = {
//     id: "d1" | "postgresql" | "none";    // 通りの名前（失敗したときに示す）
//     database: "d1" | "postgresql" | "none";
//     auth: string;                         // 回答の auth
//     fileUpload: boolean;                  // 回答の file_upload が yes か
//     answersYaml: string;                  // harness create --answers に渡す YAML（架空の値だけ）
//   };
//   export const SMOKE_CASES: readonly SmokeCase[];     // 3 通り：D1・PostgreSQL・DB なし。アップロードあり・認証ありを1つは含める
//   export function buildAnswersYaml(over?: Record<string, unknown>): string;
//        // 架空の完全な回答（app_name は testapp-001）に over を重ねた YAML。parseAnswersYaml で読める形
//   export function pickFreePort(): Promise<number>;    // 今空いている、待ち受けできるポート
//   export function waitForOk(url: string, opts: { timeoutMs: number; intervalMs?: number }): Promise<void>;
//        // GET が 200 を返すまで待つ。時間内に返らなければ、URL を示した Error で reject
//   export function stopProcess(child: ChildProcess, opts?: { graceMs?: number }): Promise<void>;
//        // 子プロセスとその子孫を止め、終了するまで待つ（C-69）。既に終わっていてもエラーにしない
//   export class SmokeError extends Error { caseId: string; stage: string; }
//   export function runStage<T>(caseId: string, stage: string, fn: () => T | Promise<T>): Promise<T>;
//        // fn の失敗を、どの通り（caseId）・どの段階（stage）で失敗したかを示した SmokeError（cause に元の誤り）にして投げる
//   export function assertLocalDatabaseUrl(url: string): void;
//        // 接続先が手元（localhost・127.0.0.1・[::1]）でなければ、日本語の Error（接続先のホスト名を示す。パスワードは示さない）
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as smokeGenerated from "../../scripts/smoke-generated.js";
import { evaluateRules, loadRules } from "../../src/checks/rules.js";
import { parseAnswersYaml } from "../../src/questions/answers.js";
import { questionDefinitions } from "../../src/questions/definitions.js";
import { runQuestions } from "../../src/questions/flow.js";
import { FakePrompter } from "../questions/helpers.js";
import { contentOf, generated, parseEnvExample, type Combo } from "../generate/skeleton-helpers.js";
import {
  SMOKE_CASES,
  SmokeError,
  assertLocalDatabaseUrl,
  buildAnswersYaml,
  pickFreePort,
  runStage,
  stopProcess,
  waitForOk,
} from "../../scripts/smoke-generated.js";

const servers: http.Server[] = [];
const children: { pid?: number; kill: () => boolean }[] = [];
const envFolders: string[] = [];
const activeServerFolders = new Set<string>();

function envFolder(): string {
  // 生成された local-env.ts が repo の TypeScript 依存を解決できる場所に作る。
  const dir = mkdtempSync(path.join(path.resolve("test"), ".harness-smoke-env51-"));
  envFolders.push(dir);
  return dir;
}

function writeSmokeEnv(
  dir: string,
  environment: "development" | "test",
  values: Record<string, string>,
): void {
  const writer = (
    smokeGenerated as typeof smokeGenerated & {
      writeEnvFile?: (
        root: string,
        selected: "development" | "test",
        overrides: Record<string, string>,
      ) => void;
    }
  ).writeEnvFile;
  expect(writer, "smoke の共通 writeEnvFile を export してください").toBeTypeOf("function");
  writer?.(dir, environment, values);
}

afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
  for (const c of children.splice(0)) {
    try {
      c.kill();
    } catch {
      /* 既に終わっている */
    }
  }
  const temporaryRoot = path.resolve("test");
  for (const dir of envFolders.splice(0)) {
    if (activeServerFolders.has(dir)) continue;
    if (!path.resolve(dir).startsWith(`${temporaryRoot}${path.sep}`))
      throw new Error("テスト用一時フォルダの外は削除しません");
    rmSync(dir, { recursive: true, force: true });
  }
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("#51 AC-3: smoke の .env.development/.env.test は認証欄を必要なときだけ補完する", () => {
  const combos: Combo[] = [
    { auth: "oidc", database: "d1", upload: false, label: "smoke-env-d1" },
    { auth: "app", database: "postgresql", upload: false, label: "smoke-env-postgresql" },
    { auth: "none", database: "none", upload: false, label: "smoke-env-none" },
  ];

  it.each(combos)(
    "#51 AC-3: $database の生成例から test 環境を作り、env:check を通す",
    async (combo) => {
      const files = await generated(combo);
      const dir = envFolder();
      for (const name of [".env.example", "wrangler.jsonc"])
        writeFileSync(path.join(dir, name), contentOf(files, name));
      const scriptsDir = path.join(dir, "scripts");
      mkdirSync(scriptsDir);
      for (const name of ["env-check.mjs", "local-env.ts"])
        writeFileSync(path.join(scriptsDir, name), contentOf(files, `scripts/${name}`));
      const example = parseEnvExample(contentOf(files, ".env.example"));
      const values: Record<string, string> = {
        APP_ENV: "test",
        ALLOWED_ORIGINS: "http://localhost:5173",
      };
      for (const name of Object.keys(example)) {
        if (
          name in values ||
          ["SESSION_SECRET", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"].includes(name)
        )
          continue;
        values[name] =
          name === "POSTGRES_PORT"
            ? "5432"
            : name === "POSTGRES_DB"
              ? "app_test"
              : name === "POSTGRES_USER"
                ? "testuser_001"
                : name === "POSTGRES_PASSWORD"
                  ? "dummy_private_51"
                  : name === "DATABASE_URL" ||
                      name === "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"
                    ? "postgresql://testuser_001:dummy_private_51@localhost:5432/app_test"
                    : "dummy_example_51";
      }
      writeSmokeEnv(dir, "test", values);
      const written = parseEnvExample(readFileSync(path.join(dir, ".env.test"), "utf8"));
      for (const name of ["SESSION_SECRET", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]) {
        if (name in example) expect(written[name], name).toBeTruthy();
        else expect(written, name).not.toHaveProperty(name);
      }
      const result = spawnSync(process.execPath, [path.join(scriptsDir, "env-check.mjs"), "test"], {
        cwd: dir,
        encoding: "utf8",
        windowsHide: true,
      });
      expect(result.status, result.stdout + result.stderr).toBe(0);
    },
  );

  it("#51 AC-3: 明示値と例の非空値を保持し、Docker相当の再書込でも補完を維持する", () => {
    const dir = envFolder();
    writeFileSync(
      path.join(dir, ".env.example"),
      "APP_ENV=\nSESSION_SECRET=\nOIDC_CLIENT_ID=client-in-example\nOIDC_CLIENT_SECRET=\n",
    );
    writeSmokeEnv(dir, "development", {
      APP_ENV: "development",
      SESSION_SECRET: "explicit_dummy_51",
    });
    let written = parseEnvExample(readFileSync(path.join(dir, ".env.development"), "utf8"));
    expect(written.SESSION_SECRET).toBe("explicit_dummy_51");
    expect(written.OIDC_CLIENT_ID).toBe("client-in-example");
    expect(written.OIDC_CLIENT_SECRET).toBeTruthy();
    writeSmokeEnv(dir, "development", {
      APP_ENV: "development",
      SESSION_SECRET: "explicit_dummy_51",
      APP_PORT: "5174",
    });
    written = parseEnvExample(readFileSync(path.join(dir, ".env.development"), "utf8"));
    expect(written).toMatchObject({
      APP_ENV: "development",
      SESSION_SECRET: "explicit_dummy_51",
      OIDC_CLIENT_ID: "client-in-example",
      APP_PORT: "5174",
    });
    expect(written.OIDC_CLIENT_SECRET).toBeTruthy();
  });

  it("#51 AC-3: 開発とテストは別の架空の認証値を使う", () => {
    const dir = envFolder();
    writeFileSync(
      path.join(dir, ".env.example"),
      "APP_ENV=\nSESSION_SECRET=\nOIDC_CLIENT_ID=\nOIDC_CLIENT_SECRET=\n",
    );
    writeSmokeEnv(dir, "development", { APP_ENV: "development" });
    writeSmokeEnv(dir, "test", { APP_ENV: "test" });
    const dev = parseEnvExample(readFileSync(path.join(dir, ".env.development"), "utf8"));
    const test = parseEnvExample(readFileSync(path.join(dir, ".env.test"), "utf8"));
    expect(dev.APP_ENV).toBe("development");
    expect(test.APP_ENV).toBe("test");
    for (const name of ["SESSION_SECRET", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]) {
      expect(dev[name], name).toBeTruthy();
      expect(test[name], name).toBeTruthy();
      expect(dev[name], name).not.toBe(test[name]);
    }
  });

  it("#72 R2: OIDC の接続先の項目（OIDC_ISSUER・OIDC_REDIRECT_URI・APP_BASE_URL）も、開発・テストの両方に架空の値が入る", () => {
    const dir = envFolder();
    writeFileSync(
      path.join(dir, ".env.example"),
      "APP_ENV=\nOIDC_ISSUER=\nOIDC_REDIRECT_URI=\nAPP_BASE_URL=\n",
    );
    writeSmokeEnv(dir, "development", { APP_ENV: "development" });
    writeSmokeEnv(dir, "test", { APP_ENV: "test" });
    for (const file of [".env.development", ".env.test"]) {
      const written = parseEnvExample(readFileSync(path.join(dir, file), "utf8"));
      expect(written.OIDC_ISSUER, file).toBe("https://idp.example.test");
      expect(written.OIDC_REDIRECT_URI, file).toBe("http://localhost:5173/api/auth/oidc/callback");
      expect(written.APP_BASE_URL, file).toBe("http://localhost:5173");
    }
  });

  it("#72 R2: 例に値がある・明示した値がある OIDC の項目は、上書きしない", () => {
    const dir = envFolder();
    writeFileSync(
      path.join(dir, ".env.example"),
      "APP_ENV=\nOIDC_ISSUER=https://issuer-in-example.example.test\nAPP_BASE_URL=\n",
    );
    writeSmokeEnv(dir, "development", {
      APP_ENV: "development",
      APP_BASE_URL: "http://localhost:5199",
    });
    const written = parseEnvExample(readFileSync(path.join(dir, ".env.development"), "utf8"));
    expect(written.OIDC_ISSUER).toBe("https://issuer-in-example.example.test");
    expect(written.APP_BASE_URL).toBe("http://localhost:5199");
  });

  it("#51 AC-3: 認証以外の不足を無条件に埋めず、env:check は不足名で失敗する", () => {
    const dir = envFolder();
    writeFileSync(path.join(dir, ".env.example"), "APP_ENV=\nSESSION_SECRET=\nEXTRA_REQUIRED=\n");
    writeSmokeEnv(dir, "test", { APP_ENV: "test" });
    const written = parseEnvExample(readFileSync(path.join(dir, ".env.test"), "utf8"));
    expect(written.SESSION_SECRET).toBeTruthy();
    expect(written.EXTRA_REQUIRED).toBe("");
    const result = spawnSync(
      process.execPath,
      [path.resolve("templates/scripts/env-check.mjs"), "test"],
      {
        cwd: dir,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("EXTRA_REQUIRED");
  });
});

describe("#51 AC-2: smoke の開発サーバーは確保したIPv4アドレスで起動・確認する", () => {
  it.each(["development", "test"] as const)(
    "%s の起動引数とprobe URLを127.0.0.1へ揃える",
    async (environment) => {
      const dir = envFolder();
      activeServerFolders.add(dir);
      let server: { child: ChildProcess; port: number; url: string } | undefined;
      try {
        writeFileSync(
          path.join(dir, "package.json"),
          JSON.stringify({
            name: "smoke-test-server",
            version: "1.0.0",
            scripts: { dev: "node fake-server.cjs", "dev:test": "node fake-server.cjs" },
          }),
        );
        writeFileSync(
          path.join(dir, "fake-server.cjs"),
          `const http = require("node:http");
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync("server-args.json", JSON.stringify(args));
const port = Number(args[args.indexOf("--port") + 1]);
const host = args[args.indexOf("--host") + 1];
const server = http.createServer((_request, response) => {
  response.statusCode = 200;
  response.end("ok");
  response.on("finish", () => server.close());
});
server.listen(port, host);`,
        );
        const starter = (
          smokeGenerated as typeof smokeGenerated & {
            startDevServer?: (
              root: string,
              port: number,
              registry: { trackProcess(child: ChildProcess): void },
              selected: "development" | "test",
            ) => {
              child: ChildProcess;
              port: number;
              url: string;
            };
          }
        ).startDevServer;
        expect(starter, "startDevServer をテストできるよう export してください").toBeTypeOf(
          "function",
        );
        const port = await pickFreePort();
        server = starter?.(
          dir,
          port,
          {
            trackProcess(child) {
              children.push(child);
            },
          },
          environment,
        );
        expect(server?.url).toBe(`http://127.0.0.1:${port}`);
        if (server)
          await waitForOk(`${server.url}/api/health`, { timeoutMs: 5000, intervalMs: 50 });
        const args = JSON.parse(
          readFileSync(path.join(dir, "server-args.json"), "utf8"),
        ) as string[];
        expect(args).toContain("--strictPort");
        expect(args.slice(args.indexOf("--port"), args.indexOf("--port") + 2)).toEqual([
          "--port",
          String(port),
        ]);
        expect(args.slice(args.indexOf("--host"), args.indexOf("--host") + 2)).toEqual([
          "--host",
          "127.0.0.1",
        ]);
      } finally {
        if (server) {
          await stopProcess(server.child);
          const index = children.indexOf(server.child);
          if (index >= 0) children.splice(index, 1);
        }
        activeServerFolders.delete(dir);
      }
    },
    25_000,
  );
});

describe("#56 AC-1: 回答の YAML の生成（架空の値）", () => {
  it("#56 AC-1: 4 通り（D1・PostgreSQL・DB なし・既定の未定）で、アップロードあり・認証ありを1つは含む（#79：未定の通りを足した）", () => {
    expect(SMOKE_CASES.map((c) => c.id).sort()).toEqual(["d1", "none", "postgresql", "undecided"]);
    expect(SMOKE_CASES.map((c) => c.database).sort()).toEqual(["d1", "d1", "none", "postgresql"]);
    expect(SMOKE_CASES.some((c) => c.fileUpload)).toBe(true);
    expect(SMOKE_CASES.some((c) => c.auth !== "none")).toBe(true);
  });

  it("#56 AC-1: どの通りの YAML も、回答として読め、整合性チェックのエラーがなく、app_name は架空", async () => {
    const rules = loadRules();
    for (const c of SMOKE_CASES) {
      const parsed = parseAnswersYaml(c.answersYaml);
      expect(parsed.answers.app_name, c.id).toBe("testapp-001");
      expect(parsed.answers.database, c.id).toBe(c.database);
      const complete = await runQuestions(questionDefinitions, new FakePrompter(), parsed.answers);
      const result = evaluateRules(rules, complete, {
        versions_newer_than_verified: false,
        missing_tools: [],
        target_dir_not_empty: false,
        invalid_app_name: false,
      });
      expect(
        result.errors.map((e) => e.id),
        c.id,
      ).toEqual([]);
    }
  });

  it("#56 AC-1: 実在しうるメールアドレス・ドメインを含まない", () => {
    for (const c of SMOKE_CASES) {
      expect(c.answersYaml, c.id).not.toMatch(/gmail\.com|yahoo\.co\.jp|outlook\.com/);
      for (const m of c.answersYaml.matchAll(/[\w.+-]+@([\w-]+\.)+[A-Za-z]{2,}/g)) {
        expect(m[0]).toMatch(/@example\.(com|org|net)$/);
      }
    }
  });

  it("#79 AC-1: 未定の通りは、auth・file_upload を書かず、読めて、auth・file_upload は未定になる", async () => {
    const c = SMOKE_CASES.find((x) => x.id === "undecided");
    expect(c?.auth).toBe("undecided");
    const parsed = parseAnswersYaml(c?.answersYaml ?? "");
    for (const k of ["auth", "idp", "file_upload", "file_kinds", "admin", "collaborative"]) {
      expect(parsed.answers, k).not.toHaveProperty(k);
    }
    const complete = await runQuestions(questionDefinitions, new FakePrompter(), parsed.answers);
    expect(complete).toMatchObject({ auth: "undecided", file_upload: "undecided" });
  });

  it("#56 AC-1: buildAnswersYaml は、上書きした回答を反映する", () => {
    const parsed = parseAnswersYaml(buildAnswersYaml({ database: "none", auth: "none" }));
    expect(parsed.answers.database).toBe("none");
    expect(parsed.answers.auth).toBe("none");
    expect(parseAnswersYaml(buildAnswersYaml()).answers.app_name).toBe("testapp-001");
  });
});

describe("#56 R5: ポートと待ち合わせ", () => {
  it("#56 R5: pickFreePort は、待ち受けできる空いているポートを返す", async () => {
    const port = await pickFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
    await new Promise<void>((resolve, reject) => {
      const s = net.createServer();
      s.once("error", reject);
      s.listen(port, "127.0.0.1", () => s.close(() => resolve()));
    });
  });

  it("#56 R5: waitForOk は、あとから 200 を返し始めるサーバーを待って成功する", async () => {
    const port = await pickFreePort();
    const started = Date.now();
    const server = http.createServer((_req, res) => {
      res.statusCode = Date.now() - started > 300 ? 200 : 503;
      res.end("x");
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    await expect(
      waitForOk(`http://127.0.0.1:${port}/api/health`, { timeoutMs: 5000, intervalMs: 50 }),
    ).resolves.toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
  });

  it("#56 R5: waitForOk は、時間内に 200 にならなければ、URL を示して失敗する（つながらない場合も）", async () => {
    const port = await pickFreePort();
    const url = `http://127.0.0.1:${port}/api/health`;
    await expect(waitForOk(url, { timeoutMs: 300, intervalMs: 50 })).rejects.toThrow(
      new RegExp(`127\\.0\\.0\\.1:${port}`),
    );
    const server = http.createServer((_req, res) => {
      res.statusCode = 500;
      res.end("x");
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    await expect(waitForOk(url, { timeoutMs: 300, intervalMs: 50 })).rejects.toThrow(
      /127\.0\.0\.1/,
    );
  });
});

describe("#56 R5・C-69: プロセスの停止", () => {
  it("#56 C-69: stopProcess は、子プロセスを止めて、終了するまで待つ", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    children.push(child);
    const pid = child.pid as number;
    expect(alive(pid)).toBe(true);
    await stopProcess(child);
    expect(alive(pid)).toBe(false);
  });

  it("#56 C-69: stopProcess は、子孫のプロセスも止める（npm run dev が起動する workerd 等のため）", async () => {
    const script = `
      const { spawn } = require("node:child_process");
      const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      console.log("GRANDCHILD:" + g.pid);
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    children.push(child);
    const grandchild = await new Promise<number>((resolve, reject) => {
      let buf = "";
      child.stdout?.on("data", (d: Buffer) => {
        buf += d.toString();
        const m = /GRANDCHILD:(\d+)/.exec(buf);
        if (m) resolve(Number(m[1]));
      });
      child.once("error", reject);
      setTimeout(() => reject(new Error("孫のプロセスの pid を読めません")), 10000);
    });
    expect(alive(grandchild)).toBe(true);
    await stopProcess(child);
    expect(alive(grandchild)).toBe(false);
    expect(alive(child.pid as number)).toBe(false);
  });

  it("#56 C-69: stopProcess は、既に終わっているプロセスでもエラーにしない（2回呼んでもよい）", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    children.push(child);
    await new Promise((r) => child.once("exit", r));
    await expect(stopProcess(child)).resolves.toBeUndefined();
    await expect(stopProcess(child)).resolves.toBeUndefined();
  });
});

describe("#56 AC-2: 失敗したら、どの通り・どの段階かを示す", () => {
  it("#56 AC-2: runStage は、成功した値をそのまま返す", async () => {
    await expect(runStage("d1", "npm install", () => 42)).resolves.toBe(42);
    await expect(runStage("d1", "npm install", async () => "ok")).resolves.toBe("ok");
  });

  it("#56 AC-2: runStage は、失敗を SmokeError にして、通り・段階・元の誤りを持たせる", async () => {
    const original = new Error("元の誤り");
    const caught = await runStage("postgresql", "npm run check", () => {
      throw original;
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(caught).toBeInstanceOf(SmokeError);
    const e = caught as SmokeError;
    expect(e.caseId).toBe("postgresql");
    expect(e.stage).toBe("npm run check");
    expect(e.message).toContain("postgresql");
    expect(e.message).toContain("npm run check");
    expect(e.message).toContain("元の誤り");
    expect(e.cause).toBe(original);
  });

  it("#56 AC-2: runStage は、非同期の失敗も同じように示す", async () => {
    await expect(
      runStage("none", "開発サーバー", async () => {
        throw new Error("起動しません");
      }),
    ).rejects.toMatchObject({ caseId: "none", stage: "開発サーバー" });
  });
});

describe("#56 R4: 接続先が手元であることの確かめ", () => {
  it("#56 R4: localhost・127.0.0.1・[::1] は通す", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(() =>
        assertLocalDatabaseUrl(`postgres://testuser_001:changeme@${host}:5432/testapp_001`),
      ).not.toThrow();
    }
  });

  it("#56 R4: 手元でないホストは、ホスト名を示してエラー（パスワードは示さない）", () => {
    let message = "";
    try {
      assertLocalDatabaseUrl("postgres://testuser_001:placeholder-secret@db.test.invalid:5432/x");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/db\.test\.invalid/);
    expect(message).not.toContain("placeholder-secret");
  });

  it("#56 R4: 読めない接続先・空はエラー", () => {
    expect(() => assertLocalDatabaseUrl("")).toThrow();
    expect(() => assertLocalDatabaseUrl("not a url")).toThrow();
  });
});
