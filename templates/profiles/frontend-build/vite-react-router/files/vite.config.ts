import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import {
  applyLocalEnvironment,
  assertNoDevVars,
  clearInheritedEnvironment,
  loadLocalEnvironment,
  localStatePath,
  readWorkerConfig,
  type LocalEnvironment,
} from "./scripts/local-env.ts";

// Vite の共通 .env 自動読込を止め、手元は明示した1環境だけを使う。
export default defineConfig(({ command }) => {
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
  process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = "false";
  if (command === "build") {
    assertNoDevVars();
    readWorkerConfig();
    clearInheritedEnvironment();
    return {
      envDir: "./node_modules/.harness-env-disabled",
      plugins: [react(), cloudflare({ remoteBindings: false })],
    };
  }
  const environment = process.env.HARNESS_APP_ENV as LocalEnvironment;
  const values = loadLocalEnvironment(environment);
  applyLocalEnvironment(values);
  const bindings = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key] ?? values[key]]),
  );
  console.log(`環境：${environment}`);
  return {
    envDir: "./node_modules/.harness-env-disabled",
    plugins: [
      react(),
      cloudflare({
        config: { vars: bindings },
        persistState: { path: localStatePath(environment) },
        remoteBindings: false,
      }),
    ],
  };
});
