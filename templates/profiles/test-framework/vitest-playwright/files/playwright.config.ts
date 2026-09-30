import { defineConfig } from "@playwright/test";

// E2E（C-24）。失敗したら、まずトレースを確認する
export default defineConfig({
  testDir: "e2e",
  retries: 0, // 自動で再試行しない（C-25）
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:{{e2e_port}}",
    trace: "retain-on-failure",
  },
});
