import { randomUUID } from "node:crypto";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// バックエンドのテストは DB につながない（pg は Workers のテストの道具の中では動かないため、DB の処理は差し替える）。
// Hyperdrive の手元の接続先は、起動のために形だけ必要（ユーザー名とパスワードも要る）。つながないので、
// パスワードは毎回作る使い捨ての値にして、ファイルには書かない。環境変数で渡されていれば、そちらを使う。
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??= `postgresql://testuser_000:${randomUUID()}@localhost:5432/not_connected_in_tests`;

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
