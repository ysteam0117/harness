# 3. 機能要件

| ID | 機能 | 優先度 | 概要 |
| --- | --- | --- | --- |
| <a id="f-01"></a>F-01 | 対話形式でのハーネス生成 | MUST | プロジェクトを作るときに質問に答えると、条件に合ったハーネス一式が生成される |
| <a id="f-02"></a>F-02 | 使用AIの選択 | MUST | Claude Code・Codexから複数選択できる。選んだAIごとに設定ファイル（`CLAUDE.md`、`AGENTS.md`等）を生成する |
| <a id="f-03"></a>F-03 | AIの追加 | SHOULD | 共通ルールには手を加えずに、アダプタを追加するだけで対応AIを増やせる |
| <a id="f-04"></a>F-04 | 共通ルールの一元管理 | MUST | AIに依存しないルールは1か所で管理し、各AI向けのファイルはそこから生成・参照する |
| <a id="f-05"></a>F-05 | プロジェクト種別の選択 | MUST | Webアプリ／APIのみ／モバイルアプリ等から選べる |
| <a id="f-06"></a>F-06 | フロントエンド・バックエンドの有無の選択 | MUST | 有無を選べる。種別から確定する場合は質問を省略する |
| <a id="f-07"></a>F-07 | 技術スタックの選択 | MUST | フロントエンド・バックエンド・インフラを**別々の質問**で選ぶ（後から選択肢を追加したときに、自由に組み合わせられるようにするため）。言語・フレームワークに加え、**データアクセス方式**（MyBatis／JPA／Prisma等）と**オブジェクトマッパー**（MapStruct／手書き等）を選べる。選択肢は言語・DBに応じて絞り込む |
| [F-08](#f-08) | 回答の整合性チェック | MUST | 回答どうしの組み合わせを確認する。技術的に成り立たない場合はエラーとして選び直してもらい、成り立つが推奨しない場合は警告を表示して**そのまま続行できる**（技術的に可能であればクライアントの希望を優先するため） |
| <a id="f-09"></a>F-09 | DBの選択 | MUST | 有無と種類を選べる。ありの場合、マイグレーション・シード・削除用スクリプトのルールと、`.env.example`の該当する項目を生成する。DB用のコンテナは、PostgreSQLの場合だけ`docker-compose.yml`に含める（[C-36](common/project-env.md#c-36)） |
| <a id="f-10"></a>F-10 | 認証方式の選択 | MUST | 認証なし・アプリ独自認証・外部IdPによるOIDC認証・両方式の併用から選べる。認証ありの場合、方式に応じたログインUI・認証／認可テスト・セキュリティ確認項目をルールに加える |
| <a id="f-11"></a>F-11 | インフラ・デプロイ先の選択 | MUST | デプロイ先（初回はCloudflare）を選べる。開発環境はDocker（[C-36](common/project-env.md#c-36)）、環境は開発・検証・本番の3つ（[C-40](common/project-env.md#c-40)）で固定とし、環境ごとの設定・IaC（[C-39](common/project-env.md#c-39)）・デプロイの手順と承認のルール（[C-41](common/project-env.md#c-41)）を生成する |
| <a id="f-12"></a>F-12 | CIの選択 | MUST | CIの利用は、[F-16](#f-16)の「品質チェックの実行場所」の質問で決める（GitHub Actionsを含む場合にCIを使う）。CIの種類は初回はGitHub Actionsのみとし、ワークフローファイルとマージ条件を生成する |
| <a id="f-13"></a>F-13 | 公開・非公開の選択 | MUST | 公開の場合、MITライセンスの`LICENSE`を生成し、READMEの作成とコミット前の秘密情報チェックを必須にする。秘密情報のルール（[C-05](common/security.md#c-05)）自体は、公開・非公開にかかわらず適用する |
| <a id="f-14"></a>F-14 | 開発人数の選択 | MUST | 1人／複数人を選べる。どちらもレビューは実装したAIとは別のAIで行う（[C-33](common/workflow.md#c-33)）。複数人の場合はコンフリクト防止の手順（[F-15](#f-15)）を加える |
| [F-15](#f-15) | コンフリクト防止の手順 | MUST | 複数人の場合、作業開始前・push前・マージ前にリモートの最新状態と比べて衝突を検査する。衝突があれば自動プッシュを止めてユーザーに報告する |
| [F-16](#f-16) | 技術スタックに応じた品質チェック | MUST | 選択された技術スタックに応じて品質チェックを自動で選び、実行場所（ローカル／GitHub Actions／両方）に応じた設定を生成する |
| [F-17](#f-17) | Superpowers利用案内 | MUST | Claude Code・Codex向けの生成設定にSuperpowersの作業フローを反映し、READMEに環境別の導入・利用確認手順を含める |
| [F-18](#f-18) | 知見の蓄積と配布 | MUST | SQLの書き分けやインデックス設計などの判断基準（ヒューリスティクス）をハーネスのリポジトリに蓄積し、選んだ技術スタックに関係するものを生成するプロジェクトへ配布する |
| [F-19](#f-19) | バージョンの調査と選定理由の記録 | MUST | 選んだ技術について、最新の安定版などを調べたうえで採用するバージョンを決め、なぜそのバージョンにしたかを記録する |
| [F-20](#f-20) | ファイル保存の選択 | MUST | 利用者がアップロードするファイルを扱うかと、ファイルの種類を選べる。扱う場合は、非公開の保存先（初回はCloudflare R2）とアップロード処理のひな形を生成する |
| [F-21](#f-21) | AI向け設定ファイルの構成 | MUST | 共通ルールの核を`AGENTS.md`に、分野別の詳細をSkillに分けて生成し、役割ごとのエージェントの定義から必要なSkillだけを読み込ませる |
| [F-22](#f-22) | 共通仕様とテンプレートの対応の確認 | MUST | 共通仕様の各項目が、生成するテンプレート（`AGENTS.md`・Skill・エージェントの定義）のどこかに反映されているかを自動で確認する |
| [F-23](#f-23) | ハーネスの改善の提案の仕組みの生成 | MUST | 改善の提案（[C-78](common/workflow.md#c-78)）を記録するIssueテンプレート・ラベル・設定を生成し、ハーネス側で提案を集める手段を用意する |
| [F-24](#f-24) | 技術プロファイル | MUST | ライブラリごとのルールを「技術プロファイル」として持ち、利用者が選んだライブラリのルールだけを生成するプロジェクトに入れる。共通の部分は1か所に書いて引用する |
| [F-25](#f-25) | AIの権限の設定と秘密情報の確認の生成 | MUST | 危険なコマンドに確認を求め・禁止するAIの設定、足りない秘密情報の項目を名前だけで確かめるスクリプト、秘密情報の入力の手順書を生成する |

<a id="f-08"></a>

## F-08：回答の整合性チェック

#### チェック結果の段階

| 段階 | 意味 | CLIの動き |
| --- | --- | --- |
| エラー | 技術的に成り立たない | 理由を示し、選び直してもらう |
| 警告 | 成り立つが、推奨しない | 理由とリスクを示す。そのまま続行できる |
| 情報 | 問題はないが、知っておくべきこと | 表示だけする |

- 警告を承知で続行した場合は、その内容を生成するプロジェクトのADRに自動で記録する（[C-35](common/workflow.md#c-35)）
- ルールはCLIのプログラムに直接書かず、一覧のデータファイルとして管理し、技術スタックや種別を追加したときにルールを足すだけで済むようにする（[C-38](common/design-principles.md#c-38)）

#### 初回のルール

| # | 条件 | 段階 | 理由 |
| --- | --- | --- | --- |
| 1 | 認証が「アプリ独自認証」または「併用」で、DBが「なし」 | エラー | 利用者の情報を保存する場所がない |
| 2 | ファイルのアップロードを使い、DBが「なし」 | エラー | ファイルの持ち主を記録できず、権限の確認と削除時の後始末（[C-63](common/security.md#c-63)）ができない |
| 3 | ファイルのアップロードを使い、認証が「なし」 | 警告 | 誰でもアップロードでき、いたずらや容量の浪費につながる。公開のファイルとして扱う場合（[C-63](common/security.md#c-63)の公開の手順）に限って成り立つ |
| 4 | 開発人数が「複数人」で、品質チェックの実行場所が「ローカルのみ」 | 警告 | マージの前に、他の人の変更も含めた品質チェックが自動で行われない |
| 5 | リポジトリが「公開」で、品質チェックの実行場所が「ローカルのみ」 | 警告 | 外部からのPRを自動でチェックできない |
| 6 | DBが「PostgreSQL」 | 情報 | 外部のDBサービスの契約が必要になり、D1より構成と費用が増える |
| 7 | バージョンで「最新の安定版」を選び、検証済みより新しい | 警告 | ハーネスでの動作を確認していない（[F-19](#f-19)） |
| 8 | このPCに必要なツールがない、またはバージョンが足りない | 警告 | 生成はできるが、そのままでは起動・テストできない。導入手順を表示する（[F-19](#f-19)） |
| 9 | アプリ名が命名規則（英小文字・数字・ハイフン）に合わない | エラー | コンテナ名等に使えない（[C-36](common/project-env.md#c-36)） |
| 10 | 生成先のフォルダが既に存在し、中身がある | エラー | 既存のファイルを上書きしてしまう |

#### 後から追加するルールの例

- モバイルアプリなのに、フロントエンドにWeb専用の技術を選んだ（警告）
- バックエンドにSpring Bootを選び、デプロイ先にCloudflare Workersを選んだ（エラー：Workersでは動かない）

## 生成するファイルの構成（仮決め）

アプリ側の構成は、これまでの共通仕様から仮決めする。AI向けの部分の配置はF-21に従う。

```text
<アプリ名>/
├─ AGENTS.md                    共通ルールの核（全AI共通の本体、[F-21](#f-21)）
├─ CLAUDE.md                    `@AGENTS.md`で本体を読み込み、Claude固有の内容だけを書く
├─ .claude/
│  ├─ skills/                   プロジェクトのルールのSkill（分野別、[F-21](#f-21)）
│  └─ agents/                   [C-66](common/workflow.md#c-66)の役割ごとのエージェントの定義
├─ （Codex用のSkill・エージェントの定義：置き場所は未決定事項を参照）
├─ .harness/
│  └─ config.yaml               CLIへの回答、使ったハーネスのバージョン、役割とモデルの割り当て
├─ README.md
├─ LICENSE                      公開リポジトリの場合のみ。MITライセンス
├─ docs/
│  ├─ requirements.md           要件定義書のひな形
│  ├─ tech-stack.md             技術とバージョン・選定理由（[C-62](common/quality-test.md#c-62)・[F-19](#f-19)）
│  ├─ testing/                  テストの種類ごとの環境構築の手順書（[C-69](common/quality-test.md#c-69)）
│  └─ adr/                      設計判断の記録（[C-35](common/workflow.md#c-35)）。警告を承知で続行した内容も記録（[F-08](#f-08)）
├─ prototype/                   プロトタイプ（HTML・CSS・JavaScript、C-76）。本番のコードに流用しない
├─ frontend/                    React（[C-06](common/frontend.md#c-06)のディレクトリ構成、仮のアイコン [C-55](common/frontend.md#c-55)）
├─ backend/                     Hono（[C-03](common/backend.md#c-03)の層構成、ロガー [C-30](common/backend.md#c-30) 等）
│  └─ db/
│     ├─ migrations/            マイグレーション（[C-37](common/backend.md#c-37)）
│     └─ seeds/                 テスト用のシード（[C-37](common/backend.md#c-37)）
├─ e2e/                         Playwright（[C-24](common/quality-test.md#c-24)）
├─ infra/                       Terraform（[C-39](common/project-env.md#c-39)）
├─ docker-compose.yml           開発環境（[C-36](common/project-env.md#c-36)）
├─ .env.example                 環境変数の見本（[C-05](common/security.md#c-05)）
├─ .node-version                実行環境のバージョン（[C-62](common/quality-test.md#c-62)）
├─ .gitignore
├─ .github/
│  ├─ pull_request_template.md  PRのテンプレート（「知見」の欄を含む、[F-18](#f-18)）
│  ├─ ISSUE_TEMPLATE/           親Issue・子Issueのテンプレート（[C-07](common/workflow.md#c-07)）
│  └─ workflows/                品質チェック（[F-16](#f-16)）
└─ package.json                 品質チェックとテストを1つのコマンドで実行（[C-61](common/quality-test.md#c-61)）
```

| ファイル・フォルダ | 生成する条件 |
| --- | --- |
| `LICENSE`（MIT） | リポジトリが「公開」の場合 |
| `backend/db/`、`docker-compose.yml`のDBのコンテナ | DBあり。DB用のコンテナはPostgreSQLの場合だけ |
| 認証の処理とテストのひな形 | 認証あり（方式に応じて変わる） |
| アップロード処理とテストのひな形、R2のIaC | ファイルのアップロードを使う（[F-20](#f-20)） |
| `.github/workflows/` | 品質チェックの実行場所がGitHub Actionsを含む |
| それ以外 | 常に生成する。ブランチ保護の設定手順（[C-42](common/workflow.md#c-42)）はREADMEに記載し、仮のアイコンの差し替え用Issue（[C-55](common/frontend.md#c-55)）は常に作成する |

<a id="f-15"></a>

## F-15：コンフリクト防止の手順

`git status`は手元の状態しか分からないため、リモートの最新状態を取得して比較する。

| タイミング | やること | 使うコマンド（例） |
| --- | --- | --- |
| 作業開始前 | リモートの最新状態を取得し、最新の`main`からブランチを作る | `git fetch`、`git switch -c` |
| 作業開始前 | 他の人が同じファイルを触っているオープン中のPRがないか確認する | `gh pr list`、`gh pr diff` |
| push前 | 最新の`main`を取り込み、コンフリクトがないか確認する | `git fetch` → `git merge-tree` |
| マージ前 | PRがコンフリクトなしでマージ可能か確認する | `gh pr view --json mergeable` |

<a id="f-16"></a>

## F-16：技術スタックに応じた品質チェック

- 品質チェックは、フロントエンド共通プロファイルとバックエンド別プロファイルに分け、選択した技術スタックに応じて組み合わせる。
- 品質チェックの実行場所を「ローカルのみ」「GitHub Actions」「ローカルとGitHub Actionsの両方」から選べるようにする。GitHub Actionsを利用できない案件では、ローカルのみを選べる。
- GitHub Actionsを実行場所に選んだ場合は、CIを利用する設定とし、CIの種類はGitHub Actionsに整合させる。ローカルのみを選んだ場合は、品質チェックのためのGitHub Actionsワークフローを生成しない。
- 選んだ実行場所に応じて、ローカル実行用スクリプト、GitHub Actionsワークフロー、または両方を生成する。ローカル実行用スクリプトは、GitHub Actionsを選んだ場合に必ず生成するとは限らない。
- 現時点の候補構成は次のとおりとする。記載したツールは候補であり、確定した採用決定ではない。

| プロファイル | チェック領域 | ツール候補 |
| --- | --- | --- |
| React／TypeScript共通 | Lint・React規約 | ESLint、TypeScript／React用プラグイン |
| React／TypeScript共通 | 型チェック | TypeScript compiler（`tsc`） |
| Hono（TypeScript） | Lint・型チェック・バグ検出等 | フロントエンドと共通のTypeScript系ツール |
| Spring Boot（Java） | Lint・命名・書式・import | Checkstyle |
| Spring Boot（Java） | 型チェック | Java compiler |
| Spring Boot（Java） | バグ・null・並行処理 | SpotBugs |
| Spring Boot（Java） | 複雑度・設計上の問題 | PMD |
| Python | Lint・書式・import・複雑度 | Ruff |
| Python | 型チェック | Pyright |
| 各プロファイル | セキュリティ静的解析 | ツール候補と適用方法は未決定 |

- 静的解析、テスト、ビルドはそれぞれ別のチェック領域として定義する。
- テストには単体テスト・結合テスト・E2Eテストを含める。技術スタックに応じてテストフレームワークと実行方法を定義する。
- テストの設計と信頼性の確保（テストオラクル、要求との照合、ミューテーションテスト、再現性の確認等）はC-25に従う。
- GitHub Actionsを利用する場合、選択した品質チェックをワークフローに反映し、必要なチェックをマージ条件に含める。
- 各ツールの詳細設定（ルールセット、厳しさ、閾値、除外対象、警告とエラーの扱い等）、ツールのバージョン、実行順序、合格条件は、プロファイルごとの設計時に決定する。CLIの質問で個々の設定を利用者に選ばせるか、標準設定を自動生成するかも未決定とする。

<a id="f-17"></a>

## F-17：Superpowers利用案内

- 選択されたAI環境向けの設定ファイルに、[C-11](common/workflow.md#c-11)のSuperpowers利用フローと適用する場面を反映する。
- READMEにはClaude Code・Codexそれぞれの導入手順、導入後の利用確認方法、プラグインを利用できない場合の対応を記載する。
- プラグインはユーザーのAI環境に導入するものとして案内し、プロジェクト生成時に自動インストールしない。

<a id="f-18"></a>

## F-18：知見の蓄積と配布

経験から来る判断基準（ヒューリスティクス）を、全プロジェクトで参照できるようにする。

### 貯める

- 知見は、このハーネスのリポジトリの`knowledge/`に、分野別のフォルダ・テーマごとのファイルで置く（例：`knowledge/db/sql-complexity.md`）

```text
knowledge/
├─ frontend/   例：コンポーネントを分割する目安、useMemoを使う目安
├─ backend/    例：Repository／DAOのどちらにするかの目安
├─ db/         例：SQLの書き分け、インデックス設計
└─ general/    分野をまたぐもの。例：共通化するか、しないかの目安
```

- 知見の使い方のルールはC-56に従う
- 知見はハーネスと一緒にバージョン管理し（[C-08](common/workflow.md#c-08)）、追加・変更はPRで行う
- 1件ごとに、次の項目をそろえて書く。書き方の見本は`knowledge/README.md`に置く

| 項目 | 内容 |
| --- | --- |
| 状態 | 仮説／検証中／確立／廃止（下記） |
| 種類 | 性能／設計 |
| 基準 | 判断のルール |
| 理由 | その基準にした理由 |
| 例外 | 当てはまらない場面 |
| 確かめ方 | 何を、どの道具で測って確かめるか |
| 根拠 | 実測値や、きっかけになった事例（ADRへのリンク等） |
| 対象 | 実測・適用した条件の範囲（DB・ライブラリとバージョン、データ量、実行環境等） |
| 適用の記録 | 適用した日付・プロジェクト・結果を1行ずつ追記する |

- 知見は絶対のルールではない。当てはまらない場面では、[C-10](common/backend.md#c-10)と同じく実測に基づいて判断し、その結果を根拠として知見に反映する

### 知見の種類と確かめ方

| 種類 | 対象の例 | 確かめ方 |
| --- | --- | --- |
| 性能 | SQLの書き方、useMemoの使い方、リストの仮想化、ページング | 知見に従った場合・従わない場合を、同じ条件で実測して比べる（実行計画、再描画の回数と時間、表示速度、応答時間、バンドルサイズ等） |
| 設計 | コンポーネントの分割、共通化の判断、Repository／DAOの構成 | 1回の測定では確かめられないため、代わりの指標（同じ種類の変更で触ったファイル数、不具合の数、複雑度、重複、依存の違反、レビューの指摘の回数等）を、複数のプロジェクト・長い期間で集めて傾向を見る |

- 設計の知見は、証明ではなく「複数の実績で反する結果が出ていない」という確からしさで扱う
- 自動で測れる指標（バンドルサイズ、複雑度、重複、依存の違反、SQLの発行数、実行計画等）は、CIで毎回測って結果をファイルとして保存し、根拠として参照できるようにする
- 具体的な計測の道具は、技術スタック別に定める

### 実測を根拠として使うときのルール

実測で言えるのは「その条件の下では効率が良い」までであり、ほかの条件でも成り立つとは限らない。実測を根拠にするときは、次を守る。

- **MUST**：実測の結果には、測った条件（データ量、端末・ブラウザ、ライブラリのバージョン、実行環境等）を一緒に記録する
- **MUST**：何を良くしたいのか（速さ・メモリ・通信量・費用等）を、測る前に決める
- **MUST**：「意味のある差」の基準（例：何ms以上の差なら効果ありとするか）を、測る前に決める
- **MUST**：比べる対象どうしは、同じ条件・同じ実行の中で複数回測り、中央値とばらつき（95パーセンタイル等）を記録する。1回だけの結果で判断しない
- **SHOULD**：準備運転（ウォームアップ）の後に測る。起動直後・キャッシュなしの状態の速さを知りたい場合は、分けて測る
- **SHOULD**：実験用の環境の結果に加えて、可能なら本番の実測値（利用者の実際の表示速度等）でも確かめる
- **MUST**：知見の「対象」は、実測した条件の範囲で書く。範囲を広げるには、別の条件での実測を追加する

### 知見の状態

| 状態 | 意味 | 次の状態へ進む条件 |
| --- | --- | --- |
| 仮説 | 考えとしてはあるが、まだ検証していない | 1つのプロジェクトで適用し、結果を記録した |
| 検証中 | 1件以上の実績がある | 2つ以上のプロジェクトで結果が一致した、または実測データで裏付けられた |
| 確立 | 繰り返し確かめられ、反する結果が出ていない | — |
| 廃止 | 当てはまらない例が多く、使わなくなった | — |

- 状態を変えるときは、根拠（適用の記録・実測データ）を示す
- 廃止した知見は消さずに残し、廃止の理由を書く

### 配る

- CLIは、選んだ技術スタックに関係する知見だけを、生成するプロジェクトにSkill等の形で出力する
- AIが常に読むルールには含めず、「SQLを書くとき」「インデックスを追加するとき」など、必要な場面でだけ読み込ませる
- 生成済みプロジェクトへの反映方法は、ハーネスの更新方法（Issue #7）で決める

### 育てる

#### 記録するきっかけ

実装の流れの中で、次の場面を知見の記録のきっかけにする。

| きっかけ | 例 | 関係するルール |
| --- | --- | --- |
| 知見に当てはまらない判断をした | 3テーブルのJOINだが、Repositoryに書いた | [C-56](common/design-principles.md#c-56) |
| 実測の結果が出た | N+1の検証、実行計画、SQLの発行数、表示速度 | [C-10](common/backend.md#c-10) |
| レビューで指摘を受けた | 別のAIから同じ種類の指摘が繰り返される | [C-33](common/workflow.md#c-33) |
| 不具合の原因を突き止めた | E2Eテストの失敗を調べて分かった原因 | [C-24](common/quality-test.md#c-24) |
| 手戻りが起きた | 設計を途中でやり直した | — |

#### 記録の方法

- **MUST**：生成するプロジェクトのPRテンプレートに「知見」の欄を設け、PRごとに必ず記入する。AIがPRを作るときも必ず記入する。該当しない項目は「なし」と書く
  - 参照した知見
  - 当てはまらなかった知見と、その理由・根拠
  - 新しい気づき（知見の候補）
- 大きな判断や実測の詳細は、そのプロジェクトのADR（[C-35](common/workflow.md#c-35)）に記録し、PRからリンクする
- 個人の下書き（`tech-notes`等）に残した知見も、固まったものは同じ流れでハーネスへ移す

#### 見直し

- 次の2つのタイミングで、知見を見直す
  - ハーネスの新しいバージョンを出すとき
  - 月に1回
- 見直しでは、AIが各プロジェクトのPRの「知見」の欄・ADR・CIに保存した計測結果を集め、次の案を出す
  - 知見の状態を進める・廃止する
  - 新しい知見を登録する
  - 既存の知見の「対象」「例外」を更新する
- 知見の登録・状態の変更は、AIが勝手に行わず、人の承認を得てからハーネスへPRで反映する

<a id="f-19"></a>

## F-19：バージョンの調査と選定理由の記録

#### 目的

最新の安定版などを調べたうえで採用するバージョンを決め、**なぜそのバージョンにしたかを明確にする**。決めたバージョンはC-62に従って固定する。

#### 流れ

1. 質問では技術（React・Hono等）だけを選び、バージョンは聞かない
2. CLIが、選んだ技術のバージョンを調べる
   - ライブラリ・ツール：最新の安定版（開発版・試験版は選ばない）
   - Node.js等の実行環境：長期サポート版（LTS）
   - あわせて、ハーネスのリリースごとに動作を確認した**検証済みのバージョン**を示す
3. このPCで必要なツール（Node.js・Docker・wrangler等）が使えるか、バージョンが足りているかを確認する。足りない場合は導入手順を表示する（CLIが勝手にインストールしない）
4. 検証済みのバージョンと最新の安定版を並べて表示し、どちらを採用するか選ばせる。最新の安定版が検証済みより新しい場合は、「動作を確認していない」という注意書きを出す（[F-08](#f-08)と同じく、止めずに警告だけ出す）
5. 決まったバージョンの一覧を表示し、承認されてから生成する

#### 記録

- 生成するプロジェクトの`docs/tech-stack.md`に、技術ごとに次を記録する
  - 採用したバージョン
  - 選定理由（例：「2026-09-29時点の最新の安定版」「ハーネス検証済み」「LTS」）
  - 調べた日と、そのとき確認した最新の安定版・検証済みのバージョン
- 以後のバージョンの更新は、[C-62](common/quality-test.md#c-62)の手順で行い、同じ文書を更新する

<a id="f-20"></a>

## F-20：ファイル保存の選択

- 「ファイルのアップロードを使うか」と「扱うファイルの種類（画像／動画／その他の文書、複数選択）」を質問する
- 使う場合、CLIは次を生成する
  - 非公開の保存先（初回はCloudflare R2）を作るIaCのコード（[C-39](common/project-env.md#c-39)）
  - ローカルの開発環境の設定。wranglerがR2をローカルに再現するため、D1と同じく本番と互換性のある環境で開発する（[C-36](common/project-env.md#c-36)）
  - `.env.example`の該当する項目
  - [C-63](common/security.md#c-63)に沿ったアップロード処理のひな形と、必須のテストのひな形
- 扱うファイルの種類に応じて、サイズの上限・許可する形式の初期値を設定する。動画を選んだ場合は、直接送る方式（[C-63](common/security.md#c-63)）のひな形も生成する
- 動画の変換（Cloudflare Stream等）は、初回のハーネスの対象外とする

<a id="f-21"></a>

## F-21：AI向け設定ファイルの構成

#### ファイルの役割

| ファイル | 役割 |
| --- | --- |
| `AGENTS.md` | 共通ルールの核。全AI共通の本体（[F-04](#f-04)）。冒頭に日本語での表示のルール（[C-67](common/workflow.md#c-67)）を書く |
| `CLAUDE.md` | `@AGENTS.md`で本体を読み込み、Claude固有の内容（エージェントの呼び出し方等）だけを書く |
| Skill | 分野別の詳細ルール。必要な作業のときだけ読み込む。Claude Codeは`.claude/skills/<名前>/SKILL.md`、Codexは`.agents/skills/<名前>/SKILL.md`（中身は同じ） |
| エージェントの定義（`.claude/agents/`等） | [C-66](common/workflow.md#c-66)の役割ごとの定義。使うモデルと、読み込むSkillを書く |
| `.harness/config.yaml` | CLIへの回答、使ったハーネスのバージョン（[C-08](common/workflow.md#c-08)）、役割とモデルの割り当て（[C-66](common/workflow.md#c-66)）。ハーネスの更新（Issue #7）にも使う |

- Skillの書き方（`SKILL.md`）はClaude CodeとCodexでほぼ共通のため、中身は1つを元にして、置き場所だけをAIごとに出し分ける（アダプタ、[F-03](#f-03)）
- 共有の範囲はC-68に従う

#### ひな形とAIごとの出力（アダプタ）

ハーネスのひな形は、AIに依存しない1つのもとから作り、CLIが選んだAIに応じて出し分ける（[F-03](#f-03)・[F-04](#f-04)）。

| ひな形（ハーネスのリポジトリ） | Claude Codeへの出力 | Codexへの出力 |
| --- | --- | --- |
| `templates/AGENTS.md` | `AGENTS.md`（`CLAUDE.md`から読み込む） | `AGENTS.md` |
| `templates/CLAUDE.md` | `CLAUDE.md` | 出力しない |
| `templates/skills/<名前>/SKILL.md` | `.claude/skills/<名前>/SKILL.md` | `.agents/skills/<名前>/SKILL.md` |
| `templates/ai-settings/` | `.claude/settings.json` | `.codex/rules/default.rules` |
| `templates/agents/<名前>.md` | `.claude/agents/<名前>.md`（冒頭の`claude:`の設定と本文） | `.codex/agents/<名前>.toml`（冒頭の`codex:`の設定と、本文を`developer_instructions`に入れる） |

- エージェントのひな形の冒頭には、Claude Code用（`tools`・`model`）とCodex用（`name`・`model`・`model_reasoning_effort`・`sandbox_mode`）の設定を両方書き、本文は共通にする
- Codexのエージェントの`sandbox_mode`は、編集しない役割（`planner`・`plan_reviewer`・`code_reviewer`）を`read-only`にし、書き込みを仕組みで防ぐ。テストを実行する`quality_checker`は、キャッシュ等が作られるため`workspace-write`にし、指示で編集を禁じる
- Codexのエージェント名は、公式の例に合わせて英小文字とアンダースコア（`plan_reviewer`等）にする
- Codexはエージェントを自動では起動しないため、Skill「実装の進め方」に、名前を指定して起動する方法を書く
- 置き場所・形式は2026年9月時点の公式ドキュメント（Codex：Build skills／Subagents）で確認した。変更された場合は見直す

### 核とSkillの分け方

「知らないまま作業すると、どの作業でも違反しうるか」を基準に分ける。核は短く保つ。

**核（`AGENTS.md`に常に書く）**

- 日本語での表示（[C-67](common/workflow.md#c-67)）
- 作業の流れ：Issue → ブランチ → PR、`main`の保護、ブランチ名・コミット・PR（[C-01](common/workflow.md#c-01)・[C-21](common/workflow.md#c-21)〜[C-23](common/workflow.md#c-23)・[C-42](common/workflow.md#c-42)）
- 実装の進め方の要点と、立ち止まる条件（[C-66](common/workflow.md#c-66)）
- 秘密情報・テストデータの禁止事項（[C-05](common/security.md#c-05)）
- AIの作業ルール（[C-53](common/design-principles.md#c-53)）、完了の定義（[C-34](common/workflow.md#c-34)）
- 知見の使い方（[C-56](common/design-principles.md#c-56)）と、各Skill・文書の場所の案内
- 破壊的な操作（[C-75](common/design-principles.md#c-75)）、ハーネスの改善の提案（[C-78](common/workflow.md#c-78)）、要件定義とIssueへの分割（[C-76](common/workflow.md#c-76)）、エラーのもみ消しの禁止（[C-71](common/error-response.md#c-71)）、テスト後の後始末（[C-69](common/quality-test.md#c-69)）
- 構成（[C-02](common/project-env.md#c-02)）、ライブラリの追加とバージョンの固定（[C-32](common/quality-test.md#c-32)・[C-62](common/quality-test.md#c-62)）、メンテナンス性（[C-38](common/design-principles.md#c-38)）
- `CLAUDE.md`：Superpowers（[C-11](common/workflow.md#c-11)）、共有の範囲（[C-68](common/workflow.md#c-68)）、役割ごとのエージェントとモデル（[C-66](common/workflow.md#c-66)）

**Skill（その作業のときだけ読み込む）**

| Skill | 含める共通仕様 | 主に読む役割 |
| --- | --- | --- |
| 実装の進め方 | [C-76](common/workflow.md#c-76)・[C-66](common/workflow.md#c-66)・[C-33](common/workflow.md#c-33)・[C-34](common/workflow.md#c-34)・[C-35](common/workflow.md#c-35)・[C-07](common/workflow.md#c-07) | 統括（要件定義・Issueへの分割・Issueの実装を始めるとき） |
| バックエンド | [C-03](common/backend.md#c-03)・[C-04](common/backend.md#c-04)・[C-10](common/backend.md#c-10)・[C-30](common/backend.md#c-30)・[C-31](common/backend.md#c-31)・[C-37](common/backend.md#c-37)・[C-64](common/backend.md#c-64)・[C-65](common/backend.md#c-65)・[C-74](common/backend.md#c-74)・[C-57](common/design-principles.md#c-57) | 計画・実装・コードレビュー |
| フロントエンド | [C-06](common/frontend.md#c-06)・[C-43](common/frontend.md#c-43)〜[C-52](common/frontend.md#c-52)・[C-54](common/frontend.md#c-54)・[C-55](common/frontend.md#c-55)・[C-77](common/frontend.md#c-77)・[C-57](common/design-principles.md#c-57) | 計画・実装・コードレビュー |
| テスト | [C-24](common/quality-test.md#c-24)〜[C-26](common/quality-test.md#c-26)・[C-69](common/quality-test.md#c-69)・[C-70](common/quality-test.md#c-70)・[C-60](common/quality-test.md#c-60)・[C-61](common/quality-test.md#c-61)・[C-79](common/quality-test.md#c-79) | テスト・品質チェック |
| セキュリティ | [C-09](common/security.md#c-09)・[C-12](common/security.md#c-12)〜[C-20](common/security.md#c-20)・[C-27](common/security.md#c-27)〜[C-29](common/security.md#c-29)・[C-58](common/security.md#c-58)・[C-59](common/security.md#c-59)・[C-63](common/security.md#c-63)・[C-72](common/security.md#c-72) | 計画・コードレビュー（影響大のとき） |
| エラー応答・API | [C-15](common/error-response.md#c-15)・[C-71](common/error-response.md#c-71)・[C-73](common/error-response.md#c-73)・[C-31](common/backend.md#c-31) | 実装・コードレビュー |
| 環境・デプロイ | [C-36](common/project-env.md#c-36)・[C-39](common/project-env.md#c-39)〜[C-41](common/project-env.md#c-41)・[C-08](common/workflow.md#c-08) | 統括（デプロイの承認を依頼するとき） |
| レビュー | [C-33](common/workflow.md#c-33)と、レビューの実行方法（別のAIの実行時の注意等） | 計画レビュー・コードレビュー |
| 知見 | [F-18](#f-18)と、該当する`knowledge/`の知見 | 全役割（判断に迷ったとき） |

- 各役割のエージェントの定義に、読み込むSkillを書き、役割ごとに必要なルールだけを読み込ませる

<a id="f-22"></a>

## F-22：共通仕様とテンプレートの対応の確認

Skillなどのテンプレートは共通仕様の要点を写したものなので、共通仕様だけを変えてテンプレートを直し忘れると、生成されるプロジェクトに古いルールが配られてしまう。これを防ぐ。

- ハーネスのリポジトリのPRテンプレートに、「共通仕様を変えた場合は、対応するテンプレートも直したか」の確認欄を設ける。どの番号がどのSkillに対応するかは、[F-21](#f-21)の表で確かめる
- CLIの開発時に、次を自動で確かめるチェックを作り、CIで実行する
  - 共通仕様の各番号（C-xx）が、[F-21](#f-21)の表でいずれかの核・Skillに割り当てられていること
  - 各テンプレートの冒頭に、もとになった共通仕様の番号の一覧があり、[F-21](#f-21)の表と一致していること
- 共通仕様の番号を追加したのに、どのテンプレートにも割り当てていない場合は、チェックを失敗にする

<a id="f-23"></a>

## F-23：ハーネスの改善の提案の仕組みの生成

- CLIは、生成するプロジェクトに次を用意する
  - Issueテンプレート（`.github/ISSUE_TEMPLATE/harness-feedback.md`）
  - `harness-feedback`のラベル（作成の手順をREADMEに記載する）
  - `.harness/config.yaml`の記録する場所の設定：`feedback_target`（`project`が既定、`harness`も選べる）と、`harness`の場合の`harness_repo`（ハーネスのリポジトリ）
- 記録する場所の設定は質問せず、既定の`project`で生成する。`harness`に変えたい人は、設定ファイルを書き換える
- ハーネスのリポジトリには、各プロジェクトから`harness-feedback`のラベルが付いたIssueを集めて一覧にする手順（`gh`コマンド等）を用意し、月1回の見直しで使う

<a id="f-24"></a>

## F-24：技術プロファイル

使うライブラリはハーネスで1つに決めず、利用者が選ぶ。選んだライブラリに合わせたルールを、技術プロファイルとして読み込む。Javaなど、言語が変わっても同じ仕組みで対応する。

### 流れ

| # | 段階 | 誰が | 内容 |
| --- | --- | --- | --- |
| 1 | 選択肢の表示 | CLI | 選んだ言語・DBで使えるライブラリだけを表示する |
| 2 | 選択 | 利用者 | 使うライブラリを決める |
| 3 | バージョンの確認 | CLI | その時点の最新の安定版と、検証済みのバージョンを調べて示す（[F-19](#f-19)） |
| 4 | 選定の確定 | 利用者 | バージョンを確定する。生成したプロジェクトで固定する（[C-62](common/quality-test.md#c-62)） |
| 5 | ルールの読み込み | CLI | 選んだライブラリのプロファイルのルールを、Skillとして生成するプロジェクトに入れる |

### 構成

```text
templates/profiles/
└─ <分類>/                     例：data-access、logger、http-client、test-framework、backend-framework
   ├─ _shared/                 分類の中で共通の部分
   └─ <ライブラリ>/
      ├─ profile.yaml          対応する言語・DB、バージョンを調べるパッケージ名、検証済みのバージョン、引用する共通の部分
      └─ SKILL.md              そのライブラリ固有のルール
```

- `profile.yaml`の`includes`に、引用する共通の部分を書く。CLIは、共通の部分とライブラリ固有の部分をつないで、1つのSkill（例：`data-access-drizzle`）として出力する
- 共通のSkill（`backend`等）には、ライブラリに依存するところに「詳しい書き方は、選んだライブラリのSkillを読む」という案内だけを書く
- 同じルールを複数のプロファイルに書かない。共通にできる部分は`_shared/`に書いて引用する
- `profile.yaml`に対応する言語・DBを書き、合わない組み合わせは選択肢に出さない。回答の組み合わせで合わないものは、整合性チェック（[F-08](#f-08)）でエラーにする
- プロファイルも、共通仕様とテンプレートの対応の確認（[F-22](#f-22)）の対象にする

### バージョンの選び方

- ハーネスの要件定義書にはバージョンの番号を書かない。バージョンは、プロジェクトを生成するときに決めて固定する
- ハーネスのリリースごとに、ひな形で動作を確かめたバージョンを、`profile.yaml`の「検証済みのバージョン」として記録する
- 最新の**安定版**を選ぶ。RC・ベータなどの試験版は選ばない
- 最新の安定版が、検証済みのバージョンと大きな版（MAJOR）で違う場合は、「ひな形で動作を確認していない」という警告を出す（[F-08](#f-08)と同じく、止めずに知らせる）

### 初回に用意するプロファイル

| 分類 | プロファイル | 含める道具・部品 | 状態 |
| --- | --- | --- | --- |
| バックエンドのフレームワーク | Hono | `app.onError`・`app.notFound`（[C-73](common/error-response.md#c-73)）、`secureHeaders`（[C-58](common/security.md#c-58)）、`cors`（[C-29](common/security.md#c-29)）、`csrf`（[C-28](common/security.md#c-28)）、`@hono/zod-validator`（[C-27](common/security.md#c-27)）、`app.routes`（GETの検証、[C-28](common/security.md#c-28)） | 決定（ひな形は未作成） |
| データアクセス | Drizzle ORM | D1は`db.batch()`でトランザクション（`db.transaction()`は使えない）、PostgreSQLのドライバは`pg` | 決定（試作で確認済み：Issue #18） |
| ロガー | 自作の共通ロガー | JSONを標準出力に出す小さな共通の部品。伏せ字・OpenTelemetryの項目名・監査ログ（[C-30](common/backend.md#c-30)）をひな形で用意する | 決定（ひな形は未作成） |
| API通信（フロントエンド） | Axios | インスタンスとインターセプター（[C-46](common/frontend.md#c-46)） | 決定（ひな形は未作成） |
| フロントエンドの状態・フォーム | 標準：TanStack Query、React Hook Form＋Zod／必要になったとき：Zustand | Zustandは最初から入れず、複数の画面で共有する状態が必要になったときに、承認を得て追加する（[C-32](common/quality-test.md#c-32)・[C-45](common/frontend.md#c-45)） | 決定（ひな形は未作成） |
| テストの道具 | Vitest、@cloudflare/vitest-pool-workers、Testing Library、Playwright、MSW、fast-check、k6、OWASP ZAP | 単体・結合（フロントエンド・バックエンド共通）、Workersの実行環境でのテスト、コンポーネントのテスト、E2E、外部APIのモック、異常な入力のテスト、負荷・限界のテスト、セキュリティのテスト（[C-79](common/quality-test.md#c-79)） | 決定（ひな形は未作成） |
| 品質チェックの道具 | ESLint＋typescript-eslint＋eslint-plugin-react-hooks、Prettier、TypeScript（`tsc`）、Stryker、dependency-cruiser、jscpd、`npm audit` | Lint、整形、型チェック、ミューテーションテスト、層をまたぐ依存の違反、重複、脆弱性 | 決定（ひな形は未作成） |

- ライブラリを入れるのは、メンテナンス性が上がる場合に限る。使わなくてもよい場面で入れると、仕組みが複雑になるだけになるため、標準で入れるものと、必要になったときに追加するものを分ける（[C-38](common/design-principles.md#c-38)・[C-53](common/design-principles.md#c-53)）
- 大きな版が新しくなったばかりの道具（TypeScript・Vitest等）は、ほかの道具が対応していない場合がある。ひな形を作るときに組み合わせて動くことを確かめ、検証済みのバージョンとして記録する

#### 試作で見つかった、道具の組み合わせの条件（2026-09-30、Issue #18）

最新の安定版どうしでも、組み合わせると動かない場合があった。ひな形の「検証済みのバージョン」には、次の条件を反映する。

| 条件 | 対応 |
| --- | --- |
| `@cloudflare/vitest-pool-workers`はVitest 4系にだけ対応（Vitestの最新は5系） | Vitestは4系の最新の安定版にする |
| `typescript-eslint`はTypeScript 6.1未満にだけ対応（TypeScriptの最新は7系） | TypeScriptは6.0系の最新の安定版にする |
| `@cloudflare/vitest-pool-workers`に同梱の実行エンジンは、新しい`compatibility_date`に対応していない場合がある | `compatibility_date`は、テストの道具が対応する日付以下にする |
| npm 11では、esbuild・workerdのインストール時の処理が既定で実行されない | 生成する`package.json`に、許可の設定（`allowScripts`）を入れる |
| `npm audit`で、開発用の道具（drizzle-kit・wranglerの内部）の脆弱性が報告される。本番で動く部分には無い | 品質チェックの合否は本番の依存（`npm audit --omit=dev`）で判定し、開発用の依存の結果は記録して、更新の判断に使う |
| Workersの環境変数の型 | `wrangler types`で生成し、生成したファイルはLint・整形の対象から外す |

- このように、[F-19](#f-19)の「最新の安定版」をそのまま選ぶと動かない組み合わせがある。CLIは、最新の安定版を示すときに、`profile.yaml`の組み合わせの条件と照らし合わせ、条件に合う中で最新のものを示す

#### Honoのプロファイル：Cloudflareでのバッチ処理の使い分け

[C-65](common/backend.md#c-65)のバッチ処理を、次の3つの仕組みの組み合わせで実現する。

| 役割 | 使うもの | 例 |
| --- | --- | --- |
| 起動の合図 | Cron Triggers | 毎晩2時（日本時間）に集計を始める |
| 大量の件数を小分けにして処理する | Queues | 1万件の通知を、100件ずつのメッセージに分けて処理する |
| 複数の手順を、途中から再開できるように進める | Workflows | 集計 → ファイルの作成 → 保存 → 完了の通知 |

- 短い処理（数秒で終わる）は、Cron Triggersの中で直接実行してよい。件数が多い処理はQueuesへ、複数の手順を再開できるようにしたい処理はWorkflowsへ任せる
- 迷ったら、Cron Triggersは「起動の合図だけ」にし、実際の処理はQueuesかWorkflowsに任せる（Cron TriggersはCPU時間の上限が短いため）

| [C-65](common/backend.md#c-65)のルール | 実現方法 |
| --- | --- |
| べき等にする | Queuesのメッセージは、同じものが2回以上届く可能性がある前提で作り、処理済みかをDBで確かめてから処理する |
| 小分けにして、途中から再開できる | Queuesのメッセージ1件を1つの小分けにする。Workflowsは手順ごとに状態が保存され、失敗した手順から再開できる |
| 同時に2つ動かさない | Workflowsは実行ごとに一意の名前（例：`daily-summary-2026-09-30`）で起動する。Cronで直接実行する場合は、DBの実行履歴で「実行中」を確かめてから始める |
| 実行の記録を残す | DBに実行履歴のテーブル（開始・終了・件数・結果）を持ち、ログにも出す |
| 再試行と失敗の一覧 | Queuesの再試行の上限と、上限を超えたメッセージの行き先（デッドレターキュー）を設定する。Workflowsは手順ごとに再試行を設定する |
| 時刻はUTCで書く | Cron Triggersの設定はUTCで書き、日本時間を文書に併記する |
| 本番での手動の再実行 | Workflowsの起動、または保護した管理用の入口から起動し、承認を得て行う |

- 上限の参考（2026年9月時点、有料プラン、[Cloudflare Workers: Limits](https://developers.cloudflare.com/workers/platform/limits/)）：Cron TriggersのCPU時間は30秒（1時間未満の間隔）／15分（1時間以上の間隔）、実行時間は15分。Queuesの処理は1回15分。Workflowsは時間の上限なし
- Queuesの重複の配送、Workflowsの同じ名前での重複の起動の防止、デッドレターキューの設定方法は、バッチ処理のひな形を作るときに公式のドキュメントで確かめる

#### Spring Boot（Java）のプロファイル

バックエンドのフレームワークは選択式とし、Spring Bootも選べるようにする。Honoのプロファイルで仕組みが正しく動くことを確かめた後に、同じ形で作る。

| 分類 | Spring Bootの場合の候補 |
| --- | --- |
| データアクセス | MyBatis／JPA |
| EntityとDTOの変換 | MapStruct／手書き |
| ロガー | SLF4J＋Logback |
| テスト | JUnit＋Testcontainers |
| 品質チェック | Checkstyle・SpotBugs・PMD |
| ビルド | Gradle／Maven |
| デプロイ先 | Cloudflare Workersでは動かないため、コンテナを動かせる場所（AWSのECS等）のインフラのプロファイルを用意する |

- 追加の候補：Kysely（複雑なSQLを型付きで書きやすい。Drizzleと併用せず、プロジェクトごとにどちらか一方を選ぶ別のプロファイルとして追加する。Drizzleで複雑なSQLを書くのがつらいという知見がたまったら追加を判断する）、MyBatis・JPA（Java）

<a id="f-25"></a>

## F-25：AIの権限の設定と秘密情報の確認の生成

CLIは、生成するプロジェクトに次を出力する。

| ひな形 | 出力先 | 内容 |
| --- | --- | --- |
| `templates/ai-settings/claude-settings.json` | `.claude/settings.json` | 危険なコマンドの`ask`・`deny`と、秘密情報のファイルの読み込みの`deny`（[C-75](common/design-principles.md#c-75)・[C-05](common/security.md#c-05)） |
| `templates/ai-settings/codex-default.rules` | `.codex/rules/default.rules` | 同じ内容を、Codexのルールの書き方（`prefix_rule`）で書いたもの |
| `templates/scripts/env-check.mjs` | `scripts/env-check.mjs`（`npm run env:check`で実行） | `.env.example`と実際のファイルの項目の名前を比べ、足りない項目の名前だけを表示する。値は表示しない |
| `templates/docs/secrets.md` | `docs/secrets.md` | 秘密情報の入力の手順（開発・検証・本番・CI・Terraform） |

- 使うAIに応じて、Claude Code用・Codex用の設定を出力する
- `.claude/settings.json`・`.codex/rules/`はプロジェクトのルールとしてコミットする（[C-68](common/workflow.md#c-68)）
- Codexのルールは、生成した後に`codex execpolicy check`で、代表的なコマンドが意図どおりに判定されることを確かめる
- 設定の書き方は、2026年9月時点の公式ドキュメント（Claude Code：Configure permissions／Codex：Rules）で確認した。変更された場合は見直す

## 対話の質問順（案）

初回の範囲（Webアプリ・Cloudflare・React・Hono）で選択肢が1つしかない質問は、聞かずに自動で決め、画面に表示だけする。質問の仕組みは残し、後から選択肢を追加できるようにする。

| # | 質問 | 選択肢（初回） | 備考 |
| --- | --- | --- | --- |
| 1 | アプリ名 | 自由入力（英小文字・数字・ハイフン） | Dockerのコンテナ名（[C-36](common/project-env.md#c-36)）、仮のアイコン（[C-55](common/frontend.md#c-55)）、各ファイルの名前に使う |
| 2 | 使用AI | Claude Code／Codex（複数選択） | |
| 3 | プロジェクト種別 | Webアプリ | 自動で決定 |
| 4 | フロントエンド・バックエンドの有無 | 両方あり | Webアプリなので自動で決定 |
| 5 | 公開・非公開 | 公開／非公開 | |
| 6 | 開発人数 | 1人／複数人 | |
| 7 | フロントエンドの技術 | React（TypeScript） | 自動で決定 |
| 8 | バックエンドの技術 | Hono（TypeScript） | 自動で決定 |
| 9 | インフラ・デプロイ先 | Cloudflare | 自動で決定。環境は開発・検証・本番の3つ（[C-40](common/project-env.md#c-40)） |
| 10 | DB | Cloudflare D1（標準）／PostgreSQL（Hyperdrive経由）／なし | |
| 11 | PostgreSQLの提供元 | Neon／Supabase／その他 | 10でPostgreSQLを選んだ場合だけ聞く |
| 12 | データアクセスのライブラリ | Drizzle ORM | [F-24](#f-24)の技術プロファイルから選ぶ。初回はDrizzleのみのため自動で決定 |
| 13 | 認証方式 | なし／アプリ独自認証／OIDC／両方の併用（推奨：OIDC） | [C-12](common/security.md#c-12) |
| 14 | 外部IdP | Google／Microsoft／その他 | 13でOIDCか併用を選んだ場合だけ聞く |
| 14-1 | ファイルのアップロード | 使う／使わない | [F-20](#f-20)。保存先は非公開のCloudflare R2（自動で決定） |
| 14-2 | 扱うファイルの種類 | 画像／動画／その他の文書（複数選択） | 14-1で「使う」を選んだ場合だけ聞く |
| 15 | 品質チェックの実行場所 | ローカルのみ／GitHub Actions／両方 | [F-12](#f-12)（CI）とF-16の質問を統合 |
| 16 | バージョンの確認 | 検証済み／最新の安定版（技術ごと） | [F-19](#f-19) |
| 17 | 確認と生成 | — | 回答の一覧と整合性チェック（[F-08](#f-08)）の結果を表示し、承認後に生成する |

- 個人情報の有無・管理者機能の有無など、セキュリティの判定に使う質問は、Issue #8で決めて追加する
