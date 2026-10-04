# 作業の引き継ぎと次の実行計画

確認日：2026-10-04。対象：`ysteam0117/harness`。

## 現在の状態

- #56のPR #67は利用者承認のもとmerge済み（`b7df79ae1421572652744c4706160c2890404877`）。Issue #56はclose済み。
- 現在のブランチは`feature/51-environment-isolation`。Issue #51の実装・レビュー・文書作業を進行中。外部Issueコメント、PR、commitはこの作業では行わない。
- #51は、環境別`.env`選択と検証、親環境変数の除去、Vite dotenv自動読込の遮断、test scripts/DB/Composeの環境別入口、PostgreSQLの`_test`規則と接続値照合、D1/R2保存先分離、Vitest一時D1維持、buildでの開発変数拒否、test-safetyの`--remote`検出を追加。
- `db:generate -- --name <名前>`は引き続き利用できる。test-safetyはtest系npm scriptsとその呼出し、関連するscript/configおよび相対importを再帰的に検査する静的検出であり、全実行経路を保証するものではない。

## 役割とレビュー記録

- 役割モデル：計画・計画レビュー・コードレビューはGPT-6 Sol high、test・実装はSol medium、qualityはLuna low、docはLuna medium。
- 最初はrootが直接draftした後、役割ごとの工程へ修正した。
- 計画レビューは2回。1回目の重大指摘1件を採用して修正し、2回目は指摘0件。
- コードレビューは3回。1回目は重大3件・軽微1件をすべて採用。2回目は重大指摘1件が残り採用して修正。3回目は指摘0件。最終smoke差分のみ追加の安全確認中。
- 文書確定後の品質subsetでREADME文言とSkill/config hash snapshotの不一致が見つかり、README/Skillは文書担当が更新。最新lint/typecheckは成功との報告。最終smoke差分の補足レビューでは軽微指摘1件を採用し、再確認で指摘0件。
- 初期REDとnpm追加2ケースのREDは確認済み。後から加えたport/nameケースは並行編集のためREDを観測していない。

## 検証状況

| 項目 | 状況 |
| --- | --- |
| 環境分離テスト | 53件成功との報告 |
| 既存生成テスト | 4ファイル・539件成功との報告 |
| root typecheck・pack | 成功との報告 |
| none生成物のcheck/build/dev/API/Docker | 成功との報告（最終smoke追加前） |
| 最終smokeのdev/test表示とD1・PostgreSQL開発データ不変確認 | コード追加後の実走なし。安全確認中 |
| 全品質check | 未実施。sandbox外実行はautoapproval reviewの利用上限で拒否 |
| D1・PostgreSQL・DBなしの必須3系統smoke | 未実施 |
| 単独test/auditのsandbox失敗 | 環境制約による失敗であり、最終品質成功とは扱わない |

各結果は実行済みと未実行を区別し、未実施項目を成功と記録しない。

### 2026-10-04 文書確定後の追加記録

以下は上表の初期報告を置き換えず、文書確定後に加わった確認として記録する。対象はREADME・Skill/config hash snapshot更新と最終smokeコード差分を含む作業版。

| 項目 | 状況 |
| --- | --- |
| 指定5ファイルの生成テスト | 成功との報告 |
| 環境分離テスト | 592/592件成功（上記53件を含む）との報告 |
| 最終typecheck・変更対象test ESLint | 成功との報告 |
| root lint・speccheck | 成功との報告 |
| formatcheck・`git diff --check` | 最終確認で成功との報告。GitのCRLF→LF予定警告はある |
| pack | 成功報告は安全性helper・文書更新より前の版。最終版では未再実行 |
| none系Docker smoke | 成功報告は最終smoke追加より前の版 |
| sandbox外での全品質check | 未実施。自動承認レビューの利用上限で実行できず |
| `SMOKE_REQUIRE_DOCKER=1`のD1・PostgreSQL・DBなし3系統smoke | 未実施 |

この追加記録時点では、前版の成功を最終版の再検証済みとして扱わず、全品質check・必須smokeを未実施としていた。後続の実行結果は次の追加記録に記す。

### 2026-10-04 認証fixture修正版の追加記録

これは上記作業版の後に認証fixtureを修正した版の結果。以前の記録は保持する。

- `scripts/smoke-generated.ts`は、認証を使うfixtureの空の`SESSION_SECRET`・`OIDC_*`項目だけに架空の環境別値を設定する。DBなしのfixtureには値を追加せず、もともと明示値のあるfixtureは非空の値を維持する。Docker smokeが再生成するfixtureでも同じ扱いにする。この変更の承認は、利用者からの3DB smoke失敗報告を受けた後に得た。
- 修正後の追加テストは6件成功。計画レビュー1回は重大指摘0件。限定コードレビュー1回は重大・軽微とも0件。
- 修正後の全品質checkは39ファイル・1359件成功、2件skip、本番依存の脆弱性0件。初回はfixture依存の失敗があり、修正後の再実行結果を記録している。
- 最新版の3DB smokeは未実施。`docker info`で`npipe`の`dockerDesktopLinuxEngine`が見つからずDocker Desktopへ接続できなかったためで、sandboxの利用上限による未実施ではない。上記のnone系Docker smoke成功報告も、この最新版の3DB smoke成功を意味しない。

当時残っていた確認として、Docker Desktopを起動した後、Orca埋め込みターミナルで`docker info`が成功することを確認し、次を実行するよう案内した。

```powershell
$env:SMOKE_REQUIRE_DOCKER = "1"
$env:SMOKE_CASES = "d1,postgresql,none"
npm.cmd run smoke:generated
```

この実行前に既存DB・Docker volumeを削除しない。smokeは専用の一時生成物を対象にする。Dockerに接続できない場合は成功扱いにせず、そのエラーを共有する。

### 2026-10-04 利用者実行の最終smoke

上記fixture修正版に対して、利用者が3系統のsmokeを実行し、`d1`・`postgresql`・`none`すべて成功し、「生成したプロジェクトの確かめに成功しました」と報告した。これは利用者による実行結果で、こちらでは再実行していない。以前のDocker接続失敗はその時点の状態として残す。個別の手動確認手順は別途未実施であり、自動smoke成功を手動確認済みとは扱わない。

同じ最終作業版で`npm.cmd run pack:check`を実行し、配布物の確認と`create`がexit 0で成功したとの報告があった。これは先行記録にある最終版以前のpack結果を更新する。

### 2026-10-04 PR #68 CI修正の記録

- 初回コミット`1c59609`でPR #68を作成。CIの3 OS qualityは成功し、PostgreSQL・DBなしのsmokeも成功したが、D1 smokeは開発サーバーのhealth確認でHTTP 500となり失敗した（run `37204947518`）。この時点で3系統すべてのsmoke成功とは扱わない。
- 原因調査では、空きポート取得がIPv4を選ぶ一方、Viteの既定host/probe URLがlocalhost経由でIPv6を選ぶ差を仮説とした。`startDevServer`のhostとprobe URLをともに`127.0.0.1`へ統一。追加した2件の失敗テストは修正後に成功し、typecheckも成功との報告。production reviewは重大・軽微とも0件。
- 新しいテスト用fakeを自然終了させ、fixtureの後始末も修正した。初回テストはWindowsのプロセス制約でtimeoutしたため、修正後に確認した。
- 修正版の全checkは39ファイル・1361件成功、2件skip、本番依存の脆弱性0件。lint・typecheck・formatcheck・speccheckも成功との報告。
- CIの修正後runは再push予定で未確認。これらの完了前に修正版D1 smokeの成功を記録しない。先行版での利用者実行3系統成功は先行履歴として残す。

## 個別手動確認手順（未実施）

すべてOrca埋め込みターミナルで行う。既存DB・ボリューム・データの削除やresetはしない。実施時は新規のテスト用DB/保存先を用意する。

1. `.env.example`を`.env.development`と`.env.test`へコピーし、`APP_ENV`をそれぞれ`development`・`test`にする。PostgreSQLでは検証用DB名を`_test`で終わらせ、開発と別のポート・資格情報を指定する。
2. `npm run env:check`と`npm run env:check -- test`で環境名と項目名だけが表示され、値が表示されないことを確かめる。
3. 開発用に架空データを作成し、`npm run test`の前後で開発データが変わらないことを確かめる。
4. 親プロセスに接続環境変数を置いたケース、APP_ENV不在・不正値、外部DB URL、テストDB名違反、test scripts内の`--remote`が起動前に拒否されることを確認する。
5. D1/PostgreSQLを使う場合は新規のテスト専用ローカルDBで`db:*:test`と`docker:up:test`を確認し、開発用とはComposeプロジェクト・DB名・保存先が分かれることを確かめる。最終自動smokeの成功報告は、この個別確認を実施したことを意味しない。

## 文書作業

環境分離の要件（C-40）、F-27の管理対象、生成README・秘密情報手順・Drizzle Skill、設計書を実装と一致させる。設計書とREADMEにはローカル防護の範囲と未実施検証を明記する。追加依存はない。

## 次のIssue

既定の順序は`#56 → #51 → #42 → #63＋#61 → #64 → #65 → #66 → #57 → #37 → #35 → #38・#41 → #36`。PR #68のCI修正後runと修正版D1 smokeの確認が残る。先行版での3系統成功報告と修正版の検証状況を混同しない。個別手動確認も未実施として区別する。
