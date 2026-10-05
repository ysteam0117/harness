import { defineConfig } from "vitest/config";

// PostgreSQL の例のテスト（*.db.test.ts）用の設定。
// Workers のテストの道具（vitest-pool-workers）の中では pg を読み込めないため、Node.js で動かす。
// 接続先は .env.test の DATABASE_URL（npm run test:db が、環境を確かめてから渡す）
export default defineConfig({
  envDir: "./node_modules/.harness-env-disabled",
  test: {
    name: "backend-db",
    include: ["backend/**/*.db.test.ts"],
    environment: "node",
  },
});
