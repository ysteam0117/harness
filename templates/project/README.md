# {{app_name}}

このプロジェクトは、`harness create` で作りました。AIと開発するためのルール（`AGENTS.md`・`CLAUDE.md`・`.claude/`・`.agents/`）と、動くアプリの土台が入っています。

- 画面：React（Vite・React Router・TanStack Query）
- API：Hono（Cloudflare Workers）。画面と API は、1つの Workers にまとめて、同じドメインから配信します
- DB：{{database}}
- 認証：{{auth_method}}

## 最初の手順

1. 必要なものを入れる：Node.js（`.node-version` の版）と **Docker**。品質チェック（`npm run check`）のセキュリティのテスト（Semgrep・gitleaks・OSV-Scanner）が、Docker のイメージで動くため、D1・DB なしでも Docker が要ります。Windows・macOS は Docker Desktop、Linux は Docker Engine を入れて、起動しておきます（`docker info` で確かめる）。**Docker Desktop は、従業員250人以上または年間売上1000万ドル以上の会社が業務で使うときは有料です**（個人・小規模・教育・非営利は無料。条件は公式で確かめる）。導入と注意は `docs/testing/security.md`
1. 依存を入れる：`npm install`
1. 開発用の環境変数を用意する：`.env.example` を `.env.development` にコピーして、`APP_ENV=development` と手元の値を入れる（Gitには入りません。項目の説明は `docs/secrets.md`）。不足は `npm run env:check` で確かめられます
{{readme_db_setup}}
1. 開発サーバーを起動する：`npm run dev`（画面は http://localhost:5173/ 、API は http://localhost:5173/api/health ）
1. 品質チェックとテストを実行する：`npm run check`（Docker が要る。初回は、セキュリティのテストのイメージを取得するため、通信と時間がかかります）

## リポジトリの用意

{{readme_repository_setup}}

## Docker で動かす

バックエンド（と、PostgreSQL のときは DB）を、Docker のコンテナで動かせます。コンテナ名は `{{app_name}}-<役割>` です。

```
npm run docker:up:local
```

- 開発サーバーは、コンテナの中の `npm run dev` です（http://localhost:5173/ ）
- 依存（`node_modules`）は、コンテナの中のボリュームに置きます。手元の `node_modules` とは別です
- コンテナの中では、Docker を使えないため、品質チェックは `npm run check:app`（セキュリティのテストを除く）を実行します。セキュリティのテストを含む `npm run check` は、手元（ホスト）で実行します
- 開発と検証のローカルデータは環境別の保存先に残ります。`docker:down:*`でComposeを停止してもボリュームは削除されません
{{readme_docker_db}}

## よく使うコマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバーを起動する（画面と API） |
| `npm run build` | 本番用に組み立てる |
| `npm run preview` | 組み立てた結果を、手元で確かめる |
| `npm run check` | 品質チェック・テスト・セキュリティのテスト（`check:app` と `security`）。**ホストで実行する**（Docker が要る） |
| `npm run check:app` | 品質チェック・テスト（lint・型・書式・依存の向き・重複・テスト・`npm audit`）。Docker を使わない（コンテナの中でも動く） |
| `npm run security` | セキュリティのテスト（Semgrep・gitleaks・OSV-Scanner）。1つだけなら `security:semgrep`・`security:secrets`・`security:osv`（`docs/testing/security.md`） |
| `npm run types` | `wrangler.jsonc` から型（`worker-configuration.d.ts`）を作る（`dev`・`test`・`typecheck` の前に自動で実行） |
| `npm run env:check` | `.env.development` に足りない項目がないか確かめる |
| `npm run test` | `.env.test` を使ってテストする |
| `npm run dev:test` | `.env.test` を使って開発サーバーを起動する |
| `npm run docker:up:test`・`npm run docker:down:test` | テスト用の Docker 環境を起動・停止する |
{{readme_merge_command_row}}
{{readme_db_commands}}

## ディレクトリ

| パス | 内容 |
| --- | --- |
| `backend/src/` | API（Hono）。`routes/`（受け付け）→ `services/`（業務の処理）→ `db/`（DB へのアクセス） |
| `backend/db/` | DB のスキーマ・マイグレーション・シード |
| `frontend/src/` | 画面（React）。`pages/`（部品を組み合わせる）・`features/`（機能ごとの部品と API 層） |
| `wrangler.jsonc` | Cloudflare Workers の設定（ハーネスが、選んだ技術に合わせて作ったもの） |
| `docs/` | 設計・ルール・記録（`docs/project-rules.md` を最初に読む） |
| `public/` | そのまま配信するファイル（アイコン・ファビコン・`manifest.webmanifest`） |
| `prototype/` | 画面の動きを確かめるプロトタイプ（HTML・CSS・JavaScript だけ。本番のコードに流用しない） |

## 文書

| 文書 | 内容 |
| --- | --- |
| `docs/requirements.md` | 要件定義書。生成したときの判定の結果（ASVS のレベル・ペネトレーションテストの要否・未定の項目）が入っています |
| `docs/adr/` | 設計判断の記録。`0000-template.md` を写して書きます |
| `docs/testing/` | テストの種類ごとの環境構築の手順書（セキュリティのテストは `security.md`、API の異常な入力のテストは `schemathesis.md`） |
| `docs/api/openapi.json` | API の仕様書（OpenAPI）。API を足す・変えるときは、同じ変更の中で直します |

## 仮のアイコン

`public/` のアイコン・ファビコン（`favicon.ico`・`favicon.svg`・`apple-touch-icon.png`・`icons/icon-192.png`・`icons/icon-512.png`）は、頭文字と枠だけの**仮の画像**です。本番へ公開する前に、同じファイル名・同じ大きさの正式な画像に差し替えてください。

{{readme_icons_issue}}

差し替えたら、この章を消します。

## `main` ブランチの保護

{{readme_branch_protection}}
