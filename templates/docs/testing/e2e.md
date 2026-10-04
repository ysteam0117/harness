# E2E の手順書

起動したアプリを、ブラウザ（Playwright）で操作して確かめる。

## 1. 必要なもの

| もの | 版 | 入れ方 |
| --- | --- | --- |
| Node.js | `.node-version` の版 | PC に直接入れる |
| @playwright/test | `docs/tech-stack.md` の版 | `npm install` |
| Playwright のブラウザ | @playwright/test に合う版 | `npx playwright install --with-deps chromium` |

## 2. 構築の手順

1. `npm install`
1. `npx playwright install --with-deps chromium`
1. `.env.example` を `.env.test` にコピーし、`APP_ENV=test` と検証用の値を入れる

## 3. 確認の方法

- `npx playwright --version` が `docs/tech-stack.md` の版と同じ
- ポート {{e2e_port}} が使われていない

## 4. テストの実行方法

`npx playwright test`（`playwright.config.ts` が検証用の開発サーバーを起動する）

## 5. 後始末

- テストが終わったら、Playwright が起動した開発サーバーとブラウザが止まり、ポート {{e2e_port}} が解放されたことを確かめる
- テストが作ったデータ（`testuser_` で始まるもの）を消す

## 6. よくある失敗と対処

| 失敗 | 確かめ方・対処 |
| --- | --- |
| ブラウザがないと言われる | `npx playwright install --with-deps chromium` を実行する |
| ポートが使われていて起動しない | 何が使っているかを確かめる。自分が起動したものでなければ、止めずに利用者に確認する |
