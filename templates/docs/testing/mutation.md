# ミューテーションテストの手順書

テストが、業務ロジックの誤りを見つけられるかを確かめる（対象：`{{mutation_targets}}`）。

## 1. 必要なもの

| もの | 版 | 入れ方 |
| --- | --- | --- |
| Node.js | `.node-version` の版 | PC に直接入れる |
| Stryker | `docs/tech-stack.md` の版 | `npm install` |

## 2. 構築の手順

1. `npm install`
1. 単体テストの手順書の構築を済ませる（`npm test` が通る状態にする）

## 3. 確認の方法

- `npm test` が通る

## 4. テストの実行方法

`npm run mutation`（時間がかかるため、`{{check_command}}` には含めない。影響の大きい処理を変えたときに実行する）

## 5. 後始末

作業用のフォルダ（`.stryker-tmp`）と結果（`reports/`）は Git に入らない。不要なら消す。

## 6. よくある失敗と対処

| 失敗 | 確かめ方・対処 |
| --- | --- |
| 時間がかかりすぎる | `stryker.config.json` の対象を、変えたファイルに絞る |
