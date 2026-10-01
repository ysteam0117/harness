# 技術スタック

確認日：2026-10-01（バージョンは、この日時点の最新の安定版）

## 実行環境

| 項目    | バージョン | 備考                                                                   |
| ------- | ---------- | ---------------------------------------------------------------------- |
| Node.js | 24.19.0    | `.node-version` で固定。CI も同じ値を使う。`package.json` の engines は `>=24` |
| npm     | 11 系      | Node.js 24.19.0 に同梱のものを使う                                     |

## ライブラリ（dependencies）

| ライブラリ     | バージョン | 選定理由                                                                              |
| -------------- | ---------- | ------------------------------------------------------------------------------------- |
| @clack/prompts | 1.8.1      | 対話式の質問（create で使う）を、見やすい表示で実装できる。標準機能には質問の部品がない |
| commander      | 15.0.0     | コマンド（create・update・status）とオプション・ヘルプの定義に使う。広く使われている  |
| yaml           | 2.9.1      | YAML の読み書き。コメントを保ったまま書き換えられる                                   |
| diff           | 9.0.0      | update でファイルの差分を表示・判定するために使う                                     |
| semver         | 7.8.5      | ハーネスのバージョンの比較に使う。自前の比較はバグの元になる                          |

## 開発用の道具（devDependencies）

| 道具              | バージョン | 用途                                                             |
| ----------------- | ---------- | ---------------------------------------------------------------- |
| typescript        | 6.0.3      | 型チェックとビルド。typescript-eslint が 7 系に未対応のため 6 系 |
| vitest            | 4.1.11     | テスト。TypeScript のプロファイルの組み合わせの条件に合わせた    |
| eslint            | 10.11.0    | Lint                                                             |
| @eslint/js        | 10.0.1     | ESLint の推奨ルール                                              |
| typescript-eslint | 8.71.0     | TypeScript 用の ESLint ルール                                    |
| prettier          | 3.9.9      | 整形（CLI のコードと設定ファイルだけが対象）                     |
| @types/node       | 24.19.0    | Node.js の型                                                     |
| @types/semver     | 7.8.0      | semver の型                                                      |
| smol-toml         | 1.9.0      | Codex のエージェントの TOML の出力を、第三者の読み込み役で読み戻して確かめるため。テストだけで使い、配布物に含めない。依存がなく、更新が続いており、TOML 1.0 に対応している。@iarna/toml は2023年から更新がない |

## GitHub Actions（CI）

| actions              | バージョン（タグ） | 用途                                                                      |
| -------------------- | ------------------ | ------------------------------------------------------------------------- |
| actions/checkout     | v7.0.1             | リポジトリの取得                                                          |
| actions/setup-node   | v7.0.0             | Node.js の準備。`node-version-file: .node-version` と `cache: npm` を使う |

setup-node v7 でも `node-version-file` と `cache: npm` が使えることは、公式の README で確認した（2026-10-01）。

## 組み合わせの条件

- typescript は 6 系にとどめる。typescript-eslint 8.71.0 が TypeScript 7 系に対応していないため
- vitest は TypeScript のプロファイルの組み合わせの条件に合わせる
- @types/node は Node.js のバージョン（24 系）に合わせる
- すべてのバージョンは `package.json` で完全一致の値に固定する（`.npmrc` の `save-exact=true`）

## 標準機能で済ませたもの

- TypeScript の実行：スクリプト（scripts/\*.ts）は Node.js 24 の型の除去でそのまま実行する。tsx は使わない
- ファイルの読み書き・パスの操作：`node:fs`・`node:path` を使う
- 引数の解析以外のコマンド実行：`node:child_process` を使う

## バージョンを上げる手順

1. 上げる対象の更新内容（変更履歴）を確認する
2. `npm install --save-exact <名前>@<バージョン>` で上げる
3. この文書の表のバージョンと確認日を更新する（`test/package.test.ts` が `package.json` との一致を確認する）
4. `npm run check` を実行して通ることを確認する
5. 組み合わせの条件（上の節）に影響がないか確認する
