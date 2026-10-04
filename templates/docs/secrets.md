# 秘密情報の設定の手順

<!-- もとになった共通仕様：C-05・F-25 -->

パスワード・APIキー・トークンなどの秘密情報は、**利用者が自分で入力する**。AIは手順を案内するだけで、値を扱わない。

## 守ること

- 値をチャットに貼らない。スクリーンショットにも写さない
- 値を入力するコマンドは、AIに実行させず、自分でターミナルで実行する
- `.env.development`・`.env.test`など実際の値が入ったファイルはコミットしない（`.gitignore`で除外済み）

## 開発・検証（手元のPC）

開発と検証は、環境変数のファイルを分けて使う。テストは検証のファイル（`.env.test`）だけを読み込む。

1. 見本をコピーして、開発用と検証用のファイルを作る

   ```bash
   Copy-Item .env.example .env.development
   Copy-Item .env.example .env.test
   ```

   macOS/Linux では `cp .env.example .env.development` と `cp .env.example .env.test` を使います。
2. それぞれをエディタで開き、各項目に値を書いて保存する。`APP_ENV`は`.env.development`で`development`、`.env.test`で`test`にする。テスト用PostgreSQLのDB名は `_test` で終わらせ、開発と別のDB・ポート・資格情報を使う。D1とR2のローカル保存先も分かれる
3. 足りない項目がないかを確かめる（項目の名前と今の環境の名前だけが表示され、値は表示されない）

   ```bash
   npm run env:check
   npm run env:check -- test
   ```

4. 開発用コンテナに新しい値を反映するときは、環境を選ぶラッパーで再作成する

   ```bash
   npm run docker:down:local
   npm run docker:up:local
   ```

テストは `npm run test`、テスト用DB操作は `npm run db:migrate:test` などのコマンド、テスト用Dockerは `npm run docker:up:test`・`npm run docker:down:test` を使う。`npm run db:generate -- --name <名前>` は引き続きマイグレーション生成に使えます。開発・テスト用のコマンドは親プロセスの接続設定を引き継がず、設定値も診断に表示しません。テスト用のローカルDB設定であり、任意の外部DBへの接続を安全と保証するものではありません。

**本番の値（秘密情報・本番のDBの接続先）は、手元の平文のファイルに書かない**（プロジェクトの外のファイルも含む）。

## 本番の値を控えておく場所

本番の値を控えておく必要がある場合（再登録・引き継ぎ等）は、暗号化された保管場所に置く。使うソフトは、次から選んでこの欄に書く。

このプロジェクトで使う保管場所：（選んで書く）

| ソフト | 特徴 |
| --- | --- |
| Bitwarden | 個人は無料で使える。複数のPC・スマートフォンで同期できる |
| KeePassXC | 無料。暗号化したファイルを自分のPCにだけ保存する。ファイルのバックアップは自分で取る |
| 1Password | 有料。チームでの共有の機能が充実している |
| OSに標準の資格情報の管理 | 追加のインストールが要らない。ほかのPCとの共有はできない |

- 料金・機能は変わることがあるため、選ぶときに公式の情報を確かめる
- `wrangler secret put`で値を入力するときは、保管場所から貼り付ける。値をチャットやファイルに残さない

## 本番（Cloudflare）

1. 秘密情報を登録する（`<項目名>`は置き換える）

   ```bash
   npx wrangler secret put <項目名>
   ```

2. 値を聞かれたら、その場で入力する（画面には表示されず、ファイルにも残らない）
3. 登録した項目の名前を確かめる

   ```bash
   npx wrangler secret list
   ```

Cloudflare上に検証の環境を足した場合は、それぞれのコマンドに`--env <環境>`を付ける。

## CI（GitHub Actions）

- GitHubのリポジトリの Settings → Secrets and variables → Actions で登録する
- または、次を実行して、聞かれた値を入力する

  ```bash
  gh secret set <項目名>
  ```

## Terraform

- 秘密情報はコードに書かず、環境変数で渡す

  ```bash
  export TF_VAR_<項目名>="<値>"   # 入力した値がシェルの履歴に残らないよう、履歴の設定に注意する
  ```

## 設定する項目の一覧

| 項目名 | 用途 | 開発 | 検証 | 本番 |
| --- | --- | --- | --- | --- |
{{secrets_table}}
