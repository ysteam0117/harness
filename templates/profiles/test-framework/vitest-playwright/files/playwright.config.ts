import { defineConfig } from "@playwright/test";

// E2E（C-24）。検証用の開発サーバー（npm run dev:test）を必ず起動する。接続先は切り替えない（C-40）。
// DB の初期化は、サーバーを起動する前に走る pretest:e2e が行う。失敗したら、まずトレースを確認する
export default defineConfig({
  testDir: "e2e",
  retries: 0, // 自動で再試行しない（C-25）
  use: {
    baseURL: "http://localhost:{{e2e_port}}",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npm run dev:test -- --port {{e2e_port}} --strictPort",
    url: "http://localhost:{{e2e_port}}/api/health",
    reuseExistingServer: false, // すでに動いているサーバーに、検証を向けない
    timeout: 120_000,
  },
});
