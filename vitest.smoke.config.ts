import { defineConfig } from "vitest/config";
import { SMOKE_TESTS } from "./vitest.config.js";

// smoke のスクリプトの単体テストだけを実行する（npm run test:smoke、#82）
export default defineConfig({
  test: {
    include: [SMOKE_TESTS],
  },
});
