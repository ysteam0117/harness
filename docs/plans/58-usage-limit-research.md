# 調査メモ：利用上限による待機と再開の現行仕様（Issue #58）

確認日：2026-11-03。親Issue：#7（Orca連携の選択と統括AIによる開発進行・利用上限後の継続）。関連：#8（上限に達する前の主担当交代）。後続：#59（要件・設計の追記）・#62（テンプレートと Skill）。

## 目的と範囲

#7 の「利用上限による待機と再開」を設計するために、AIクライアントの自動継続の現行仕様と制限を確かめて記録する。コードは変えない。上限の回避、追加課金、別アカウントへの自動切り替えは扱わない。実際の上限の消費はしない。

- 確認した版：Claude Code 2.1.316、codex-cli 0.166.0、`orca` CLI 1.4.245（#57 のメモ）。OSは Windows 11
- 確認の方法
  - 公式資料：Claude Code の `interactive-mode`・`statusline`・`errors`・`hooks`・`headless`、Codex の App Server（https://learn.chatgpt.com/docs/app-server）。取得の日は確認日と同じ
  - 手元のCLI：`claude --help`、`codex --help`、`codex features list`、`codex app-server generate-json-schema`（出力先は作業用フォルダ。この版のプロトコルの定義を取り出すだけで、サーバーは起動しない）
  - 第三者の情報（公式ではない）：Codex の自動再開に関するコミュニティの要望と、外部のラッパー。あくまで参考で、確認済みとは扱わない
- 実行しなかったもの：上限に達する操作、`claude -p` や `codex exec` の実行、Orca から担当を起動する操作。したがって、**上限到達時の実際の画面・出力は、公式資料の記述の範囲でしか確認していない**

## 確認できたこと

### 1. 上限の種類と見分け方

時間で回復する「利用量の上限」と、回復しない・別の対処が要るものを区別する（AC-2）。

| 種類 | Claude Code | Codex | 時間で回復するか |
| --- | --- | --- | --- |
| 利用量の上限（5時間・週間・モデル別） | `You've hit your session limit`／`weekly limit`／`Opus limit`／`Sonnet limit`。claude.ai の購読で出る | エラー種別 `usageLimitExceeded`。上限の状態は `rateLimitReachedType`（`rate_limit_reached`・`workspace_owner_usage_limit_reached`・`workspace_member_usage_limit_reached` など） | する（リセット時刻が決まっている） |
| API の短期のレート制限 | `Request rejected (429)`。自動で間隔を空けて再試行される。**支出の上限・クレジット切れの 429 は再試行しても回復しない**（すぐ失敗する） | エラー種別 `rateLimitExceeded` | 通常はする |
| サーバーの過負荷 | `Repeated 529 Overloaded`。自動で再試行される。**割り当て（クォータ）を消費しない** | エラー種別 `serverOverloaded` | する |
| コンテキストの上限 | `Prompt is too long`・`Context limit reached` | エラー種別 `contextWindowExceeded` | **しない**（`/compact`・`/clear` などで会話を小さくする） |
| 認証の失敗 | `401`・`Login expired`・`Not logged in`・`OAuth token revoked` など | エラー種別 `unauthorized` | **通常はしない**（再ログインが要る） |
| 課金・支出 | `billing_error`、支出上限の 429 | `spendControlReached`（上限の状態の項目）。エラー種別の `sessionBudgetExceeded` も別の値だが、意味は資料で確かめていない（未確認） | しない（利用者が上限を変える） |

- 非対話の Claude Code（`claude -p` の `stream-json`）は、再試行のたびに `system/api_retry` を出す。`error` の値は `authentication_failed`・`oauth_org_not_allowed`・`account_on_hold`・`billing_error`・`rate_limit`・`overloaded`・`invalid_request`・`model_not_found`・`server_error`・`max_output_tokens`・`cloud_credential_error`・`unknown`。**利用量の上限がどの値で出るかは、資料に書かれていない**
- フックの `StopFailure`（API のエラーでターンが終わったときに発火）は、同じ種類の値（`rate_limit` など）で絞り込める。出力や終了コードで動作を変えることはできず、ログや通知などの副作用専用
- Codex は、App Server のエラー通知（`turn/completed` の失敗、`error` 通知）の `codexErrorInfo` に、上の種別が**列挙型で入る**。この版（0.166.0）のプロトコル定義で、`contextWindowExceeded`・`sessionBudgetExceeded`・`usageLimitExceeded`・`rateLimitExceeded`・`serverOverloaded`・`unauthorized` などが別々の値であることを確かめた

→ 資料のうえでは、Codex は種別を機械的に見分けられる。Claude Code は、画面のメッセージと、フック・イベントの種別で見分けるが、利用量の上限が `rate_limit` に当たるかは未確認。

### 2. Claude Code の自動継続

出典：`interactive-mode` の「Wait for a usage limit to reset」。

| 項目 | 内容 |
| --- | --- |
| 動作 | 利用量の上限で作業が止まったとき、**開いているセッションの中で待ち**、リセット後に自動で作業を続ける。続けるときは、Claude に作業の再開を促す（直前のメッセージを再送しない） |
| 版・契約 | Claude Code v2.1.234 以降。claude.ai の購読でサインインした**対話セッション**で、既定で有効（この環境の版は 2.1.316） |
| 設定 | `autoContinueAtUsageLimit`（`/config` の「Continue automatically at usage limit」）。`/config autoContinueAtUsageLimit=false` は `-p` でも使えるが、`key=value` の形では**再び有効にできない**（無人実行を許す設定のため） |
| 取り消し | `Esc`（空の入力欄）・`Ctrl+C`・`/rate-limit-options` で「Don't continue automatically」 |
| 回数 | **自動の継続は3回まで**。3回を超えると `Automatic continue stopped after repeated usage-limit hits` が出て止まる。次のプロンプトを送るか、`/rate-limit-options` で待機を選ぶと数え直す。`/goal` や、セッション内の定期タスクでも3回で止まる |
| 権限 | 継続した作業でも、**権限の確認は通常どおり求められる**。離席中は確認の画面で止まる |

自動で待機を**始めない**場合（利用者が `/rate-limit-options` の「Wait here, then continue automatically」を選べば待てる）：

- Remote Control と、エージェントチームの teammate のセッション
- リセットが24時間より先（週間の上限は何日も先になりうる）
- Opus／Sonnet の上限で、その系統以外のモデルを使っているとき

待機を**そもそも提供しない**場合：

- **バックグラウンドのセッションと `-p` の実行**（メニューの項目が出ない）
- API キー・クラウドプロバイダー・従量課金（リセットがないため）
- 保存された claude.ai のログインがない LLM ゲートウェイ

待機が**継続せずに終わる**場合：

- Claude Code を終了した（**再開しても待機は再開されない**）
- 会話の持ち主が変わった：`/login` でのアカウント切り替え、会話の消去・巻き戻し、`/resume`・`/teleport`・`/tui`・`/restart`、Claude Desktop・バックグラウンド・クラウドへの移動
- 設定を切った、またはリセットが24時間を超えた（自分で始めた待機に限る）
- `UserPromptSubmit` フックが継続のプロンプトを拒否した、またはモデルに届く前に失敗した
- PCがスリープし、約30分より長く眠って、その間にリセットされた場合は、自動では続かず、`Enter` を押す必要がある（短いスリープ、またはリセット前に起きた場合は自動で続く）

### 3. Claude Code の使用量の取得（監視用）

- ステータスラインのスクリプトに、`rate_limits.five_hour` と `rate_limits.seven_day`（`used_percentage`：0〜100、`resets_at`：UNIX 秒）が渡される。ゲートウェイの支出上限は `rate_limits.spend_limit`
- `rate_limits` は **claude.ai の Pro・Max・Ultra の購読者**（またはゲートウェイの支出上限）にだけ入り、**セッションの最初の API 応答の後**に現れる。各窓は個別に欠けることがあり、`resets_at` を過ぎた窓は落ちる。コンテキストの使用率（`context_window.used_percentage`）とは別の項目
- スクリプトは、新しい応答・`/compact`・窓の `resets_at` 到達などで再実行される。**ステータスラインは対話セッションの機能**で、`-p` での提供は資料に書かれていない（未確認）

→ 通常のプログラム（AIでない処理）が、AIの推論なしに使用率とリセット時刻を知る経路になる。これは主に #8 で使う。

### 4. Codex の使用量の取得と自動継続

出典：Codex の App Server の資料、およびこの版のプロトコル定義（`codex app-server generate-json-schema`）。

- 取得：`account/rateLimits/read`（応答に `rateLimits`・`rateLimitsByLimitId`・`rateLimitResetCredits`、この版の定義では `ordinaryUsageAllowed` も）。変化の通知は `account/rateLimits/updated`
- 窓の項目：`primary`／`secondary`（それぞれ `usedPercent`・`windowDurationMins`・`resetsAt`）。`limitId`・`limitName`・`planType`・`credits`。`rateLimitReachedType` が上限に達したときの種類を示す
- App Server のコマンドは `[experimental]`（`codex app-server --help`）。資料にも WebSocket の方式は「実験的で非サポート」とある
- **自動継続**：公式の資料と、この版の機能一覧（`codex features list`）に、**利用上限のリセットを待って自動で作業を再開する機能は見当たらない**。コミュニティに「Auto-Resume after Usage Limit」の機能要望があり、外部のラッパー（`codex-continue`）はリセット時刻を読んで「Continue」を送るが、いずれも公式の機能ではない。したがって、**Codex に自動継続があるとは仮定しない**（Issue の方針どおり）
- 再開の手段（人間・外部の制御処理が使うもの）：`codex resume`（対話）、`codex exec resume`（非対話）、`codex queue --thread <id> --message <text> [--resume]`（既存のセッションにメッセージを積む。`--resume` で、ローカルのデーモン上での再開も試みる）
- リセットの「クレジット」を使う操作（`account/rateLimitResetCredit/consume`）がある。これは**上限の回避・消費にあたる**ため、ハーネスは自動で呼ばない（範囲外）

### 5. 再開の主体の候補と制約

Issue の方針は「再開機能の主体はAIクライアントまたは**AIに依存しない制御処理**とし、上限中のAI推論に依存しない」。

| 主体 | できること | 制約 |
| --- | --- | --- |
| Claude Code 自身の自動継続（対話の端末） | リセット後に自動で続ける | 対話セッションのみ。最大3回。権限の確認で止まる。リセットが24時間先、Remote Control・teammate、終了・`/resume`・`/restart`、長いスリープでは続かない。Orca から**対話の端末として起動された担当**には当てはまる見込みだが、Orca の「チャット」の画面（構造化されたチャット）として動く担当に同じ機能が働くかは未確認 |
| Codex | 自動継続なし（上の4） | 外部の制御処理（リセット時刻を読んで `codex exec resume`／`codex queue` を呼ぶ）か、利用者の手動 |
| Orca の統括（AI） | 担当の状態の確認と待機（`check --wait`）。担当の生存は `live`／`unverifiable`／`exited` で判定し、`unverifiable` では止めない・やり直さない・重複して起動しない（#57） | 統括自身も利用量の上限に達しうる。統括が止まると、待機の判断もできない |
| AIでない制御処理（ハーネスが生成する小さな処理） | 使用率とリセット時刻を読み、リセット後に再開の指示を送る。AIの推論に依存しない | 実装と配布が要る（#59 で採否を決める）。Claude Code では使用率の取得がステータスライン経由で、窓が欠けることがある |
| 利用者の手動 | あらゆる場合の最終手段 | 手順の明記が要る |

## 確認できなかったこと

| 項目 | 状況 | 次にどうするか |
| --- | --- | --- |
| 上限到達時の実際の出力 | 実際の上限を消費しないため、画面・`-p` の出力・終了コード・`result` の内容は確認していない。資料では、`-p` は失敗を `result` に出して非0で終わる、とだけある | 実装後の模擬テストで確認する。実際の上限の消費は前提にしない |
| Claude Code の利用量の上限が `StopFailure`／`system/api_retry` のどの値で出るか | 資料に書かれていない | #62 で、値に依存せず、画面のメッセージとフックの両方を見て判定する設計にするか、実機で確かめる |
| Orca の「チャット」として動く Claude Code での自動継続 | 資料は「対話セッション」としか書いていない。構造化されたチャットが同じ扱いかは不明 | #62・#63 の実機の確認。確認できるまでは、**端末で動く担当**を前提にする |
| Codex の自動継続 | 公式には見当たらない（上の4）。この版（0.166.0）より新しい版にあるかは不明 | 版が上がったときに再確認する。ハーネスは、機能の有無を `codex features list` などで調べ、なければ案内する |
| `claude -p`・`codex exec` で上限に達したときの再開の実際 | `claude -p` は `--resume <session_id>` で再開できる。`CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` で、中断したターンを続けられる、とある。実行はしていない | #62 の検証 |
| 統括自身が上限に達したときの Orca 側の動き | Orca は、担当の状態を判定するが、統括の上限は扱わない（#57 の範囲では記述なし） | #59 で、統括の状態の保存と、別の主体による再開を設計する |
| Claude Code の `autoContinueAtUsageLimit` の現在の設定値 | この環境の設定は確認していない（導入先ごとに異なる） | 生成物に設定を書かない。導入先で、利用者が確かめる手順にする |
| 複数の窓がある場合の判定 | 5時間・週間・モデル別の複数の窓があり、Codex は `limitId` ごとに複数の枠を返す。どの枠が作業を制約するかの規則は資料にない | #8 で定義する。#7 では「リセットが最も遅い、上限に達した枠を待つ」を案とする（要確認） |

## 設計への影響（前提と制約）

後続の設計（#59・#62）に渡す前提と制約。再開が成功したことを、確認なしに前提にしない。

| # | 前提・制約 | 影響する Issue |
| --- | --- | --- |
| 1 | 待機の対象は、時間で回復する**利用量の上限**だけ。コンテキストの上限・短期の 429・過負荷・認証の失敗・支出の上限は、待機の対象にせず、別の扱いにする（見分け方は上の1） | #59・#62 |
| 2 | Claude Code の自動継続は**対話の端末で動く担当**にだけ期待する。`-p`・バックグラウンド・Remote Control・teammate・API キー／従量課金・リセットが24時間より先の場合は、自動継続を前提にしない | #59・#62 |
| 3 | 自動継続は3回まで。3回を超えた、または権限の確認で止まった場合は、**成功扱いにせず**「再開できなかった」として利用者に知らせる | #59・#62 |
| 4 | Codex には自動継続があると仮定しない。再開は、外部の制御処理か手動（`codex resume`／`codex exec resume`／`codex queue`）で行う | #59・#62 |
| 5 | **上限中のAIには記録処理を期待できない**。進捗・完了条件・未解決事項・次の作業・担当の識別情報は、**作業の区切りごとに、上限に達する前に保存**する | #62 |
| 6 | 担当の状態の判定は、Orca の `live`／`unverifiable`／`exited` に従う。上限による待機を、完了・失敗と誤認しない。`unverifiable` では止めず、やり直さず、重複して起動しない（#57）。応答が失われたときの再実行は `--retry-request` を使う | #59・#62 |
| 7 | 統括自身が上限に達する場合を扱う。統括が止まっても、担当の状態と次の作業が、保存された記録から再開できる設計にする | #59・#62 |
| 8 | 再開不能の場面を明記する：セッションの終了（待機は再開されない）、会話の持ち主の変更（`/resume`・`/restart`・アカウントの切り替えなど）、PCのスリープ（長いと `Enter` が要る）、3回の上限、承認待ち、機能の非対応。それぞれ、手動での再開の手順を添える | #59・#62 |
| 9 | 手動での再開の手順の前提：保存された記録を読み、担当の所有権と状態を確認してから再開する。再開の前に、同じ作業を二重に依頼しない | #62 |
| 10 | 上限の回避、追加料金の自動有効化（`/usage-credits` など）、別アカウントへの自動切り替え、リセットのクレジットの自動消費は行わない | #59・#62 |
| 11 | 設定（`autoContinueAtUsageLimit` など）を、生成物で書き換えない。利用者の環境の設定は、利用者が確かめる | #62 |
| 12 | 使用率の取得（Claude Code：ステータスライン、Codex：`account/rateLimits/read`）は、#8 の入力になる。#7 の範囲は「上限に達した後の待機と再開」で、上限に達する前の交代は #8 で扱う | #8 |
