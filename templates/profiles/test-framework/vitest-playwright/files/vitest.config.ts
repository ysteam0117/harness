import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";

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
          },
        },
      ],
    },
  };
});
