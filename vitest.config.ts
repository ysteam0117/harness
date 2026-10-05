import { defineConfig } from "vitest/config";

// smoke のスクリプトの単体テストは、時間がかかり環境に左右されるため、npm run check から外し、
// npm run test:smoke（vitest.smoke.config.ts）と手動の smoke のワークフローで実行する（#82）
export const SMOKE_TESTS = "test/scripts/smoke-generated*.test.ts";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", SMOKE_TESTS],
  },
});
