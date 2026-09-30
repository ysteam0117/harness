---
name: http-client-axios
description: フロントエンドからAPIを呼ぶときのルール。Axiosのインスタンス、インターセプター、エラーの形、401の扱いを扱うときに読む。
---

<!-- もとになった共通仕様：C-15・C-46・C-71・C-73 -->

# API通信（Axios）

作業の過程と結果は、すべて日本語で書く。

## 使い方

- APIは`frontend/src/services/api-client.ts`の`apiClient`だけを使って呼ぶ。コンポーネント・Hook・画面から`axios`・`fetch`を直接使わない
- 機能ごとのAPIの関数は`features/<機能>/api/`に書き、`apiClient`を使う
- 失敗は、必ず`ApiError`（`status`・`code`・`message`・`fields`）の形で返ってくる。`code`で表示や動作を分ける

## 守ること

- **MUST NOT**：インターセプターの中でエラーをもみ消さない。変換した後も失敗として返す
- **MUST NOT**：インターセプターに、特定の画面・機能だけの処理を書かない
- **MUST**：401の扱い（認証の更新・ログイン画面への遷移）は、`setUnauthenticatedHandler`で1か所に登録する。更新は1回だけにし、遷移を重複させない
- **MUST**：接続先は環境変数（`VITE_API_BASE_URL`、既定は同じドメインの`/api`）で決める
