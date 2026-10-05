// シードした架空のデータ（e2e/seeds/health.sql）を、画面の裏の API から読めることを確かめる。
// 検証用 DB への初期化・シードの保存先と、開発サーバー（dev:test）の保存先が同じであることの確認も兼ねる。
import { expect, test } from "./console-guard";

test("シードした利用者（e2euser_health_001）を API から読める", async ({
  page,
}) => {
  const response = await page.request.get("/api/sample-users");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { users: { username: string }[] };
  expect(body.users.map((user) => user.username)).toContain(
    "e2euser_health_001",
  );
});
