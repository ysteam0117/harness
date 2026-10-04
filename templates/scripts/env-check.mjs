// 項目の名前と環境だけを表示する。値は表示しない（C-05・C-40）。
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { loadLocalEnvironment, LocalEnvironmentError } from "./local-env.ts";

try {
  const environment = process.argv[2] ?? "development";
  const actual = loadLocalEnvironment(environment);
  console.log(`環境：${environment}`);
  const expected = parseEnv(readFileSync(".env.example", "utf8"));
  const missing = Object.keys(expected).filter((key) => !actual[key]?.trim());
  if (missing.length) {
    console.log(`足りない項目：${missing.join(", ")}`);
    process.exitCode = 1;
  } else console.log("足りない項目はありません。");
} catch (error) {
  console.error(
    error instanceof LocalEnvironmentError
      ? error.message
      : "設定の確認に失敗しました（値は表示しません）。",
  );
  process.exitCode = 1;
}
