---
name: frontend-build
description: フロントエンドの組み立て（Vite）と画面の切り替え（React Router）のルール。画面を追加するとき、組み立て・配信の設定を変えるときに読む。
---

<!-- もとになった共通仕様：C-06・C-29・C-60 -->

# 組み立て（Vite）と画面の切り替え（React Router）

作業の過程と結果は、すべて日本語で書く。

## 構成

- 画面（React）とAPI（Hono）は、`@cloudflare/vite-plugin`で1つのWorkersにまとめ、同じドメインから配信する。APIは`/api/`の下に置く。CORSは許可しない
- 画面は`pages/`に置き、React Routerのルーティングの定義に登録する

## 守ること

- **MUST**：初回に読み込むJavaScriptは、圧縮後200KB以下を目安にする。超える場合は、画面単位の遅延読み込み（`lazy`）を検討する。組み立てのときに表示されるサイズを確かめ、CIで記録する
- **MUST**：`wrangler.jsonc`を変えたら、`wrangler types`で型を生成し直す
- **MUST**：ローカルのD1の保存先は、Viteの開発サーバーとマイグレーションの適用先でそろえる
