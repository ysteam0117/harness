// 結合のテスト：本物と同じ実行エンジン（workerd）のローカルの D1 に対して、API（/api/sample-users）を通して確かめる。
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import app from "../index";

const USERNAME = "testuser_route_test";
// 一覧の上限（100件）より多い件数。routes は db/ を読まないため、数を直接書く
const BULK_COUNT = 101;
const ALLOWED_ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";

const post = (body: unknown, origin: string = ALLOWED_ORIGIN) =>
  app.request(
    "/api/sample-users",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    },
    env,
  );

afterEach(async () => {
  // このテストが足した行だけを、識別子で消す（C-05）
  await env.DB.prepare("DELETE FROM sample_users WHERE username = ?")
    .bind(USERNAME)
    .run();
  await env.DB.prepare(
    "DELETE FROM sample_users WHERE username LIKE 'testuser!_route!_bulk!_%' ESCAPE '!'",
  ).run();
});

describe("/api/sample-users（D1）", () => {
  it("POST：正しい入力は 201 で追加され、GET の一覧で読める", async () => {
    const created = await post({ username: USERNAME });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ username: USERNAME });

    const listed = await app.request("/api/sample-users", {}, env);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { users: { username: string }[] };
    expect(body.users).toContainEqual({ username: USERNAME });
  });

  it("POST：不正な入力は 422 で、追加されない", async () => {
    const res = await post({ username: "" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["username"],
    });
  });

  it("POST：許可していない送信元（Origin）は 403 で、追加されない", async () => {
    const res = await post({ username: USERNAME }, "https://origin.invalid");
    expect(res.status).toBe(403);
    const listed = await app.request("/api/sample-users", {}, env);
    const body = (await listed.json()) as { users: { username: string }[] };
    expect(body.users).not.toContainEqual({ username: USERNAME });
  });

  it("POST：同じユーザー名の2回目は 409 で、追加されない", async () => {
    expect((await post({ username: USERNAME })).status).toBe(201);
    const second = await post({ username: USERNAME });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "CONFLICT" });
  });

  it("POST：一覧の上限（100件）より多い 101 件のの既存のデータがあっても、重複は 409", async () => {
    // 一覧に載らない位置にある同じユーザー名でも、重複を見逃さない（昇順で最後になる名前を使う）
    const bulk = Array.from({ length: BULK_COUNT }, (_, i) =>
      env.DB.prepare("INSERT INTO sample_users (username) VALUES (?)").bind(
        `testuser_route_bulk_${String(i).padStart(4, "0")}`,
      ),
    );
    await env.DB.batch(bulk);
    const last = `testuser_route_bulk_${String(BULK_COUNT - 1).padStart(4, "0")}`;
    const listed = await app.request("/api/sample-users", {}, env);
    const body = (await listed.json()) as { users: { username: string }[] };
    expect(body.users.map((u) => u.username)).not.toContain(last);
    const res = await post({ username: last });
    expect(res.status).toBe(409);
  });
});
