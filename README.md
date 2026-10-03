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
npm install -g github:<リポジトリの持ち主>/harness
harness --help
```

`<リポジトリの持ち主>` は、このリポジトリの持ち主の GitHub のアカウント名に置き換えてください。

| コマンド          | 内容                                     | 状態   |
| ----------------- | ---------------------------------------- | ------ |
| `harness create`  | 質問に答えて、プロジェクトを生成する| 質問・バージョンの調査・整合性チェック・生成（手元のフォルダまで） |
| `harness update`  | 生成済みのプロジェクトに、新しいハーネスを反映する | 未実装 |
| `harness status`  | 今のハーネスのバージョン・最新のバージョン・主な変更点を表示する | 未実装 |

`update`・`status` などの未実装のコマンドは、その旨を表示して終了コード1で終わります。構成の詳細は[CLI全体の構成](docs/design/overview.md)を参照してください。

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

### 生成されるもの

`./<アプリ名>`（例：`./testapp-001`）に、次のものができます。

| 種類 | 内容 |
| ---- | ---- |
| AI 向けの指示 | `AGENTS.md`・`CLAUDE.md`、Skill、エージェントの定義、AI の権限の設定（選んだAIの分だけ） |
| 技術プロファイルのコード・設定 | 選んだ技術のひな形（コード・テスト・Lint などの設定） |
| `package.json`・`.node-version` | 依存するパッケージを、選んだ版（`^` なしの正確な版）で書きます。開発でだけ使うものは `devDependencies` に入ります |
| 文書 | `docs/tech-stack.md`、`docs/secrets.md`、`docs/project-rules.md`、`docs/testing/pentest-plan.md`。警告を承知した場合は `docs/adr/0001-accepted-warnings.md` |
| スクリプト・Issue のテンプレート | `scripts/env-check.mjs`、`.github/ISSUE_TEMPLATE/` |
| 知見 | 選んだ技術に関係する知見を、Skill「知見」に写します（DB を使わない場合は DB の知見は写しません） |
| 生成の記録 | `.harness/config.yaml`：回答・承知した警告・判定の結果（ASVS のレベルなど）・採用した版・役割とモデル・ハーネスのバージョン・ハーネスが管理するファイルの指紋 |

- 実際の秘密の値（パスワード・API キーなど）は、どのファイルにも書きません。`docs/secrets.md` には、環境変数の名前と、各環境で何を入れるかの説明だけを書きます
- 同じ回答で生成すると、同じ内容になります（`.harness/config.yaml` の生成した日を除く）
- 生成先に中身のあるフォルダやファイルが同じ名前である場合は、何も書かずにエラーで終わります（空のフォルダなら生成できます）
- 生成は、同じフォルダの中の一時的な場所（`.<アプリ名>.harness-tmp-...`）に書いてから、生成先へ移します。途中で失敗・中断したときは、一時的な場所を消して、生成先にファイルを残しません

### まだ生成されないもの

次のものは、別の Issue で対応します。

- アプリのひな形（画面・API などのコード）、`.env.example`、要件定義書のひな形（#56）
- 生成の直後の `npm install` と品質チェックによる確認（#57）
- Git の初期化・リモートリポジトリの作成・GitHub を使わない場合への対応（#55）

### 生成した後の手順

```text
cd testapp-001
npm install
```

1. 生成した場所に移動して、`AGENTS.md`（Claude Code なら `CLAUDE.md`）と `docs/` を読みます
2. `npm install` で、依存するパッケージを入れます
3. `docs/secrets.md` を見て、環境変数の値を `.env`（Git に入れないファイル）に自分で用意します。値をチャットやコミットに書かないでください
4. Git の初期化・リモートリポジトリの作成は、まだ自動では行いません。必要なら手で行ってください

## 開発のコマンド

```text
npm ci               # ライブラリのインストール（lock ファイルどおり）
npm run check        # Lint・型チェック・整形の確認・共通仕様の対応の確認・テスト・脆弱性の確認
npm run pack:check   # 配布物の確認（組み立て・パック・インストール・起動）
npm run build        # src/ を dist/ に組み立てる
```

CI（GitHub Actions）は、Windows・macOS・Linux で `npm run check` と `npm run pack:check` を実行します。
