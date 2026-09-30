---
name: backend-hono
description: HonoでバックエンドのAPIを作るときのルール。ルーティング、入力チェック、エラー処理、セキュリティの設定、Cloudflare Workersでのバッチ処理を扱うときに読む。
---

<!-- もとになった共通仕様：C-03・C-15・C-27〜C-29・C-58・C-65・C-73 -->

# Hono

作業の過程と結果は、すべて日本語で書く。

## 用意されている共通の部品（`backend/src/lib/`）

| ファイル | 役割 | 使い方 |
| --- | --- | --- |
| `app-error.ts` | 想定できるエラーの型（`AppError`） | 入力の誤り・権限不足・リソースなし・競合などは`throw new AppError("CONFLICT", "利用者向けのメッセージ")`で投げる |
| `error-handler.ts` | グローバル例外ハンドリング | `app.onError(handleError)`・`app.notFound(handleNotFound)`で登録する。各層でエラーを`try`〜`catch`で変換しない |
| `security.ts` | セキュリティヘッダー・送信元の確認・`no-store` | `app.use(securityHeaders)`・`app.use(originCheck(...))`を全体に、`noStore`を認証が必要なAPIに付ける |
| `validation.ts` | 入力チェック | `validate("json", スキーマ)`を使う。`@hono/zod-validator`の`zValidator`を直接使わない |
| `security.test.ts` | 必須のテスト | GETで状態が変わらない・送信元の拒否・入力の誤りの形式・セキュリティヘッダーを確かめる。APIを追加しても、ルーティングの定義から自動で対象になる |

## 守ること

- **MUST NOT**：Honoの`csrf`ミドルウェアだけでCSRF対策を済ませない。JSONの要求を確かめないため、`originCheck`を使う
- **MUST NOT**：`zValidator`を直接使わない。Zodの詳しいエラーが利用者に返ってしまう
- **MUST**：Controller（ルートの処理）は、入力の受付と応答の返却だけにし、業務の処理はServiceに渡す
- **MUST**：許可する送信元（`ALLOWED_ORIGINS`）は、環境ごとに環境変数で持つ
- **MUST**：CSPに外部のサービスを追加する場合は、`security.ts`を直し、理由をADRに記録する

## Cloudflare Workersでのバッチ処理

| 役割 | 使うもの |
| --- | --- |
| 起動の合図 | Cron Triggers（`scheduled`の処理）。設定はUTCで書き、日本時間を併記する |
| 大量の件数を小分けに処理する | Queues。メッセージは2回以上届く前提で、処理済みかをDBで確かめてから処理する。再試行の上限とデッドレターキューを設定する |
| 複数の手順を、途中から再開できるように進める | Workflows。実行ごとに一意の名前（例：`daily-summary-2026-09-30`）で起動する |

- 短い処理（数秒）はCron Triggersの中で直接実行してよい。迷ったら、Cron Triggersは起動の合図だけにする
- 実行の記録（開始・終了・件数・結果）を、DBの実行履歴とログに残す

## 型

- Workersの環境変数・バインディングの型は、`wrangler types`で生成する。`wrangler.jsonc`を変えたら生成し直す。生成したファイルはLint・整形の対象から外す
