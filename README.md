# ハーネス設計

AIが機能を実装するときに、プロジェクト構成・実装方法・GitHubフロー・テスト方法などが一貫するよう、ハーネスを生成するCLIツールを設計しています。要件は[要件定義書](docs/requirements.md)を参照してください。

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
