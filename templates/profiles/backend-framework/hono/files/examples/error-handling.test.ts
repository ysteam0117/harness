// Skill「backend-hono」「error-api」の例：エラーは AppError で投げ、各層で try〜catch して 500 にしない。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { AppError } from "../lib/app-error";
import { handleError } from "../lib/error-handler";

function addItem(items: Set<string>, name: string): void {
  if (items.has(name)) {
    throw new AppError("CONFLICT", "そのアイテムはすでにあります");
  }
  items.add(name);
}

// #region example:throw-app-error
export function itemRoutes(items: Set<string>) {
  return new Hono().post("/:name", (c) => {
    // 想定できるエラーは、Service が AppError で投げる。ここでは try〜catch せず、
    // グローバルのエラーハンドラ（app.onError(handleError)）が、HTTP のステータスとエラーコードに変える
    addItem(items, c.req.param("name"));
    return c.json({ name: c.req.param("name") }, 201);
  });
}
// #endregion

// #region example:swallow-error-bad
export function itemRoutesBad(items: Set<string>) {
  return new Hono().post("/:name", (c) => {
    try {
      addItem(items, c.req.param("name"));
      return c.json({ name: c.req.param("name") }, 201);
    } catch (error) {
      // 悪い例：各層で try〜catch して、自分で 500 を返している。409 のはずが 500 になり、エラーコード（code）も失われる
      return c.json({ error: String(error) }, 500);
    }
  });
}
// #endregion

const post = (app: Hono) => app.request("/testitem_001", { method: "POST" });

describe("エラー処理", () => {
  it("良い例：AppError は、エラーハンドラで 409 と決めた形（code・message）になる", async () => {
    const app = new Hono()
      .route("/", itemRoutes(new Set(["testitem_001"])))
      .onError(handleError);
    const res = await post(app);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "CONFLICT",
      message: "そのアイテムはすでにあります",
    });
  });

  it("悪い例の問題：try〜catch で 500 にすると、重複（409）が 500 になり、code が失われる", async () => {
    const app = new Hono()
      .route("/", itemRoutesBad(new Set(["testitem_001"])))
      .onError(handleError);
    const res = await post(app);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBeUndefined();
  });
});
