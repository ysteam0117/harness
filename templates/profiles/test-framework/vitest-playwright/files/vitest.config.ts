import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// バックエンドは本番と同じ実行エンジン（workerd）で、フロントエンドは jsdom で動かす
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } }),
        ],
        test: {
          name: "backend",
          include: ["backend/**/*.test.ts"],
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
});
