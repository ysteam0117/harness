// グローバルのエラーハンドラ（error-handler.ts）のテスト。
// Schemathesis（docs/testing/schemathesis.md）が見つけた不具合の再発を防ぐ：壊れた JSON の本文が、500 になっていた。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handleError, handleNotFound } from "./error-handler";
import { validate } from "./validation";

const app = new Hono()
  .post("/echo", validate("json", z.object({ name: z.string() })), (c) =>
    c.json(c.req.valid("json")),
  )
  .get("/boom", () => {
    throw new Error("内部の詳細（利用者に返さない）");
  })
  .onError(handleError)
  .notFound(handleNotFound);

const post = (body: BodyInit) =>
  app.request("/echo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

describe("エラーハンドラ", () => {
  it("壊れた JSON の本文は、500 ではなく 422（VALIDATION_ERROR）で返す", async () => {
    for (const body of ["{bad", "\u0000", "", "[1,"]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(await res.json()).toEqual({
        code: "VALIDATION_ERROR",
        message: "入力内容を確かめてください",
        fields: [],
      });
    }
  });

  it("形が違う JSON は、これまでどおり 422 で、正しくない項目の名前を返す", async () => {
    const res = await post(JSON.stringify({ name: 1 }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["name"],
    });
  });

  it("想定していないエラーは、500 と一般的なメッセージだけを返し、詳細を返さない", async () => {
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("INTERNAL");
    expect(text).not.toContain("内部の詳細");
  });

  it("存在しないパスは、共通の形で 404 を返す", async () => {
    const res = await app.request("/none");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});
