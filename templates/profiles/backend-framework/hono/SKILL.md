---
name: backend-hono
description: HonoでバックエンドのAPIを作るときのルール。ルーティング、入力チェック、エラー処理、セキュリティの設定、Cloudflare Workersでのバッチ処理を扱うときに読む。
---

<!-- もとになった共通仕様：C-03・C-15・C-27〜C-29・C-58・C-65・C-73 -->

# Hono

作業の過程と結果は、すべて日本語で書く。{{profile_skill_note}}

{{hono_parts_section}}

## 守ること

- **MUST NOT**：{{hono_csrf_rule}}
- **MUST NOT**：`zValidator`を直接使わない。Zodの詳しいエラーが利用者に返ってしまう
- **MUST**：Controller（ルートの処理）は、入力の受付と応答の返却だけにし、業務の処理はServiceに渡す
- **MUST**：許可する送信元（`ALLOWED_ORIGINS`）は、環境ごとに環境変数で持つ
- **MUST**：{{hono_csp_rule}}

## 良い例・悪い例

{{hono_examples_intro}}

### Controller は入力の受け取りと応答だけ、業務のルールは Service

#### 良い例

{{example:backend/src/rules-examples/controller.test.ts#controller-service}}

- 入力は`validate()`で確かめる。失敗は、決めた形式（`VALIDATION_ERROR`と、誤った項目の名前`fields`）の`422`で返る
- 業務のルール（重複の禁止など）はServiceに書く。ルートを通らない入口（バッチなど）でも、同じルールが効く

#### 悪い例

{{example:backend/src/rules-examples/controller.test.ts#logic-in-controller-bad}}

- 問題：業務のルールをControllerに書くと、ルートでは効いても、ほかの入口（バッチなど）では効かず、重複を通してしまう

### 入力の検証は`validate()`を使う

#### 悪い例

{{example:backend/src/rules-examples/controller.test.ts#zvalidator-direct-bad}}

- 問題：`zValidator`を直接使うと、失敗の応答が決めた形（`code`・`fields`）にならず、Zodの詳しいエラーが利用者に返る。良い例は上の「Controller は入力の受け取りと応答だけ」の`validate("json", スキーマ)`

### エラーは`AppError`で投げ、各層で`try`〜`catch`して500にしない

#### 良い例

{{example:backend/src/rules-examples/error-handling.test.ts#throw-app-error}}

- `AppError`は、エラーハンドラで、HTTPステータス（例：`CONFLICT`は`409`）とエラーコード（`code`）に変わる

#### 悪い例

{{example:backend/src/rules-examples/error-handling.test.ts#swallow-error-bad}}

- 問題：各層で`try`〜`catch`して自分で500を返すと、`409`のはずの重複が`500`になり、エラーコード（`code`）も失われる

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
