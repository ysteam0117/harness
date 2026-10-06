# 品質チェックの手順書

## 1. 必要なもの

| もの | 版 | 入れ方 |
| --- | --- | --- |
| Node.js | `.node-version` の版 | PC に直接入れる |
| 依存ライブラリ（ESLint・TypeScript・Prettier 等） | `package.json` の版（`docs/tech-stack.md`） | `npm install` |
| Docker（セキュリティのテスト用。D1・DB なしでも要る） | 新しいもの（Semgrep・gitleaks・OSV-Scanner のイメージは、版とダイジェストで固定している） | Docker Desktop（Windows・macOS）か Docker Engine（Linux）。導入と注意は [security.md](security.md) |

## 2. 構築の手順

1. `npm install`
1. `.env.example` を `.env.test` にコピーし、`APP_ENV=test` と検証用の値を入れる（項目の説明は `docs/secrets.md`）

## 3. 確認の方法

- `node --version` が `.node-version` と同じ
- `npm run env:check -- test` が、足りない項目なしで終わる
- `docker info` が成功する（Docker が動いている）

## 4. テストの実行方法

`{{check_command}}`（Lint・型・書式・依存の向き・重複・テスト・脆弱性・セキュリティのテストをまとめて実行する。CI でも同じコマンドを使う）。ホストで実行する。Docker を使わない部分だけなら `npm run check:app`（Docker のコンテナの中では、こちらを実行する）

## 5. 後始末

起動するものはない。テストが作ったファイル（`coverage/`・`reports/`）は Git に入らない。

## 6. よくある失敗と対処

| 失敗 | 確かめ方・対処 |
| --- | --- |
| `prettier --check` が改行の違いで失敗する | Git の改行の設定（`core.autocrlf`）を確かめる |
| 型の定義（`worker-configuration.d.ts`）がない | `npm run types` を実行する |
| セキュリティのテストが「Docker が見つかりません」「Docker が動いていません」で失敗する | Docker を入れて起動し、`docker info` が成功することを確かめる（[security.md](security.md)）。Docker のコンテナの中では、`npm run check:app` を実行する |
