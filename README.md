# ハーネス設計

AIが機能を実装するときに、プロジェクト構成・実装方法・GitHubフロー・テスト方法などが一貫するよう、ハーネスを生成するCLIツールを設計しています。要件は[要件定義書](docs/requirements/README.md)を参照してください。

## 開発に使うAI環境

このプロジェクトでは、Claude CodeまたはCodexでSuperpowersプラグインを利用する開発フローを採用します。SuperpowersはClaude CodeとCodexのそれぞれに導入してください。プラグインの導入は各AI環境で行い、このリポジトリから自動インストールはしません。

### Claude Code

Claude Codeの入力欄で、次のプラグインコマンドを実行してください。これはWindowsのPowerShellやコマンドプロンプトに入力するコマンドではありません。

```text
/plugin install superpowers@claude-plugins-official
```

### Codex App

1. サイドバーの「Plugins」を開きます。
2. 「Superpowers」を探し、追加（`+`）またはインストールを選びます。
3. 新しいCodexセッションでプラグインが利用可能なことを確認します。

### Codex CLI

Codex CLIの画面内で次を入力し、プラグイン一覧からSuperpowersを検索してインストールしてください。これはWindowsのシェルコマンドではありません。

```text
/plugins
```

## 利用の確認と進め方

新しいセッションで、Superpowersのブレインストーミングを使って設計を相談できることを確認してください。要件整理・設計では`brainstorming`を使い、合意後に`writing-plans`で作業計画を作ります。実装時は`test-driven-development`、`requesting-code-review`、`verification-before-completion`など、作業に合うスキルを利用します。

Superpowersが利用できない場合は、プラグインの導入状態やアカウント／ワークスペースの利用制限を確認してください。Superpowersを前提とする設計・実装作業では、利用できないことをユーザーへ伝えてから進めます。

## 参考

- [Superpowers公式リポジトリと環境別導入案内](https://github.com/obra/superpowers)
- [Claude Code向けSuperpowers掲載ページ](https://claude.com/marketplace/plugins/superpowers)
- [Codexのプラグイン案内](https://help.openai.com/en/articles/20001256-plugins-in-codex/)

## インストールと使い方

Node.js 24 以上が必要です（推奨のバージョンは `.node-version` を参照）。

```text
npm install -g github:ysteam0117/harness
harness --help
```

新しいハーネスを使うときは、同じインストールのコマンドをもう一度実行します（`harness status` で、新しいバージョンがあるかを確かめられます）。

| コマンド          | 内容                                     | 状態   |
| ----------------- | ---------------------------------------- | ------ |
| `harness create`  | 質問に答えて、プロジェクトを生成する| 質問・バージョンの調査・整合性チェック・生成（手元のフォルダまで。動くアプリの土台を含む） |
| `harness update`  | 生成済みのプロジェクトに、新しいハーネスを反映する | 実装済み（書き換えたファイルは置き換えず、差分を示して選ぶ） |
| `harness adopt`   | 既存のプロジェクトに、AI 向けのルール（`AGENTS.md`・Skill など）を足す | 最小限＋技術の判定・プロファイルの Skill・CI の確認を実装済み（既存の調査の続きなどは未実装） |
| `harness status`  | 今のハーネスのバージョン・最新のバージョン・主な変更点を表示する | 実装済み |

`harness update`・`harness status` の使い方は、[`harness update` の使い方](#harness-update-の使い方)を参照してください。構成の詳細は[CLI全体の構成](docs/design/overview.md)を参照してください。

## `harness create` の使い方

質問に答えると、バージョンを調べ、回答どうしの組み合わせを確かめ、回答の一覧・採用するバージョン・チェックの結果を表示して確認します。確認の後は、作業中のフォルダの中の `./<アプリ名>` にプロジェクトを生成します（[生成されるもの](#生成されるもの)・[生成した後の手順](#生成した後の手順)）。Git の初期化・リモートリポジトリの作成・生成の直後の `npm install` と品質チェックは、まだ行いません。

### 対話で答える

```text
harness create
```

質問は順に表示されます。選択肢が1つしかない質問や、認証が「なし」のときの管理者・共同編集の質問は、聞かずに決めて「（自動で決定）」と表示します。個人情報・管理者機能・重要な操作・共同作業・組織の分離・リアルタイム・止まったときの影響（F-26 の質問A〜G）は聞かず、「未定（要件定義で決める）」として扱います（`--answers` に書けば、その値を使います）。途中で Ctrl+C を押すと、ファイルを作らずに終了コード130で終わります。

整合性チェックでエラーが出たら、直す質問を選んで聞き直せます。警告は、内容を確かめて「承知して続ける」場合だけ進めます。

### 回答のファイルで渡す（`--answers`）

質問への回答を YAML にまとめて渡せます。キーは質問の id で、値は英字です（値はすべて架空の例）。

```yaml
app_name: testapp-001
ais: [claude, codex]
visibility: private
team_size: solo
database: postgresql
postgres_provider: neon
auth: oidc
idp: google
file_upload: "no"
check_location: both
version_policy: verified
```

```text
harness create --answers answers.yaml
```

- 質問A〜G（`personal_data`・`admin`・`critical_ops`・`critical_ops_kinds`・`collaborative`・`org_separation`・`realtime`・`availability`）は書かなくてかまいません。書かなければ「未定（`undecided`）」になり、書けばその値を使います。重要な操作の種類（`critical_ops_kinds`）は、重要な操作が「ある」ときだけ使う補足の項目のため、未定の間は記録しません。`critical_ops_kinds` を書く場合は `critical_ops: yes` も必要です
- 自動で決まる質問（プロジェクトの種類・フロントエンド・バックエンドなど）は書かなくてかまいません。書く場合は、決まる値と同じにしてください
- 知らないキー・選択肢にない値・条件に合わない質問への回答（例：DBが `none` なのに `postgres_provider`）は、まとめてエラーとして表示します
- 一部だけ書いた場合、足りない回答は対話で聞きます。標準入力が端末でない場合（CI など）は、足りない質問の一覧を表示して終了コード1で終わります
- `yes`・`no` は YAML の書き方によっては真偽値と読まれることがあるため、`"no"` のように引用符で囲むと確実です

### バージョンの確認

質問の後、選んだ技術（npm のパッケージと Node.js）の最新の安定版を、npm と Node.js の登録情報から調べます（RC・ベータなどの試験版は選びません）。「検証済み（ハーネスで動作を確かめた版）｜最新の安定版｜比較」の表を見せ、バージョンの方針（`version_policy`）に従って採用する版を決めます。

- `verified`：検証済みのバージョンを使います。最新の安定版は調べて記録しますが、ネットワークにつながらなくても止まらず、「未確認」と記録します
- `latest`：最新の安定版を使います。対話では、「すべて最新の安定版」「すべて検証済み」「技術ごとに選ぶ」から選べます
- 組み合わせの条件（例：Vitest は 4 系）がある技術は、その範囲の中で最新の安定版を使います
- 検証済みと大きな版が違う場合は、「ハーネスで動作を確認していません」と警告します
- ネットワークにつながらない場合は、取得できなかった技術と理由を示し、検証済みのバージョンで進めるかを確かめます（「いいえ」は終了コード1）
- 採用した版・選定理由・調べた日・確認した最新の安定版・検証済みは、確認の一覧に「採用するバージョン」として表示されます。`docs/tech-stack.md` にも記録します

対話しない実行では、回答のファイルで指定します（値はすべて架空の例）。

```yaml
version_policy: latest
versions:
  vitest: verified   # この技術だけ検証済みを使う
  hono: latest       # この技術は最新の安定版を使う
versions_offline: verified
```

- `versions`：技術（パッケージ名。Node.js は `node`）ごとの選択で、`verified` か `latest` を書きます。書かなかった技術は、`version_policy` に従います（`latest` なら範囲内の最新の安定版）
- `versions_offline: verified`：ネットワークにつながらず最新の安定版を取得できないとき、検証済みのバージョンで進めることを承知する指定です。書かないと、対話しない実行は理由を示して終了コード1で終わります
- 対象にないパッケージ名・`verified` と `latest` 以外の値・`version_policy: verified` なのに `versions` に `latest` を書いた場合（矛盾）は、エラーになります

設計の詳細は[バージョンの調査と選定](docs/design/versions.md)を参照してください。

### 警告を承知して続ける（`accepted_warnings`）

警告は暗黙には承知しません。対話しない実行では、回答のファイルの `accepted_warnings` に書いたルールの id の警告だけを、承知したものとして扱います。

```yaml
accepted_warnings:
  - team-needs-ci
  - missing-tools
```

承知していない警告があると、その一覧と書き方を表示して終了コード1で終わります。ルールの id は、警告の表示の先頭（`[team-needs-ci]` の形）で確認できます。ルールの一覧は `data/consistency-rules.yaml` にあります。

### 最後の確認を省く（`--yes`）

```text
harness create --answers answers.yaml --yes
```

最後の確認（「この内容で生成しますか」）だけを省きます。警告の承知は省けません。標準入力が端末でなく `--yes` もない場合は、確認できないため終了コード1で終わります。

| 終了コード | 場合 |
| ---------- | ---- |
| 0 | 生成できた、警告を承知しなかった、または最後の確認で「いいえ」を選んだ |
| 1 | エラー、足りない回答、承知していない警告、生成の失敗（生成先に中身がある場合を含む） |
| 130 | Ctrl+C で中断した（生成の途中なら、ファイルは残しません。生成が完了した後に押した場合は、生成したものを残します） |

設計の詳細は[質問と整合性チェック](docs/design/questions.md)・[生成の仕組みと記録](docs/design/generation.md)を参照してください。

### 生成の直後の動作確認（`--verify`）（#57）

```text
harness create --answers answers.yaml --yes --verify
```

生成の直後に、生成したプロジェクトで `npm install` → `npm run check` を実行し、選んだバージョンで動くかを確かめます。数分かかります。

- 端末で、`--yes` なしで生成するときは、生成の後に「今すぐ動作を確かめますか」と聞きます（既定は「いいえ」）。`--verify` を付けると、聞かずに確かめます。`--yes` だけのとき、標準入力が端末でないときは、`--verify` を付けた場合だけ確かめます
- 通ると、`docs/tech-stack.md` の末尾に「動作確認」の節（日付つき）を足します。何度確かめても、節は1つです
- 失敗しても、生成したファイルは残します。失敗した手順・品質チェック（script 名）・原因の候補のパッケージ・検証済みの版に戻す方法を表示します
- `.env.development` と `.env.test` が無いときは、`.env.example` の項目から、架空の値で作ります（`.gitignore` の対象。値は表示しません）。すでにあるときは変えません
- 品質チェック（`npm run check`）のセキュリティのテスト（Semgrep・gitleaks・OSV-Scanner）が Docker で動くため、DB に関係なく、先に Docker を確かめます。Docker が使えないときは、npm を呼ばずに、確かめを飛ばして理由を表示します（#42）
- PostgreSQL のときは、Docker で検証用の DB を起動して確かめ、終わったら止めます
- 終了コード：通った・飛ばした・対話で「はい」を選んで失敗は 0、`--verify` を付けて失敗は 1、中断（Ctrl+C）は 130（生成物は残します）

### 生成されるもの

`./<アプリ名>`（例：`./testapp-001`）に、次のものができます。

| 種類 | 内容 |
| ---- | ---- |
| AI 向けの指示 | `AGENTS.md`・`CLAUDE.md`、Skill、エージェントの定義、AI の権限の設定（選んだAIの分だけ） |
| 技術プロファイルのコード・設定 | 選んだ技術のひな形（コード・テスト・Lint などの設定） |
| 動くアプリの土台 | API（`backend/src/`：`routes` → `services` → `db` の層）、画面（`frontend/src/`：`pages`・`features`・`services`）、`wrangler.jsonc`、`tsconfig.json`・`vite.config.ts`・`vitest.config.ts`、`index.html`、`public/_headers`、`docker-compose.yml`、`.env.example`、`.gitignore`、`README.md`。DB ありのときは、スキーマ・マイグレーション・シード・後始末の SQL と、例の機能（`/api/sample-users`）も出ます |
| `package.json`・`.node-version` | 依存するパッケージを、選んだ版（`^` なしの正確な版）で書きます。開発でだけ使うものは `devDependencies` に入ります |
| 文書 | `docs/tech-stack.md`、`docs/secrets.md`、`docs/project-rules.md`、`docs/testing/pentest-plan.md`。警告を承知した場合は `docs/adr/0001-accepted-warnings.md` |
| スクリプト・Issue のテンプレート | `scripts/env-check.mjs`、`.github/ISSUE_TEMPLATE/` |
| 知見 | 選んだ技術に関係する知見を、Skill「知見」に写します（DB を使わない場合は DB の知見は写しません） |
| 生成の記録 | `.harness/config.yaml`：回答・承知した警告・判定の結果（ASVS のレベルなど）・採用した版・役割とモデル・ハーネスのバージョン・ハーネスが管理するファイルの指紋 |

- 生成の内容は、DB・認証・アップロードの回答で変わります（D1 は `d1_databases`、PostgreSQL は Hyperdrive と `db` のコンテナ、アップロードは R2 の設定、DB なしは DB のファイルなし）。仕組みと違いの表は[動くアプリの土台](docs/design/skeleton.md)を参照してください
- `/api/health` と `/api/sample-users` は、機能の足し方の見本です。実際のアプリでは、消すか置き換えてください
- 実際の秘密の値（パスワード・API キーなど）は、どのファイルにも書きません。`docs/secrets.md` には、環境変数の名前と、各環境で何を入れるかの説明だけを書きます
- 同じ回答で生成すると、同じ内容になります（`.harness/config.yaml` の生成した日を除く）
- 生成先に中身のあるフォルダやファイルが同じ名前である場合は、何も書かずにエラーで終わります（空のフォルダなら生成できます）
- 生成は、同じフォルダの中の一時的な場所（`.<アプリ名>.harness-tmp-...`）に書いてから、生成先へ移します。途中で失敗・中断したときは、一時的な場所を消して、生成先にファイルを残しません

### まだ生成されないもの

次のものは、別の Issue で対応します。

- 認証・アップロードの処理とテスト（#65・#66）、E2E と IaC（#64）、要件定義書のひな形・PR や Issue のテンプレート・CI（#63）、環境変数の切り替えの仕組み（#51）
- 生成の直後の `npm install` と品質チェックによる確認（#57）
- Git の初期化・リモートリポジトリの作成・GitHub を使わない場合への対応（#55）

### 生成した後の手順

```text
cd testapp-001
npm install
```

1. 生成した場所に移動して、`AGENTS.md`（Claude Code なら `CLAUDE.md`）と `docs/` を読みます
2. `npm install` で、依存するパッケージを入れます（生成したプロジェクトの `README.md` に、最初の手順があります。開発サーバーは `npm run dev`、Docker は `docker compose up`、品質チェックは `npm run check`）
3. `docs/secrets.md` を見て、環境変数の値を `.env`（Git に入れないファイル）に自分で用意します。値をチャットやコミットに書かないでください
4. Git の初期化・リモートリポジトリの作成は、まだ自動では行いません。必要なら手で行ってください

## `harness update` の使い方

生成済みのプロジェクトに、新しいハーネスの内容を反映します（F-27）。プロジェクトのフォルダで実行します（別のフォルダなら `--dir <フォルダ>`）。ハーネスが管理するファイル（`AGENTS.md`・`CLAUDE.md`・Skill・エージェントの定義など）だけを更新し、アプリのコード・`docs/requirements.md`・`docs/project-rules.md` など、プロジェクトのものには触れません。

```text
harness update --dry-run   # 何が変わるかの一覧だけを表示する（何も書かない）
harness update             # 対話で、書き換えたファイルの扱いを選ぶ
harness update --yes       # 確認を省く
```

**更新の間は、ファイルを編集しないでください。** 更新は、Git の作業ツリーがきれい（未コミットの変更なし）なときだけ動きます。更新の前の状態を、Git から取り戻せるようにするためです。

| ファイルの状態 | 扱い |
| -------------- | ---- |
| 書き換えていない | 新しい内容で置き換える |
| 書き換えた | 置き換えない。差分を見せて、「置き換える／残す／新しい内容を `<ファイル>.harness-new` に置く」から選ぶ（`--yes` では、残して `.harness-new` に置く） |
| 新しいバージョンで追加された | 追加する |
| 新しいバージョンで不要になった | 削除せず、一覧で知らせる |
| 削除した | 対話では、復元するかを聞く（`--yes` では、消したまま。`.harness/config.yaml` の `removed_files` に記録し、次の更新でも復元しない） |

- 新しいバージョンで質問が増えたときは、増えた質問だけを聞きます（`--yes` では既定の値。既定のない質問があれば、止めて案内します）。回答は `.harness/config.yaml` に記録されます
- 新しい警告が出たときは、対話で承知を求め、`docs/adr/` に新しい ADR を足します。`--yes` では止まります
- 版は、記録された版のまま使います。増えた依存だけ、同梱の検証済みの版を使います（ネットワークは使いません）
- 途中で失敗・中断（Ctrl+C）したときは、書いた分を元に戻します。戻せなかったものがあれば、元の内容の退避を残し、場所を表示します
- 結果の一覧（置き換えた・残した・追加した・不要になった）を、PR の本文に貼れる Markdown で表示します。更新の後は、テストと品質チェックを実行し、Issue・PR で取り込んでください
- `--allow-dirty`：未コミットの変更があっても続けます。更新の前の状態を、Git から取り戻せなくなります

| 終了コード | 場合 |
| ---------- | ---- |
| 0 | 更新できた、`--dry-run`、または警告を承知しなかった |
| 1 | エラー（`config.yaml` がない・壊れている、未コミットの変更、ダウングレード、判定の後にファイルが変わった、失敗など） |
| 130 | Ctrl+C で中断した（書いた分は元に戻します） |

設計の詳細は[更新と状態の確認](docs/design/update.md)を参照してください。

## `harness adopt` の使い方

すでに動いているプロジェクトに、AI 向けのルールを足します（F-29。最小限だけです）。プロジェクトのフォルダで実行します（別のフォルダなら `--dir <フォルダ>`）。`--answers`（回答のファイル）が必要で、足りない項目だけ質問します。アプリ名は、フォルダの名前から決めます（英小文字・数字・ハイフンだけ。回答ファイルに違う app_name があれば止まります）。

```text
harness adopt --answers answers.yaml --dry-run                # 何が変わるかの一覧と差分だけを表示する（何も書かない。--issue は不要）
harness adopt --answers answers.yaml --issue 12              # 対話で、同じ名前のファイルの扱いを選ぶ
harness adopt --answers answers.yaml --issue 12 --yes        # 確認を省く（同じ名前のファイルは、既存を残す）
```

```text
harness adopt --answers answers.yaml --skip-secret-scan   # 秘密情報の確認を省く（確認していないと記録する）
```

**秘密情報の確認：** 導入の前に、Docker の gitleaks（`harness create` のセキュリティのテストと同じ、版とダイジェストで固定したイメージ。ネットワークなし・読み取り専用）で、Git の履歴と作業フォルダ（未コミット・未追跡のファイルを含む）を確かめます。Git のリポジトリでなければ、作業フォルダだけです。見つかったときは、何も書かずに止まり、場所・行・コミットだけを表示します（値は表示せず、どこにも残しません）。本物の秘密なら、値の取り消しと作り直しが必要です。Git の履歴から消すかどうかは、利用者が決めて行います。Docker が使えないときも止まります。`--dry-run` でも確認します。このフォルダに `.gitleaks.toml` があれば、その設定が使われます。`--skip-secret-scan` で省けますが、`.harness/config.yaml` の `secret_scan` に「確認していない」と記録します。省いたときは、`--dry-run` などの差分の表示に、既存のファイルの値が出ることがあります。

**新しいブランチ：** 適用するときは `--issue <導入先の Issue の番号>` が必要です。承認のあと、書く前に、新しいブランチ `chore/<番号>-adopt-harness` に移ります（`main` に直接入れません）。Git のフォルダでない、作業ツリーに未コミットの変更・未追跡のファイルがある（回答のファイルをプロジェクトの中に置いている場合も同じです）、同じ名前のブランチが別にある、のときは、何も書かずに止まります。`main` 以外のブランチにいるときは、今の HEAD から分けます。コミット・push・PR は、利用者が行います（導入が終わると、`git add`・`commit`・`push`、GitHub なら `gh pr create` の手順を表示します）。

**差の一覧：** `docs/harness-adoption.md` に、共通仕様（C-xx）ごとに「満たしている／一部／満たしていない／対象外／未確認」を残します。`harness adopt` が判定するのは、機械的に分かる項目（導入したファイル・CI・判定した技術・秘密情報の確認・回答で当てはまらない条件つきのルール）だけで、ほかは「未確認」です。導入のあとに、AI が Skill「既存のプロジェクトへの導入」の「導入のあとに、未確認の項目を埋める」に従って、根拠（読んだファイルのパス）つきで埋め、「満たしていない」「一部」の項目を Issue にします。文書には、ファイルのパスと名前だけを書き、値や中身は書きません。導入のときの記録なので、`harness update` は書き換えません。

`harness adopt` は、コミット・push・PR はしません。導入の差分は Git で確かめてください。

| 対象 | 扱い |
| ---- | ---- |
| `AGENTS.md`・`CLAUDE.md` | 既存の内容を残し、ハーネスの部分を印（`<!-- harness:begin -->`〜`<!-- harness:end -->`）で囲んで末尾に足す（ファイルが無ければ作る）。印の外は1文字も変えない。印が壊れている・UTF-8 でないときは、何も書かずに止まる |
| 共通の Skill・エージェントの定義・AI の権限の設定 | 同じ名前のファイルがなければ追加する。ある場合は、差分を見せて「置き換える／残す」を選ぶ（`--yes` では残す） |
| 当てた技術プロファイルの Skill | 既存のアプリの技術を判定し、必要な手がかりがすべて合ったプロファイルの Skill だけを入れる（`.claude/skills/<名前>/`・`.agents/skills/<名前>/`）。`AGENTS.md` の「ルールを読んで従う」の表に行を足し、どのフォルダに当たるかを書く。既存のアプリがハーネスと違う技術なら、共通のルールだけを入れる。`harness update` は、判定し直さず、導入のときに記録したプロファイルで組み直す（今のハーネスに無いプロファイルは、報告して飛ばす） |
| プロファイルのコード・設定ファイル | 入れない・触れない（ESLint・Prettier・tsconfig・`package.json`・既存のワークフローは変わらない。Lint・型・テストの基準線は Issue #21） |
| `docs/harness-adoption.md` | 共通仕様との差の一覧。同じ名前のファイルがあれば、差分を見せて選ぶ（`--yes` では既存を残す）。`harness update` は書き換えない |
| `.github/workflows/harness-check.yml` | GitHub で、品質チェックを GitHub Actions で行う（`check_location` が `github_actions` か `both`）ときだけ追加する。秘密情報の確認（固定の gitleaks のイメージ。`--redact`・ネットワークなし。値は出さない）を常に、`npm audit --omit=dev --audit-level=high` を Node.js のアプリのフォルダ（導入のときに記録したもの）だけ行う（既存の脆弱性でも最初から失敗する）。見つかったときの表示は、場所・行・コミットだけで、値は出さない（ファイル名そのものに秘密の値を書いていた場合は、その名前が表示される）。既存のワークフローは変えない。同じ名前のファイルがあれば、差分を見せて選ぶ |

- 品質チェック・テストのコマンドは、導入したルールの中では「未設定」です。AI は、実行する前に、既存のコマンドと、テストが本番や共有の DB に接続しないことを確かめます
- 記録は `.harness/config.yaml`（`mode: adopt`）に書きます。すでにあれば、二重に導入せず止まります
- 途中で失敗・中断（Ctrl+C）したときは、書いた分を元に戻します
- 導入したアプリの `harness update` は、印（`harness:begin`〜`harness:end`）の中だけを新しい内容にします。印の外の文章には触れません。印が壊れている・無いときは、何も書かずに止まります。導入のとき既存を残したファイルは、管理外として触れません。`harness status` も使えます

| 終了コード | 場合 |
| ---------- | ---- |
| 0 | 導入できた、`--dry-run`、または確認で「いいえ」を選んだ |
| 1 | エラー（回答ファイルの問題、アプリ名、`--issue` が無い・正しくない、Git のフォルダでない・作業ツリーが汚れている・同名のブランチがある、導入済み、秘密情報が見つかった、Docker が使えない、印が壊れている、文字コード、判定の後にファイルが変わった、失敗など） |
| 130 | Ctrl+C で中断した（書いた分は元に戻します） |

**回答のファイルを AI に作らせる：** 既存の要件定義書・README・コードから、回答の案を根拠つきで作る Skill「既存のプロジェクトへの導入」があります。インストールしたハーネスの `templates/skills/adopt-existing/SKILL.md` を AI に読ませて、「この Skill に従って、このプロジェクトの `harness adopt` の回答のファイルを作って」と頼みます。この Skill は導入先のプロジェクトには入りません（`harness create`・`harness adopt` の出力に含まれません）。AI は、`.env` などの秘密情報のファイルを開かず、判定できない項目は `undecided` にし、各項目に根拠（読んだファイル）をコメントで付けます。分からない補足（外部IdP・重要な操作の種類・扱うファイルの種類）は書かずに残すので、分かった時点で `.harness/config.yaml` の `answers` に追記して、`harness update` を実行してください（`harness update` は回答のファイルを受け取らず、`.harness/config.yaml` を読みます）。

設計の詳細は[既存のプロジェクトへの導入](docs/design/adopt.md)を参照してください。

## `harness status` の使い方

```text
harness status
```

プロジェクトのバージョン・インストール済みのバージョン・最新のバージョン・主な変更点（プロジェクトのバージョンより新しいもの）・書き換え済みの管理ファイルの件数を表示します。何も書きません。プロジェクトでないフォルダでは、ハーネスの情報だけを表示します。

最新のバージョンは、GitHub の Release から `gh` で取ります。調べるリポジトリは、既定では `ysteam0117/harness` です。フォークなど別のリポジトリを調べるときは、環境変数 `HARNESS_REPOSITORY` に「持ち主/名前」の形で設定します。`gh` がない・ログインしていない・つながらない・Release がない場合は、「取得できません」と表示します（終了コードは0）。

```text
# 例（PowerShell）。フォークを調べる場合（<持ち主> は置き換える）
$env:HARNESS_REPOSITORY = "<持ち主>/harness"
harness status
```

## 開発のコマンド

```text
npm ci               # ライブラリのインストール（lock ファイルどおり）
npm run check        # Lint・型チェック・整形の確認・共通仕様の対応の確認・テスト・脆弱性の確認
npm run pack:check   # 配布物の確認（組み立て・パック・インストール・起動）
npm run build        # src/ を dist/ に組み立てる
npm run smoke:generated  # 生成したプロジェクトの動作の確認（D1・PostgreSQL・DB なしの 3 通りを生成し、npm install・npm run check（ホスト）・npm run build・開発サーバー・Docker（コンテナの中は npm run check:app）を確かめる。時間がかかり、Docker が必要）
```

CI（GitHub Actions）は、push・PR のたびに、Windows・macOS・Linux で `npm run check` と `npm run pack:check` を実行します（手動でも実行できます）。生成したプロジェクトの動作の確認（smoke）は時間がかかるため、手動で実行するワークフロー（`.github/workflows/smoke.yml`。Actions の画面の「Run workflow」）に分けています。smoke のスクリプトの単体テストは、`npm run check` には入れず、`npm run test:smoke` で実行します（CI では、push・PR のたびに実行します）。

`npm run smoke:generated` は、環境変数 `SMOKE_CASES=d1,none` で通りを絞れます。生成したプロジェクトの `npm run check` が Docker で動くセキュリティのテストを含むため、Docker は D1・DB なしの通りにも要ります。Docker が使えない手元では、全部の通りを飛ばします（`SMOKE_REQUIRE_DOCKER=1` で失敗にできます）。途中で中断（Ctrl+C）しても、起動したプロセス・Docker のコンテナとボリューム・一時的なフォルダを片付けます。詳細は[動くアプリの土台](docs/design/skeleton.md)を参照してください。
