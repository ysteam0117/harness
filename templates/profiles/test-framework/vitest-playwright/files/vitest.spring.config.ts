import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import {
  applyLocalEnvironment,
  loadLocalEnvironment,
} from "./scripts/local-env.ts";

const values = loadLocalEnvironment("test");
applyLocalEnvironment(values);

// バックエンドは Java（Spring Boot、backend/ の ./gradlew check）。ここでは画面（フロントエンド）だけを jsdom で動かす
export default defineConfig({
  envDir: "./node_modules/.harness-env-disabled",
  test: {
    projects: [
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
