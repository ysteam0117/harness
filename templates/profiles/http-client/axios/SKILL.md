---
name: http-client-axios
description: フロントエンドからAPIを呼ぶときのルール。Axiosのインスタンス、インターセプター、エラーの形、401の扱いを扱うときに読む。
---

<!-- もとになった共通仕様：C-15・C-46・C-71・C-73 -->

# API通信（Axios）

作業の過程と結果は、すべて日本語で書く。{{profile_skill_note}}

## 使い方

- {{axios_client_rule}}
- 機能ごとのAPIの関数は`features/<機能>/api/`に書き、`apiClient`を使う
- {{axios_error_shape}}

## 守ること

- **MUST NOT**：インターセプターの中でエラーをもみ消さない。変換した後も失敗として返す
- **MUST NOT**：インターセプターに、特定の画面・機能だけの処理を書かない
- **MUST**：{{axios_unauthenticated_rule}}
- **MUST**：接続先は環境変数（`VITE_API_BASE_URL`、既定は同じドメインの`/api`）で決める

## 良い例・悪い例

{{axios_examples_intro}}

### APIは`apiClient`だけで呼び、失敗はもみ消さない

#### 良い例

{{example:frontend/src/rules-examples/http-client.test.tsx#use-api-client}}

#### 悪い例

{{example:frontend/src/rules-examples/http-client.test.tsx#direct-axios-bad}}

- 問題：`axios`を直接使うと、リクエストIDが付かず、接続先・タイムアウトも決めたとおりにならない。失敗も`ApiError`の形（`status`・`code`・`message`）にならない

{{example:frontend/src/rules-examples/http-client.test.tsx#swallow-error-bad}}

- 問題：失敗をもみ消して空の一覧を返すと、サーバーが失敗しても「データなし」と表示され、失敗が利用者に伝わらない
