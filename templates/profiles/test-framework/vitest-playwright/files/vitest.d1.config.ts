import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import {
  applyLocalEnvironment,
  loadLocalEnvironment,
} from "./scripts/local-env.ts";

const values = loadLocalEnvironment("test");
applyLocalEnvironment(values);

// バックエンドは本番と同じ実行エンジン（workerd）で、フロントエンドは jsdom で動かす
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./backend/db/migrations");
  return {
    envDir: "./node_modules/.harness-env-disabled",
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: { ...values, TEST_MIGRATIONS: migrations },
              },
            }),
          ],
          test: {
            name: "backend",
            include: ["backend/**/*.test.ts"],
            setupFiles: ["./backend/test/apply-migrations.ts"],
          },
        },
        {
          plugins: [react()],
          test: {
            name: "frontend",
            include: ["frontend/**/*.test.{ts,tsx}"],
            environment: "jsdom",
            setupFiles: ["./frontend/src/test/setup.ts"],
          },
        },
      ],
    },
  };
});
