// Skill「backend-hono」の例：Controller と Service の役割、入力の検証（validate）。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "../lib/app-error";
import { handleError } from "../lib/error-handler";
import { validate } from "../lib/validation";

const userSchema = z.object({ username: z.string().min(1).max(50) });

// #region example:controller-service
// Service：業務のルール（同じユーザー名は登録できない）。HTTP（Hono）を知らない
export function registerUser(names: string[], username: string): void {
  if (names.includes(username)) {
    throw new AppError("CONFLICT", "そのユーザー名はすでにあります");
  }
  names.push(username);
}

// Controller：入力の受け取りと応答だけ。入力は validate() で確かめ、処理は Service に渡す
export function userRoutes(names: string[]) {
  return new Hono().post("/", validate("json", userSchema), (c) => {
    const { username } = c.req.valid("json");
    registerUser(names, username);
    return c.json({ username }, 201);
  });
}
// #endregion

// #region example:logic-in-controller-bad
export function userRoutesBad(names: string[]) {
  return new Hono().post("/", validate("json", userSchema), (c) => {
    const { username } = c.req.valid("json");
    // 悪い例：業務のルール（重複の禁止）を Controller に直接書いている。ルートを通らない入口には、このルールが効かない
    if (names.includes(username)) {
      throw new AppError("CONFLICT", "そのユーザー名はすでにあります");
    }
    names.push(username);
    return c.json({ username }, 201);
  });
}

// ルールを再利用できないため、バッチ処理は、確認を書かずに直接追加してしまう
export function importUsersBad(names: string[], list: string[]): void {
  for (const username of list) names.push(username);
}
// #endregion

// #region example:zvalidator-direct-bad
export const zValidatorRoutesBad = new Hono().post(
  "/",
  // 悪い例：zValidator を直接使っている。失敗の応答が決めた形にならず、Zod の詳しいエラーがそのまま返る
  zValidator("json", userSchema),
  (c) => c.json(c.req.valid("json"), 201),
);
// #endregion

// バッチ処理の入口。業務のルールは Service にあるため、同じルールが効く
export function importUsers(names: string[], list: string[]): void {
  for (const username of list) registerUser(names, username);
}

const post = (app: Hono, body: unknown) =>
  app.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function appOf(routes: Hono): Hono {
  return new Hono().route("/", routes).onError(handleError);
}

describe("Controller と Service", () => {
  it("良い例：正しい入力は 201、不正な入力は 422（VALIDATION_ERROR と、誤った項目の名前だけ）", async () => {
    const app = appOf(userRoutes([]));
    const ok = await post(app, { username: "testuser_001" });
    expect(ok.status).toBe(201);
    const bad = await post(app, { username: "" });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({
      code: "VALIDATION_ERROR",
      message: "入力内容を確かめてください",
      fields: ["username"],
    });
  });

  it("良い例：業務のルールは Service にあり、ルートを通らない入口（バッチ）にも同じように効く", async () => {
    const app = appOf(userRoutes(["testuser_001"]));
    const res = await post(app, { username: "testuser_001" });
    expect(res.status).toBe(409);
    expect(() => {
      importUsers(["testuser_001"], ["testuser_001"]);
    }).toThrow(AppError);
  });

  it("悪い例の問題：ルールが Controller にあると、ルートでは効いても、バッチ処理は重複を通してしまう", async () => {
    const names = ["testuser_001"];
    const res = await post(appOf(userRoutesBad(names)), {
      username: "testuser_001",
    });
    expect(res.status).toBe(409);
    importUsersBad(names, ["testuser_001"]);
    expect(names).toEqual(["testuser_001", "testuser_001"]);
  });
});

describe("入力の検証（validate）", () => {
  it("悪い例の問題：zValidator を直接使うと、決めた形（code・fields）にならず、Zod の詳細が返る", async () => {
    const res = await post(zValidatorRoutesBad, { username: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBeUndefined();
    expect(body["error"]).toBeDefined();
  });
});
