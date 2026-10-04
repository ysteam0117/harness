import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// バックエンドは本番と同じ実行エンジン（workerd）で、フロントエンドは jsdom で動かす
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./backend/db/migrations");
  return {
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
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
