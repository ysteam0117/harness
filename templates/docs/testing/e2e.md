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
1. `.env.example` を `.env.test` にコピーし、`APP_ENV=test` と検証用の値を入れる（手順は `docs/secrets.md`）

## 3. 確認の方法

- `npx playwright --version` が `docs/tech-stack.md` の版と同じ
- ポート {{e2e_port}} が使われていない

## 4. テストの実行方法

`npm run test:e2e`

- 検証用の開発サーバー（`npm run dev:test`）を Playwright が起動し、終わると止める。すでに動いているサーバーには向けない（ポートが使われていると失敗する）
- 実行の前（`pretest:e2e`）に、`.env.test` の確認をする。DB があるプロジェクトでは、検証用の DB を初期化し（`npm run db:reset:test`）、E2E 用のシード（`e2e/seeds/`）を入れる。初期化の対象は検証用の DB だけで、開発用の DB には触れない
- `npm run check` には入れない（ブラウザの導入が要り、時間がかかるため）。マージの前などに、`npm run test:e2e` を別に実行する

### シナリオの一覧

| シナリオ | ファイル | 確かめること |
| --- | --- | --- |
| 画面を開いてサーバーと通信する | `e2e/health.spec.ts` | 画面にサーバーの状態が表示され、コンソールのエラーがなく、`/api/health` が 200 を返す |
| シードしたデータを読む（DB があるときだけ） | `e2e/sample-users.spec.ts` | シードした `e2euser_health_001` を、API から読める（シードの保存先と、検証用サーバーの読み先が同じ） |

- シナリオは、`e2e/` に `<名前>.spec.ts` として足す。`e2e/console-guard.ts` の `test` を使い、コンソールのエラーを失敗にする
- シナリオ用のシードは、`e2e/seeds/<名前>.sql` に足す。架空のデータだけを使い、ユーザー名は `e2euser_` で始める。何回流しても同じ結果になるようにする（`ON CONFLICT DO NOTHING`）。流すには、`pretest:e2e` に `node scripts/db-local.ts test seed-file e2e/seeds/<名前>.sql` を足す（`e2e/seeds/` の下の SQL だけを指定できる）

## 5. 後始末

- テストが終わったら、Playwright が起動した開発サーバーとブラウザが止まり、ポート {{e2e_port}} が解放されたことを確かめる
- テストが作ったデータ（`e2euser_` で始まるもの。単体のテストの `testuser_` も）を消す。DB があるプロジェクトでは、`npm run db:cleanup:test` で、識別子のデータだけを消し、残りが 0 件になったことを確かめる

## 6. よくある失敗と対処

| 失敗 | 確かめ方・対処 |
| --- | --- |
| ブラウザがないと言われる | `npx playwright install --with-deps chromium` を実行する |
| ポートが使われていて起動しない | 何が使っているかを確かめる。自分が起動したものでなければ、止めずに利用者に確認する |
| `.env.test` がないと言われる | `docs/secrets.md` の手順で作る |
| 失敗の原因が分からない | `playwright-report/` とトレース（`npx playwright show-trace <trace.zip>`）を確かめる |
