import { defineConfig } from "vitest/config";

// smoke のスクリプトの単体テストは、時間がかかり環境に左右されるため、npm run check から外し、
// npm run test:smoke（vitest.smoke.config.ts）と手動の smoke のワークフローで実行する（#82）
export const SMOKE_TESTS = "test/scripts/smoke-generated*.test.ts";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", SMOKE_TESTS],
    // 生成の全体を通すテストは、Windows の CI では既定の 5 秒を超えることがあるため延ばす（時間切れの不安定さを避ける）
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
