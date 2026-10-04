// フロントエンドのテスト（jsdom）の共通の準備。
// API の応答は MSW で返す。決めていない通信は失敗にして、本物の通信が出ないようにする。
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
