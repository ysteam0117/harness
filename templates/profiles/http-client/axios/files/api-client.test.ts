import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  apiClient,
  setUnauthenticatedHandler,
  type ApiError,
} from "./api-client";

const server = setupServer(
  http.get("*/api/fail", () =>
    HttpResponse.json(
      { code: "CONFLICT", message: "競合しました" },
      { status: 409 },
    ),
  ),
  http.get("*/api/plain", () => new HttpResponse("oops", { status: 500 })),
  http.get("*/api/auth", () =>
    HttpResponse.json(
      { code: "UNAUTHENTICATED", message: "ログインしてください" },
      { status: 401 },
    ),
  ),
  http.get("*/api/network", () => HttpResponse.error()),
);

beforeAll(() => {
  // テスト用の画面の場所と同じドメインにそろえる（別のドメインだと、ブラウザの通信の制限で止められる）
  apiClient.defaults.baseURL = `${window.location.origin}/api`;
  server.listen();
});
afterAll(() => server.close());

const fail = (path: string) =>
  apiClient.get(path).then(
    () => {
      throw new Error("成功してはいけない");
    },
    (e: ApiError) => e,
  );

describe("API通信の共通部分（C-46）", () => {
  it("サーバーのエラーコードとメッセージを共通の形にする", async () => {
    expect(await fail("/fail")).toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "競合しました",
    });
  });

  it("形式の違うエラーは UNKNOWN_ERROR にする", async () => {
    expect(await fail("/plain")).toMatchObject({
      status: 500,
      code: "UNKNOWN_ERROR",
    });
  });

  it("通信できない場合は NETWORK_ERROR にする", async () => {
    expect(await fail("/network")).toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    });
  });

  it("401では登録した処理を1回呼び、失敗として返す", async () => {
    let called = 0;
    setUnauthenticatedHandler(() => {
      called += 1;
    });
    expect(await fail("/auth")).toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(called).toBe(1);
  });

  it("リクエストIDを付けて送る", async () => {
    let requestId: string | null = null;
    server.use(
      http.get("*/api/echo", ({ request }) => {
        requestId = request.headers.get("X-Request-Id");
        return HttpResponse.json({});
      }),
    );
    await apiClient.get("/echo");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
