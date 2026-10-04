// Docker Compose に渡す環境とプロジェクトを選択したローカル環境だけに固定する。
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  applyLocalEnvironment,
  loadLocalEnvironment,
  LocalEnvironmentError,
  type LocalEnvironment,
} from "./local-env.ts";

const [environment, ...args] = process.argv.slice(2);
try {
  const values = loadLocalEnvironment(environment as LocalEnvironment);
  if (
    args.some((arg) =>
      /^(?:--env-file|--project-name|-p|-f|--file|--project-directory|--profile)(?:=|$)/.test(
        arg,
      ),
    )
  ) {
    throw new LocalEnvironmentError(
      "Docker Compose の環境とプロジェクトは変更できません。",
    );
  }
  applyLocalEnvironment(values);
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    name: string;
  };
  const project = environment === "test" ? `${pkg.name}-test` : pkg.name;
  console.log(`環境：${environment}`);
  const command = process.platform === "win32" ? "docker.exe" : "docker";
  const child = spawn(
    command,
    ["compose", "--env-file", `.env.${environment}`, "-p", project, ...args],
    {
      stdio: "inherit",
      windowsHide: true,
      env: process.env,
    },
  );
  child.on("error", () => {
    console.error("Docker Compose を起動できません（値は表示しません）。");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(
    error instanceof LocalEnvironmentError
      ? error.message
      : "設定または起動の確認に失敗しました（値は表示しません）。",
  );
  process.exitCode = 1;
}
