# 単体テストの手順書

## 1. 必要なもの

| もの | 版 | 入れ方 |
| --- | --- | --- |
| Node.js | `.node-version` の版 | PC に直接入れる |
| Vitest・Testing Library・msw・fast-check | `docs/tech-stack.md` の版 | `npm install` |

## 2. 構築の手順

1. `npm install`
1. `.env.example` を `.env.test` にコピーし、`APP_ENV=test` と検証用の値を入れる

## 3. 確認の方法

- `npm run env:check -- test` が、足りない項目なしで終わる

## 4. テストの実行方法

- すべて：`npm test`（`.env.test` を使う）
- 1つのファイル：`npm test -- <ファイルのパス>`

## 5. 後始末

起動するものはない。外部の API はモック（msw）にし、本物を呼ばない。

## 6. よくある失敗と対処

| 失敗 | 確かめ方・対処 |
| --- | --- |
| 開発用の値（`.env.development`）で動いてしまう | `npm test` から実行しているかを確かめる（直接 `vitest` を実行しない） |
