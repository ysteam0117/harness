# {{app_name}}

このプロジェクトは、`harness create` で作りました。AIと開発するためのルール（`AGENTS.md`・`CLAUDE.md`・`.claude/`・`.agents/`）と、動くアプリの土台が入っています。

- 画面：React（Vite・React Router・TanStack Query）
- API：Spring Boot（Java。ビルドは Gradle）。画面（Vite の開発サーバー）と API は別のプロセスで動かします。画面からの `/api` は、Vite の proxy で API（http://localhost:8080 ）に届きます
- DB：{{database}}（Spring Boot のデータアクセスは、まだ用意していません）
- 認証：{{auth_method}}

## 最初の手順

1. 必要なものを入れる：Node.js（`.node-version` の版）、Java（`docs/tech-stack.md` の版）、Gradle（Gradle Wrapper を作るために、1回だけ使います）、**Docker**。バックエンドのテスト（Testcontainers）と、品質チェック（`npm run check`）のセキュリティのテスト（Semgrep・gitleaks・OSV-Scanner）が、Docker で動きます。Windows・macOS は Docker Desktop、Linux は Docker Engine を入れて、起動しておきます（`docker info` で確かめる）。**Docker Desktop は、従業員250人以上または年間売上1000万ドル以上の会社が業務で使うときは有料です**（個人・小規模・教育・非営利は無料。条件は公式で確かめる）。導入と注意は `docs/testing/security.md`
1. 依存を入れる：`npm install`
1. 開発用の環境変数を用意する：`.env.example` を `.env.development` にコピーして、`APP_ENV=development` と手元の値を入れる（Gitには入りません。項目の説明は `docs/secrets.md`）。不足は `npm run env:check` で確かめられます
1. API を起動する：`backend/` で `./gradlew bootRun`（Windows は `gradlew.bat bootRun`）。http://localhost:8080/api/health が `{"status":"ok",…}` を返します（Gradle Wrapper は、下の「Gradle の使い方」で作ります）
1. 画面を起動する：別のターミナルで `npm run dev`（画面は http://localhost:5173/ 、API は http://localhost:5173/api/health ）。API の接続先を変えるときは、`.env.development` に `HARNESS_API_ORIGIN` を書きます
1. 品質チェックとテストを実行する：画面側は `npm run check`（Docker が要る。初回は、セキュリティのテストのイメージを取得するため、通信と時間がかかります）。API 側は `backend/` で `./gradlew check`

## Docker での開発環境

Spring Boot の構成では、Docker（Compose）での開発・検証環境は、まだ用意していません（デプロイ先の設定と合わせて、今後追加します）。今は、手元で `./gradlew bootRun` と `npm run dev` を使います。Docker は、Testcontainers（API のテスト）とセキュリティのテストだけで使います。

## リポジトリの用意

{{readme_repository_setup}}

## よく使うコマンド

| コマンド | 内容 |
| --- | --- |
| `./gradlew bootRun`（`backend/` で） | API を起動する（http://localhost:8080 ） |
| `./gradlew check`（`backend/` で） | API のビルドとテスト（Testcontainers を使うため Docker が要る） |
| `npm run dev` | 画面の開発サーバーを起動する（`/api` は API へ中継する） |
| `npm run build` | 画面を本番用に組み立てる |
| `npm run preview` | 組み立てた画面を、手元で確かめる |
| `npm run check` | 画面側の品質チェック・テスト・セキュリティのテスト（`check:app` と `security`）。**ホストで実行する**（Docker が要る） |
| `npm run check:app` | 画面側の品質チェック・テスト（lint・型・書式・依存の向き・重複・テスト・`npm audit`）。Docker を使わない |
| `npm run security` | セキュリティのテスト（Semgrep・gitleaks・OSV-Scanner）。1つだけなら `security:semgrep`・`security:secrets`・`security:osv`（`docs/testing/security.md`） |
| `npm run env:check` | `.env.development` に足りない項目がないか確かめる |
| `npm run test` | `.env.test` を使って、画面のテストをする |
{{readme_merge_command_row}}

## ディレクトリ

| パス | 内容 |
| --- | --- |
| `backend/` | API（Spring Boot）。Gradle のプロジェクト。`src/main/java/` に本体、`src/test/java/` にテスト |
| `frontend/src/` | 画面（React）。`pages/`（部品を組み合わせる）・`features/`（機能ごとの部品と API 層） |
| `docs/` | 設計・ルール・記録（`docs/project-rules.md` を最初に読む） |
| `public/` | そのまま配信するファイル（アイコン・ファビコン・`manifest.webmanifest`） |
| `prototype/` | 画面の動きを確かめるプロトタイプ（HTML・CSS・JavaScript だけ。本番のコードに流用しない） |

## 文書

| 文書 | 内容 |
| --- | --- |
| `docs/requirements.md` | 要件定義書。生成したときの判定の結果（ASVS のレベル・ペネトレーションテストの要否・未定の項目）が入っています |
| `docs/adr/` | 設計判断の記録。`0000-template.md` を写して書きます |
| `docs/testing/` | テストの種類ごとの環境構築の手順書（セキュリティのテストは `security.md`） |

## 仮のアイコン

`public/` のアイコン・ファビコン（`favicon.ico`・`favicon.svg`・`apple-touch-icon.png`・`icons/icon-192.png`・`icons/icon-512.png`）は、頭文字と枠だけの**仮の画像**です。本番へ公開する前に、同じファイル名・同じ大きさの正式な画像に差し替えてください。

{{readme_icons_issue}}

差し替えたら、この章を消します。

## `main` ブランチの保護

{{readme_branch_protection}}
