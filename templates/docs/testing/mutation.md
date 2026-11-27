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

- 始める前の確認と異常時の停止は、Skill「テスト」の「重い検証」に従う。初期テストの時間上限は `stryker.config.json` の `dryRunTimeoutMinutes` など、有効な設定を確認する。未設定なら利用中の版の既定値を確認する。[Stryker 10.0.0 の設定資料](https://github.com/stryker-mutator/stryker-js/blob/v10.0.0/docs/configuration.md#dryruntimeoutminutes-number)
- 必要に応じて実行を分けるときは、初期テストが繰り返される時間を見込む。各区分の対象・設定・実行コマンド・開始と終了・終了状態を、結果とログとともに上書きしない場所に保存する。秘密情報を除いて記録し、各区分の結果を合わせて必要な範囲を確認する。

## 5. 後始末

作業用のフォルダ（`.stryker-tmp`）と結果（`reports/`）は Git に入らない。不要なら消す。

## 6. よくある失敗と対処

| 失敗 | 確かめ方・対処 |
| --- | --- |
| 時間がかかりすぎる | 影響範囲と必要な全体確認を維持したまま、分割と結果の保存を検討する。原因が分かってから時間上限の変更や再実行を判断する。 |
