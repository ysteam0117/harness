import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import {
  applyLocalEnvironment,
  assertNoDevVars,
  clearInheritedEnvironment,
  loadLocalEnvironment,
  type LocalEnvironment,
} from "./scripts/local-env.ts";

// Vite の共通 .env 自動読込を止め、手元は明示した1環境だけを使う。
// バックエンドは Spring Boot（別のプロセス）。画面からの /api は、Vite の proxy でバックエンドへ中継する。
// 中継先の既定は http://localhost:8080（backend/src/main/resources/application.yaml の server.port と合わせる）。
// 変えるときは、.env.development に HARNESS_API_ORIGIN を書く。
export default defineConfig(({ command }) => {
  if (command === "build") {
    assertNoDevVars();
    clearInheritedEnvironment();
    return {
      envDir: "./node_modules/.harness-env-disabled",
      plugins: [react()],
    };
  }
  const environment = process.env.HARNESS_APP_ENV as LocalEnvironment;
  const values = loadLocalEnvironment(environment);
  applyLocalEnvironment(values);
  console.log(`環境：${environment}`);
  const proxy = {
    "/api": {
      target: process.env.HARNESS_API_ORIGIN ?? "http://localhost:8080",
    },
  };
  return {
    envDir: "./node_modules/.harness-env-disabled",
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
  };
});
