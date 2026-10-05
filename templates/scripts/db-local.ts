// DB 操作は選択した環境の接続先と保存先だけに向ける。
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  applyLocalEnvironment,
  loadLocalEnvironment,
  localStatePath,
  LocalEnvironmentError,
  type LocalEnvironment,
} from "./local-env.ts";

const [environment, operation, ...options] = process.argv.slice(2);
const run = (command: string, args: string[], input?: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
      windowsHide: true,
      env: process.env,
    });
    if (input !== undefined) child.stdin?.end(input);
    child.on("error", () =>
      reject(new Error("DB の道具を起動できません（値は表示しません）。")),
    );
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`DB 操作に失敗しました（終了コード ${String(code)}）。`),
          ),
    );
  });

async function main(): Promise<void> {
  const values = loadLocalEnvironment(environment as LocalEnvironment);
  applyLocalEnvironment(values);
  console.log(`環境：${environment}`);
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    name: string;
  };
  const postgres = Boolean(values.DATABASE_URL);
  const moduleBin = (name: string, binName = name): string => {
    const dir = path.resolve("node_modules", name);
    const data = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as {
      bin: string | Record<string, string>;
    };
    const bin = typeof data.bin === "string" ? data.bin : data.bin[binName];
    return path.join(dir, bin);
  };
  const wrangler = (args: string[]) =>
    run(process.execPath, [moduleBin("wrangler"), ...args]);
  const drizzle = (args: string[]) =>
    run(process.execPath, [moduleBin("drizzle-kit"), ...args]);
  const compose = (args: string[], input?: string) =>
    run(
      process.platform === "win32" ? "docker.exe" : "docker",
      [
        "compose",
        "--env-file",
        `.env.${environment}`,
        "-p",
        environment === "test" ? `${pkg.name}-test` : pkg.name,
        ...args,
      ],
      input,
    );
  const psql = (args: string[], input?: string) =>
    compose(
      ["exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", ...args],
      input,
    );
  if (operation === "generate") return drizzle(generateArgs(options));
  // E2E 用のシードは、e2e/seeds/ の下の SQL だけを、選択した環境の保存先へ流す
  if (operation === "seed-file") {
    const file = seedFile(options);
    if (postgres) return psql([], readFileSync(file, "utf8"));
    return wrangler([
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      localStatePath(environment as LocalEnvironment),
      "--file",
      file,
    ]);
  }
  if (options.length)
    throw new LocalEnvironmentError("DB 操作に追加の引数は指定できません。");
  if (postgres) {
    if (operation === "migrate") return drizzle(["migrate"]);
    if (operation === "seed")
      return psql([], readFileSync("backend/db/seeds/seed.sql", "utf8"));
    if (operation === "cleanup")
      return psql([], readFileSync("backend/db/seeds/cleanup.sql", "utf8"));
    if (operation === "reset") {
      await psql([
        "-c",
        "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
      ]);
      await drizzle(["migrate"]);
      return psql([], readFileSync("backend/db/seeds/seed.sql", "utf8"));
    }
  } else {
    const persist = [
      "--persist-to",
      localStatePath(environment as LocalEnvironment),
    ];
    if (operation === "migrate")
      return wrangler([
        "d1",
        "migrations",
        "apply",
        "DB",
        "--local",
        ...persist,
      ]);
    if (operation === "seed")
      return wrangler([
        "d1",
        "execute",
        "DB",
        "--local",
        ...persist,
        "--file",
        "backend/db/seeds/seed.sql",
      ]);
    if (operation === "cleanup")
      return wrangler([
        "d1",
        "execute",
        "DB",
        "--local",
        ...persist,
        "--file",
        "backend/db/seeds/cleanup.sql",
      ]);
    if (operation === "reset") {
      rmSync(
        path.join(localStatePath(environment as LocalEnvironment), "v3", "d1"),
        {
          recursive: true,
          force: true,
        },
      );
      await wrangler([
        "d1",
        "migrations",
        "apply",
        "DB",
        "--local",
        ...persist,
      ]);
      return wrangler([
        "d1",
        "execute",
        "DB",
        "--local",
        ...persist,
        "--file",
        "backend/db/seeds/seed.sql",
      ]);
    }
  }
  throw new Error("DB 操作の名前が不正です。");
}

function seedFile(options: string[]): string {
  const file = options[0] ?? "";
  if (options.length !== 1 || !/^e2e\/seeds\/[A-Za-z0-9_-]+\.sql$/.test(file)) {
    throw new LocalEnvironmentError(
      "seed-file は e2e/seeds/ の下の SQL ファイルを1つだけ指定できます。",
    );
  }
  return file;
}

function generateArgs(options: string[]): string[] {
  if (options.length === 0) return ["generate"];
  if (
    options.length !== 2 ||
    options[0] !== "--name" ||
    !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(options[1])
  ) {
    throw new LocalEnvironmentError(
      "db:generate は --name と英数字の名前だけを指定できます。",
    );
  }
  return ["generate", "--name", options[1]];
}

main().catch((error) => {
  console.error(
    error instanceof LocalEnvironmentError
      ? error.message
      : "DB 操作に失敗しました（値は表示しません）。",
  );
  process.exitCode = 1;
});
