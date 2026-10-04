import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import {
  applyLocalEnvironment,
  loadLocalEnvironment,
} from "./scripts/local-env.ts";

// pg は Workers のテスト内で読み込めない。DB 自体の確認はテスト用起動への API テストで行う。
const values = loadLocalEnvironment("test");
applyLocalEnvironment(values);

// バックエンドは本番と同じ実行エンジン（workerd）で、フロントエンドは jsdom で動かす
export default defineConfig({
  envDir: "./node_modules/.harness-env-disabled",
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: values },
          }),
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
