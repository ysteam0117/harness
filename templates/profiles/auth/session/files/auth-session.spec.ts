// 認証のシナリオ：未認証のとき、保護された API は 401、保護された画面はログインの案内へ移る。
// （ログイン済みの確認は、ログインの方式ごとの Issue（独自認証・OIDC）で足す）
import { allowConsoleError, expect, test } from "./console-guard";

test("未認証の /api/auth/me は 401 で、キャッシュさせない（no-store）", async ({
  page,
}) => {
  const response = await page.request.get("/api/auth/me");
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test("未認証で保護された画面（/account）を開くと、ログインの案内が表示される", async ({
  page,
}) => {
  allowConsoleError(
    page,
    /401/,
    "未認証の確認（/api/auth/me が 401）を、ブラウザがコンソールに出す",
  );
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("ログインが必要です")).toBeVisible();
});
