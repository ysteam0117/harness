# 調査メモ：Orca CLI・オーケストレーションの現行仕様（Issue #57）

確認日：2026-11-03。親Issue：#7（Orca連携の選択と統括AIによる開発進行）。後続：#59（要件・設計の追記）・#60・#62・#63。

## 目的と範囲

導入先のアプリで統括AIがOrcaのオーケストレーションを使うための設計に必要な、Orca CLIの現行仕様を確かめて記録する。コードは変えない。

- 確認した版：`orca` CLI 1.4.245（`orca --version`。`orca status --json` の `runtime.appVersion` も同じ値）。OSは Windows 11
- 参考に確かめた他のCLIの版：Claude Code 2.1.316、codex-cli 0.166.0
- 確認の方法は**読み取りだけ**にした：`orca --help`、`orca <コマンド> --help`、`orca status --json`、`orca agent-context --json`（コマンドの定義の一覧）、`orca skills list`／`orca skills get`（このCLIの版に合わせて同梱されたガイド）、`orca account list --json`
- 実行しなかったもの：`open`、`serve`、`worktree create`、`agent launch`、`orchestration worker-start`、`terminal create` など、プロセスやworktreeを起動・変更するコマンド（副作用があるため）。起動の動作は、下の「確認できなかったこと」に分けて記録する
- 記録に含めないもの：アカウント情報、認証の状態の中身、個人の環境のパス・ID（AC-4）

## 確認できたこと

### 1. CLIの存在・バージョン・機能の確認方法

| 項目 | 確認できた内容 |
| --- | --- |
| 存在 | `orca` が PATH にあるかで確かめる（このマシンでは Orca の配布物の中の `bin` が PATH に入っていた） |
| 版 | `orca --version` が版（`1.4.245`）だけを出す |
| 実行状態 | 多くのコマンドは、Orca本体（ランタイム）が起動している必要がある。起動していなければ `orca open` を先に実行する。`orca status --json` が、アプリの起動（`app.running`）・ランタイムの状態（`runtime.state`・`reachable`）・版（`appVersion`）・機能の一覧（`runtime.capabilities`）を返す |
| 機能の有無 | `runtime.capabilities` に、機能ごとの識別子が並ぶ（例：`orchestration.contract.v1`・`orchestration.worker-launch-preferences.v1`・`orchestration.worker-stop-verdict.v1`・`orchestration.federation-*`）。版の数字ではなく、この識別子の有無で機能を判定できる |
| コマンドの定義 | `orca agent-context --json` が、全コマンドの定義（`schemaVersion: 1`、288件。用法・フラグ・例・注意）を返す |
| 同梱のガイド | `orca skills list`／`orca skills get <名前>` が、このCLIの版に合ったガイドを返す。`orchestration`・`orca-cli` のガイドがある。参照文書は `--reference references/<名前>.md`、全文は `--full` で取れる。古いCLIは `--reference`・`--full` を拒否することがある |
| 古い接続先 | 古いホストは `--model`・`--effort` を拒否する。接続先とクライアントの版は別々に更新されるため、省略できる項目は「ない」ものとして扱う |

### 2. オーケストレーションの流れ（統括と担当）

用語：**Run**（まとまりの単位。統括の受信箱でもある）、**Task**（作業）、**Dispatch**（Taskの1回の試行。権限の根拠になる）。

統括の標準の流れ（`orchestration` ガイド）：

1. `orca status --json` で状態を確かめる
2. `orca orchestration run-create --objective "<目的>"` でRunを作って結び付ける（再起動後は `run-use --id <run_id>`）
3. `orca orchestration worker-start --spec "<作業>" --worktree current --agent <agent>` で担当を起動する。独立した作業は、待つ前にまとめて起動する。依存があるときは `task-create`（`--deps`）と `worker-start --task` を使う
4. `orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms <n>` で報告を待つ。質問には `reply`、受け取った報告は検証してから `--ack` する
5. 受け取った担当は、再利用（同じ端末で次のDispatch）・保持（`worker-retain`）・解放（`worker-release`）のどれかに必ず決める

担当の義務：指示は注入された前置き（Task／Dispatch の識別子つき）に従う。統括への質問は `ask` を使い、利用者に直接質問する画面を開かない。決まった間隔で心拍を送る。区切りで統括の追加指示を読む。完了は `worker_done` を1回だけ、`--outcome succeeded|failed` を明示して送る。

Taskの指示（spec）に含めるもの：対象（Target）・変更（Change）・制約（Constraints）・編集の範囲（Ownership）・確認できる受け入れ条件（Observable acceptance）。これはC-66の「担当ごとに対象・制約・編集範囲・依存関係・受け入れ条件を明示する」と同じ内容で、そのまま対応できる。

担当の起動：`--agent` に指定できるのはOrcaが知っているエージェントの識別子（`claude`・`codex` など）。`--model`・`--effort` は、利用者がモデルを名指ししたときだけ渡し、そうでなければ省いて利用者の設定に任せる（ガイドの方針）。`--effort` は `--model` と一緒にだけ使える。起動した結果は、要求（`launch.requested`）と実際（`launch.effective`）を比べて確かめる。

引き継ぎ（handoff）と監督（orchestration）は別物：「引き継ぐ」は所有権を渡して元のAIが止まる操作で、`orca-cli` の `worktree create --agent`・`agent launch` を使い、Run／Task／Dispatch は作らない。進行の監督・完了の追跡・DAG・判断の関門（decision gate）・質問と返信が要るときだけ、orchestration を使う。**#7は監督、#8の主担当交代は引き継ぎに近い**ため、設計で分けて扱う。

### 3. 拠点と配置（Primary・専用worktree）

- 配置は `--worktree current|<selector>|new-child|new-top-level`。既定の考え方は「現在または既存の作業場所に、新しい担当の端末を作る」で、**worktreeを新しく作るのは、利用者が求めたとき、またはチェックアウトやファイルの衝突で共有が危ないときだけ**
- 独立した作業は `worktree create --no-parent`（起点のブランチは既定のままにし、`--base-branch` は利用者が積み重ねを求めたときだけ使う）
- フォルダだけの作業場所（Gitなし）も正式に扱える。Gitやworktreeの系譜を前提にしない
- 別のOrcaサーバー（SSH・WSL など）に置くときは `--on <環境>`。RunとTaskは現在のサーバーが持ち、担当の状態・停止・後片付けの事実は実行するホストが持つ
- 選択子：`id:<repoId>::<path>`・`name:`・`path:`・`branch:`・`issue:`・`active`／`current`

### 4. 担当の状態の判定と、待機中の重複防止

- 担当の生存の判定は3値：`live`（生きている）・`unverifiable`（確認できない）・`exited`（終了を確認）。**接続の喪失や無応答は、終了の証拠にならない**
- 停止・放棄・再試行・解放をしてよいのは、**終了の確認（`exited`）、または受理された完了報告があるときだけ**。`unverifiable` や無応答のときは、待つか調べるだけで、止めない・やり直さない・重複して起動しない
- 待機がタイムアウトしても失敗ではない（確認の区切り）。3回連続で空のときは、`worker-list --run <run_id> --json` で行ごとの `projection.liveness`・`attention`・`nextAction` を見る
- 端末の状態（`worker-show` の `observation.status`）は端末が生きているかだけで、AIが止まっているかは分からない。AIの状態は `worker-list` の判定が優先する
- どの変更系コマンドも `--retry-request <id>` を受け付け、応答が失われたときに同じ操作を重複させずに再実行できる。起動の再実行は `--retry-launch <operationId>`（`agent launch`）
- 失敗した担当は `--retry-of` で置き換える。置き換え先の配置は引き継がれないので、毎回明示する

→ #7の「待機中の担当への重複依頼・重複起動を防ぐ」は、上の判定の規則とIDによる再実行で実現できる。ハーネス側の独自の仕組みは、状態の保存形式と、再開の手順の指示に絞れる。

### 5. 担当・AIの利用可否の確認

- `claude --version`・`codex --version` で、各AIのCLIの存在と版を確かめられる
- `orca account list --json` が、管理しているアカウントの一覧と、既定のAIの認証の有無を示すフィールド（例：`systemDefault.hasAuth`）を返す。**中身は個人の情報なので、ハーネスの生成物・記録には出さない**。使うときは、有無の真偽だけを見る
- ログイン（`orca account add`）は、利用者が自分の環境で行う。ハーネスは認証情報を持たない

### 6. 設定生成と起動の分離

- AIやworktreeを起動するのは、`worker-start`・`agent launch`・`worktree create --agent`・`terminal create` など、**明示したコマンドだけ**。`harness create`／`update`／`adopt` がこれらを呼ばなければ、生成しただけで起動も作業開始も起きない。分離は、生成側にOrcaのコマンドを呼ぶ処理を入れないことで保てる
- 「環境の確認」だけは、読み取りのコマンド（`--version`・`status --json`）で、起動を伴わずにできる

### 7. 自動実行（Automation）

- CLIには `automations` のコマンドがあるが、#7の範囲外（質問・設定を作らない）。ハーネスの質問・生成物に出さない

## 確認できなかったこと

| 項目 | 状況 | 次にどうするか |
| --- | --- | --- |
| 「Primary」の定義 | CLIのヘルプとガイドに「Primary」という語や、統括の拠点をPrimaryに指定する操作が**見当たらない**。`current`（統括のいる作業場所）・既存の作業場所・新しいworktreeの指定はある | #59で用語を決める。「Primaryとはどの作業場所か」は、Orcaの画面上の概念の可能性があり、CLIで指定できるかは未確認 |
| Windowsで外部のウィンドウを開かないこと | ガイドにWindows固有の記述はない。担当は、利用者の「新しいエージェントのタブ」の設定（Chat UI）に従って、Orcaの中のチャットか端末で動く、とある。外部のウィンドウを開く経路はガイドに出てこないが、**実際の起動での確認はしていない**（起動は副作用があるため） | #63で、模擬・実機の確認として実施する。AC：外部のウィンドウが生成されないこと |
| 起動系コマンドの実際の動き | `worker-start`・`worktree create --agent` の実行結果（起動の成否、`launch.outcome.kind`、`prompt.outcome`）は未実行 | #62・#63の検証で、模擬のランタイムと、対応環境の実機で確かめる |
| `orca` が未導入のときの表示 | このマシンには導入されているため、未導入の挙動は未確認（シェルの「コマンドが見つかりません」になるはず） | #63で、PATHにないときの扱いを模擬して確かめる |
| 別worktreeへの要件の渡し方 | ガイドに、未コミットのファイルが共有されるという記述はない。worktreeは別のチェックアウトなので、**コミット済みの内容と、Taskの指示（spec）・プロンプトだけが渡る**と考えるのが安全（これは調査からの推論で、実機では未確認） | #59で方式を決める（案：要件定義書とルールをコミットしてから分岐し、specにファイルの場所と受け入れ条件を書く） |
| 古い版・ほかのOS | 1.4.245・Windows 11 だけを確認した。古い版の挙動、macOS・Linuxは未確認 | #63で、機能の識別子（`capabilities`）の有無で判定する方針にし、不足は案内する |
| チャットとして動く担当の扱い | 担当は端末とは限らず（`worker-start` の注意）、`terminal` 系のコマンドが受け付けないハンドルがある。`worker-read --source auto` などは両方に使える | #62で、端末系のコマンドではなく、orchestration のコマンドを正とする |
| 実際の上限・待機中の動き | 本メモの範囲外（#58） | #58 |

## 設計への影響（前提と制約）

後続の設計の入力として、守る前提と制約を一覧にする。

| # | 前提・制約 | 影響する Issue |
| --- | --- | --- |
| 1 | 機能の有無は、版の数字ではなく `orca status --json` の `runtime.capabilities` の識別子で判定する。見つからない任意の項目は「ない」として扱う | #63 |
| 2 | 環境確認は、読み取りのコマンド（`--version`・`status --json`・`account list`）だけで行い、AIやworktreeを起動しない。連携なしでは、`orca` を一切呼ばない | #63 |
| 3 | 生成（`create`／`update`／`adopt`）は、AI・端末・worktreeを起動するコマンドを呼ばない。起動は、導入先で利用者が統括に指示してから行う | #59・#63 |
| 4 | モデル名・推論の強さは、利用者が決めたときだけ `--model`・`--effort` に渡す。ハーネスの役割別の割り当て（`role-models.yaml`）をOrcaの引数に固定で入れるかは、#59で決める | #59・#60 |
| 5 | 統括の指示は、orchestration の標準の流れ（Run→worker-start→check→reply→解放）と、Taskの指示の5項目（対象・変更・制約・編集範囲・受け入れ条件）に合わせる。C-66の役割とそのまま対応する | #59・#62 |
| 6 | 担当の停止・放棄・再試行・解放は、終了の確認または受理された完了報告があるときだけ。`unverifiable`・無応答・タイムアウトは待つ。#7の重複起動の防止は、この規則と `--retry-request` で担う | #59・#62 |
| 7 | 別worktreeには、コミット済みの内容とspecだけが渡ると仮定する。要件・ルールは、コミットしてから渡すか、specに自己完結で書く | #59・#62 |
| 8 | 担当はOrcaの中のチャットか端末で動く（利用者の設定）。端末系のコマンドに頼らず、orchestration のコマンド（`worker-read` など）を使う | #62 |
| 9 | 監督（orchestration）と引き継ぎ（handoff）を区別する。#7は監督、#8は引き継ぎに近い | #59・#8の分割 |
| 10 | 認証情報・アカウントの中身・個人の環境のパスを、生成物・記録に出さない。AIの利用可否は、真偽だけを見る | #62・#63 |
| 11 | Automation（定期実行）の質問・設定は作らない | #60 |
| 12 | 「Primary」の定義と、統括の拠点の指定方法は未確定。#59で用語を決める | #59 |
| 13 | Windowsで外部のウィンドウを開かないことは、実機で確かめるまで「確認済み」と書かない | #63 |
