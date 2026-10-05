// 子プロセスへ渡す前に設定を検証する。Windows でも外部ウィンドウを作らない。
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyLocalEnvironment,
  assertNoDevVars,
  clearInheritedEnvironment,
  loadLocalEnvironment,
  LocalEnvironmentError,
  readWorkerConfig,
  type LocalEnvironment,
} from "./local-env.ts";

const [environment, tool, ...args] = process.argv.slice(2);
try {
  if (environment === "build") {
    assertNoDevVars();
    readWorkerConfig();
    clearInheritedEnvironment();
  } else {
    const values = loadLocalEnvironment(environment as LocalEnvironment);
    applyLocalEnvironment(values);
    console.log(`環境：${values.APP_ENV}`);
  }
  if (
    args.some(
      (arg) => arg === "--" + "remote" || arg.startsWith("--" + "remote="),
    )
  )
    throw new Error("手元の実行で remote は使えません。");
  // 道具の名前 → パッケージ名（名前が違うものだけ。playwright の実体は @playwright/test）
  const packages: Record<string, string> = {
    vite: "vite",
    vitest: "vitest",
    wrangler: "wrangler",
    "drizzle-kit": "drizzle-kit",
    playwright: "@playwright/test",
  };
  if (!Object.hasOwn(packages, tool))
    throw new Error("起動する道具が不正です。");
  const packageDir = path.resolve("node_modules", ...packages[tool].split("/"));
  const pkg = JSON.parse(
    readFileSync(path.join(packageDir, "package.json"), "utf8"),
  );
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin[tool];
  const child = spawn(process.execPath, [path.join(packageDir, bin), ...args], {
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  });
  child.on("error", () => {
    console.error("起動に失敗しました（値は表示しません）。");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => child.kill(signal));
} catch (error) {
  console.error(
    error instanceof LocalEnvironmentError
      ? error.message
      : "設定または起動の確認に失敗しました（値は表示しません）。",
  );
  process.exitCode = 1;
}
