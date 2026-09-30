// 必須のテスト（C-28・C-58）：GETで状態が変わらない／許可していない送信元の拒否／入力の誤りの形式／セキュリティヘッダー
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import { securityHeaders, originCheck } from "./security";
import { validate } from "./validation";
import { handleError } from "./error-handler";

const ALLOWED = "https://app.example.com";
let state = 0;

const app = new Hono()
  .use(securityHeaders)
  .use(originCheck(() => [ALLOWED]))
  .get("/items", (c) => c.json({ state }))
  .post(
    "/items",
    validate("json", z.object({ name: z.string().min(1) })),
    (c) => {
      state += 1;
      return c.json({ ok: true }, 201);
    },
  );
app.onError(handleError);

const post = (headers: Record<string, string>, body: unknown) =>
  app.request("/items", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("セキュリティの共通設定", () => {
  it("すべてのGETのAPIで、状態が変わらない（APIの一覧はルーティングの定義から取得する）", async () => {
    const before = state;
    for (const route of app.routes.filter((r) => r.method === "GET")) {
      await app.request(route.path);
    }
    expect(state).toBe(before);
  });

  it("許可していない送信元・送信元なしのJSONの要求は403で拒否する", async () => {
    const cases: Record<string, string>[] = [
      { Origin: "https://evil.example.com" },
      {},
    ];
    for (const headers of cases) {
      const res = await post(headers, { name: "testuser_001" });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    }
  });

  it("許可した送信元からは成功する", async () => {
    const res = await post({ Origin: ALLOWED }, { name: "testuser_001" });
    expect(res.status).toBe(201);
  });

  it("入力の誤りは、Zodの詳細を出さずに決めた形式で返す", async () => {
    const res = await post({ Origin: ALLOWED }, { name: "" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      code: "VALIDATION_ERROR",
      message: "入力内容を確かめてください",
      fields: ["name"],
    });
  });

  it("セキュリティヘッダーが決めた値で付く", async () => {
    const res = await app.request("/items");
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });
});
