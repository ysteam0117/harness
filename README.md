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
| `harness create`  | 質問に答えて、プロジェクトを生成する| 質問と整合性チェックまで（生成は未実装） |
| `harness update`  | 生成済みのプロジェクトに、新しいハーネスを反映する | 未実装 |
| `harness status`  | 今のハーネスのバージョン・最新のバージョン・主な変更点を表示する | 未実装 |

`update`・`status` などの未実装のコマンドは、その旨を表示して終了コード1で終わります。構成の詳細は[CLI全体の構成](docs/design/overview.md)を参照してください。

## `harness create` の使い方

質問に答えると、回答どうしの組み合わせを確かめ、回答の一覧とチェックの結果を表示して確認します。ファイルの生成はまだ実装していないため、確認の後は「生成は Issue #34 で実装予定です」と表示して終了コード1で終わります（ファイルは作りません）。

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
| 0 | 警告を承知しなかった、または最後の確認で「いいえ」を選んだ |
| 1 | エラー、足りない回答、承知していない警告、確認の後（生成は未実装のため） |
| 130 | 質問の途中で Ctrl+C（ファイルは作りません） |

設計の詳細は[質問と整合性チェック](docs/design/questions.md)を参照してください。

## 開発のコマンド

```text
npm ci               # ライブラリのインストール（lock ファイルどおり）
npm run check        # Lint・型チェック・整形の確認・共通仕様の対応の確認・テスト・脆弱性の確認
npm run pack:check   # 配布物の確認（組み立て・パック・インストール・起動）
npm run build        # src/ を dist/ に組み立てる
```

CI（GitHub Actions）は、Windows・macOS・Linux で `npm run check` と `npm run pack:check` を実行します。
