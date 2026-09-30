# 4. 未決定事項

| 項目 | 内容 | 状態 |
| --- | --- | --- |
| 技術スタック別の品質チェック設定 | 各ツールの詳細設定・バージョン・合格条件、および標準設定を自動生成するか利用者に選択させるか | 未着手 |
| CLIツール本体の動き | 対応するOS（Windowsを含むか）、Node.jsのバージョン、生成先に既存のファイルがある場合の扱い、質問を途中でやめた場合の扱い等 | 未着手 |
| 生成するAI向け設定ファイルの内容 | 生成する`AGENTS.md`（核）・`CLAUDE.md`・各Skillに書く具体的な文面（[F-21](functional.md#f-21)） | 検討中 |
| 危険なコマンドの実行を設定で防ぐ方法 | Claude Codeの権限の設定（`.claude/settings.json`の拒否の設定等）やCodexの設定で、`git push --force`・`rm -rf`等を実行できないようにする方法と、生成する設定の内容（[C-75](common/design-principles.md#c-75)） | 未着手 |
| CLIツールで使うライブラリ | 質問形式の入力・テンプレート生成などに使うライブラリとバージョン | 未着手 |
| データアクセスのライブラリ | D1とPostgreSQLの両方に対応するライブラリの決定とバージョン（候補：Drizzle ORM）。[C-03](common/backend.md#c-03)のHono版の書き方の前提 | 未着手 |
| Hono版のセキュリティ実装 | [C-27](common/security.md#c-27)〜[C-29](common/security.md#c-29)（CSPの設定値、CSRF・Originの確認方法、CORSの設定方法）とC-28・[C-29](common/security.md#c-29)の必須テストの具体的な実装方法 | 未着手 |
| D1のトランザクションの書き方 | D1の`batch()`を使ったトランザクションの書き方（[C-64](common/backend.md#c-64)）と、Drizzleでの書き方。PostgreSQLの場合との違い | 未着手 |
| Cloudflareでのバッチ処理の使い分け | Cron Triggers・Queues・Workflowsの使い分け、実行時間の上限への対応、同時実行の防止・再開の仕組み（[C-65](common/backend.md#c-65)） | 未着手 |
| インデックス設計の知見 | [C-10](common/backend.md#c-10)の方針を、D1・PostgreSQL向けに具体化して`knowledge/`に登録する（[F-18](functional.md#f-18)） | 未着手 |
