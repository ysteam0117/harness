// MSW のサーバー（テスト用の架空のAPI）。テストごとに server.use(...) で応答を足す。
import { setupServer } from "msw/node";

export const server = setupServer();
