---
name: data-access-drizzle
description: Drizzle ORMでDBにアクセスするときのルール。スキーマの定義、CRUDの書き方、生SQL、トランザクション、マイグレーション、テストを扱うときに読む。
---

<!-- もとになった共通仕様：C-03・C-04・C-37・C-64・C-72 -->
<!-- ここに data-access/_shared の内容が入る（CLIが引用して出力する） -->
{{include:data-access/_shared}}

# Drizzle ORM

作業の過程と結果は、すべて日本語で書く。

このプロジェクトのDB：{{database}}

## スキーマの定義

- テーブルの定義は、Drizzleのスキーマのファイル（`backend/db/schema.ts`）に書く。DB に触れる処理（Repository）は`backend/src/db/`に置く
- スキーマの定義を変えたら、`drizzle-kit generate --name <内容をsnake_caseで>`でマイグレーションファイルを作る（例：`--name add_users_email_index` → `0003_add_users_email_index.sql`）。`--name`を付けないと意味のない名前になるため、必ず付ける。作られたSQLの内容を確かめてからコミットする
- マイグレーションファイルを手で書き換えない。一度適用したものは変えず、新しいファイルを追加する

## マイグレーションの適用

- Cloudflare D1：`drizzle-kit generate`で作ったファイルを、wranglerのマイグレーション機能で適用する。適用の記録はD1の`d1_migrations`テーブルに残る
  - ローカル：`wrangler d1 migrations apply <DB名> --local`
  - 検証・本番：`--remote`を付ける。利用者の承認を得て行い、AIは実行しない
  - `wrangler.jsonc`の`d1_databases`に`migrations_dir`（マイグレーションファイルの置き場所）を書く
- テストでは、`@cloudflare/vitest-pool-workers`の`readD1Migrations`で読み込み、`applyD1Migrations`でテスト用のD1に適用する
- PostgreSQL：{{postgres_migration_notes}}

## CRUDの書き方（Repository）

- 必要な列だけを`select({ ... })`で指定して取得し、DTOの形で返す
- 入力によって変わる検索条件は、条件を配列に集めて`and(...)`等で組み立てる。文字列をつなげて作らない
- 一覧は必ずページング（`limit`・`offset`またはキー指定）を付ける

## 生SQL（DAO）

- 複雑なSQLは、DAOの`*.sql.ts`に、Drizzleの`` sql`...` ``で書く。値は`${}`で埋め込む（Drizzleがパラメータとして渡す）
- `sql.raw()`に利用者の入力を渡さない。並び替えの列名など、パラメータで渡せない部分は許可リストと照合してから使う
- 生SQLの結果の型は、DTOの型を明示し、Zod等で検証する

## トランザクション

- **Cloudflare D1**：`db.batch([...])`で、複数の文をまとめて実行する。途中の文が失敗すると、全体が取り消される
  - **`db.transaction()`はD1では使えない**（`Failed query: begin`のエラーになる）。使わない
  - 「読んだ結果を見て次の文を決める」処理は、`batch`にできないため、楽観的ロック（下記）と組み合わせて設計する
- **PostgreSQL**：`db.transaction(async (tx) => { ... })`を使う（ドライバは`pg`）。途中で失敗すると全体が取り消され、`tx.rollback()`で明示的に取り消すこともできる
- D1とPostgreSQLで書き方が違うため、Repositoryの内側に閉じ込め、Serviceからは同じ呼び出し方にする
- 楽観的ロック：`update(...).where(and(eq(id), eq(version))).run()`の`meta.changes`（更新した件数）が0なら、衝突として`409`を返す
- D1で書き込みが混み合ったときのエラーの種類は未確認。見つかった場合は、トランザクション全体のやり直し（Skill「バックエンド」）の対象に加え、この項目を更新する

## PostgreSQL（Hyperdrive経由）

- ドライバは`pg`（node-postgres）を使う（Cloudflareの推奨）。`drizzle-orm/node-postgres`で接続する
- `compatibility_date`が2026-08-04以降なら、`nodejs_compat`は既定で有効
- 楽観的ロックの更新件数は、更新の結果の`rowCount`で取る
- ローカルの開発では、Hyperdriveの接続先を環境変数`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<バインディング名>`で渡す。接続先（パスワードを含む）を`wrangler.jsonc`に書かない
- `@cloudflare/vitest-pool-workers`の中では`pg`を読み込めない（2026-09-30時点）。Workers＋PostgreSQLの結合テストは、`wrangler dev`で起動したアプリのAPIに対して行う（API層のテスト）。`pg`を使う処理そのものの結合テストは、Node.js上でテスト用のPostgreSQLのコンテナに対して行う

## テスト

- 結合テストは`@cloudflare/vitest-pool-workers`（`cloudflareTest`の設定）で、Workersと同じ実行エンジンで行う。ローカルのD1（またはテスト用のPostgreSQLのコンテナ）に、マイグレーションとシードを適用してから行う
- `wrangler.jsonc`の`compatibility_date`は、テストの道具に同梱された実行エンジンが対応する日付以下にする（新しすぎると起動しない）
- 実行計画は`EXPLAIN QUERY PLAN <SQL>`で取得し、インデックスが使われているか（`USING INDEX`）を確かめる
- インデックスの付け方は、Skill「知見」の`db/index-design`（検索・結合・並び順の列、複合インデックスの列の順、外部キーの列、値の種類が少ない列、部分一致、書き込みへの影響）を読む
- 実行されたSQLの数を数えて、N+1が起きていないことを確かめる
