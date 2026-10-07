import { defineConfig } from "vitest/config";
import { SMOKE_TESTS } from "./vitest.config.js";

// smoke のスクリプトの単体テストだけを実行する（npm run test:smoke、#82）
export default defineConfig({
  test: {
    include: [SMOKE_TESTS],
    // 子プロセス・プロセスの一覧を使うテストは、Windows で既定の 5 秒を超えることがあるため延ばす（#9）。
    // 待ち方は、固定の時間ではなく条件で書く
    testTimeout: 90_000,
    hookTimeout: 60_000,
  },
});
