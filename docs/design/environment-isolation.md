# 設計書：開発・検証環境の分離（Issue #51）

## 目的

開発と検証で設定・ローカルデータの保存先を分け、誤った環境設定や親プロセスの接続情報がテストに混ざる可能性を下げる。これはローカル実行時の防護であり、OS・Docker・DB権限を越えた隔離や、任意の設定での安全を保証するものではない。

## 環境ファイルと起動

- `.env.example`を見本とし、開発は`.env.development`、検証は`.env.test`を使う。各ファイルの`APP_ENV`は選択した環境と一致する必要がある。
- `scripts/local-env.ts`がファイルの読込と検査を行い、`scripts/run-local.ts`・`scripts/db-local.ts`・`scripts/compose-local.ts`が選択環境の値だけで子プロセスを起動する。親環境変数を除去し、Cloudflareのプロセス環境・`.dev.vars*`の自動読込を無効化する。
- 生の`.env`や`.dev.vars*`との混在は停止する。Viteのdotenv探索も無効化する。
- `build`はローカル環境ファイルを読まず、開発用変数を引き継がない。ローカル起動環境はdevelopment/testに限る。
- `npm run dev:test`と `npm run test`は検証環境を選ぶ。DBは`db:*:test`、Composeは`docker:up:test`・`docker:down:test`を使う。migration生成の`npm run db:generate -- --name <名前>`は名前の検証後に引き続き利用できる。

## 保存先とPostgreSQL

- D1のWrangler状態は`.wrangler/state/development`と`.wrangler/state/test`に分ける。Vitest WorkersのD1はこれらのCLI用保存先と共有せず、テストごとの一時隔離状態を使う。
- R2のローカルディレクトリは開発と検証で分ける。
- PostgreSQLのURLはループバックに限定する。検証DB名は英数字・アンダースコアから成り、`_test`で終わる。URLのDB名・ポート・ユーザー・パスワードと`POSTGRES_*`の値を照合し、Hyperdrive接続文字列と`DATABASE_URL`の両方がある場合は一致を求める。
- Docker内では検証済みのループバック接続先をComposeの`db:5432`へ変換し、development/testでComposeプロジェクトを分ける。

## Vite・Vitest・テスト安全性

- Viteは`.env`を自動探索せず、環境値は事前検証されたプロセス環境から受け取る。
- Vitest設定評価の早い段階で検証環境を読み込む。PostgreSQL接続設定の検証もDB接続・プラグイン初期化より前に行う。
- `scripts/test-safety.mjs`はtest系scripts、そこから呼ぶnpm scripts、スクリプト・設定ファイルの参照と相対importを再帰的に調べ、`--remote`を検出する。これは静的な検出範囲内の確認で、動的生成や未追跡の外部コードまで網羅するものではない。
- 診断には環境名・項目名・理由のみを含め、値や接続文字列は出さない。

## 確認状況

- 初期版では環境分離テスト53件、既存生成テスト4ファイル・539件、root typecheck・packが成功したとの報告があった。後続の文書確定版では環境分離テスト592/592件、最終typecheck・変更対象test ESLint・root lint・speccheck・formatcheckが成功したとの報告があり、認証fixture修正版では全checkが39ファイル・1359件成功、2件skip、本番依存の脆弱性0件との報告があった。
- 認証fixture修正版の`npm.cmd run pack:check`は、配布物の確認と`create`がexit 0で成功したとの報告がある。D1・PostgreSQL・DBなし3系統smokeは利用者が実行し、すべて成功して「生成したプロジェクトの確かめに成功しました」と報告した。こちらでの再実行ではない。
- 以前のnone系smoke成功は最終smoke差分前の結果として区別する。認証fixture修正版の3系統smoke成功により自動smokeの未実施記録は更新された。個別手動確認は未実施で、自動smoke成功とは別の確認として残る。

## 手動確認

個別手動確認を行う場合は、Orca埋め込みターミナルからテスト用に新規作成したローカルDB・ボリュームを対象にする。既存データを削除・resetしない。最終自動smokeは利用者が実行して成功したとの報告があり、ここに記す手順が未実施であることとは分けて扱う。

1. `.env.example`を`.env.development`と`.env.test`にコピーし、値を編集する。`APP_ENV`をそれぞれ`development`・`test`とし、PostgreSQLでは別DB名・ポート・資格情報を設定する。検証DB名は`_test`で終わらせる。
2. `npm run env:check`と`npm run env:check -- test`を実行し、環境名が合い、秘密の値が出力されないことを確認する。
3. 開発用に架空データを作ってから`npm run test`を実行し、開発側のデータが変わらないことを確認する。
4. 任意の既存接続変数を親環境に設定しても、ラッパーがその値を継承しないことを、値を表示せず確認する。
5. 許可されない`APP_ENV`、非ループバックDB URL、`_test`で終わらないテストDB名、テストscripts内の`--remote`が拒否されることを確認する。

確認対象はローカル設定の拒否と保存先分離であり、外部サービス接続を含む保証ではない。
