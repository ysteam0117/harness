@AGENTS.md

<!-- もとになった共通仕様：C-11・C-33・C-66・C-67・C-68 -->

# Claude Code 固有のルール

このファイルは、`AGENTS.md`（全AI共通の核のルール）に加えて、Claude Codeだけに関係する内容を書く。`AGENTS.md`と食い違う内容は書かない。

## 日本語での表示

- `AGENTS.md`の「最初に守ること：日本語で書く」を、Claude Codeでも必ず守る
- サブエージェント（`Agent`ツール）を呼び出すときは、指示の最後に「作業の過程と結果は、すべて日本語で書くこと」を必ず含める
- Codexなど別のAIの出力が英語で返ってきた場合は、日本語にまとめ直してから利用者に見せる

## 役割ごとのエージェント

実装の進め方（Skill「実装の進め方」）の各役割は、`.claude/agents/`のエージェントとして定義してある。統括（このセッション）が、`Agent`ツールで役割ごとのエージェントを呼び出す。

| 役割 | エージェント | モデル |
| --- | --- | --- |
| プロトタイプの作成 | `prototyper` | {{claude_model_prototyper}} |
| 計画 | `planner` | {{claude_model_planner}} |
| 計画レビュー | `plan-reviewer` | {{claude_model_plan_reviewer}} |
| テスト | `test-writer` | {{claude_model_test_writer}} |
| 実装 | `implementer` | {{claude_model_implementer}} |
| 品質チェック | `quality-checker` | {{claude_model_quality_checker}} |
| コードレビュー | `code-reviewer` | {{claude_model_code_reviewer}} |
| ドキュメント | `doc-writer` | {{claude_model_doc_writer}} |

- 統括（このセッション）のモデルは {{claude_model_orchestrator}} を使う
- エージェントの定義は`.claude/agents/`、Skillは`.claude/skills/`にある。モデルの割り当ては`.harness/config.yaml`で管理している。変更する場合は、設定ファイルとエージェントの定義の両方を直す
- 上位のモデルへの切り替え（影響の大きい処理、同じ失敗が2回続いた等）は、呼び出すときに`model`を指定して行う
- エージェントには会話全体ではなく、目的・対象のファイル・制約・完了条件など必要な情報だけを渡す。レビューのエージェントには、実装の経緯を渡さない

## 別のAIによるレビュー

- レビューは、実装とは別の会社のAI（Codex）で行うことを原則とする（Codexで実装した場合はClaude Codeでレビューする）。Codexを使えない場合は、`plan-reviewer`・`code-reviewer`（{{claude_model_code_reviewer}}、新しい会話）で行う
- Codexの呼び出し方と、実行時の注意は、Skill「レビュー」に従う

## Superpowers

- Superpowersプラグインが利用できることを、作業を始める前に確認する。利用できない場合は、導入手順（README）を案内し、利用できないまま作業を進めない
- 各役割の中で、Superpowersの該当するSkillを使う（計画で`writing-plans`、テストで`test-driven-development`、コードレビューで`requesting-code-review`、完了の判定で`verification-before-completion`等）

## 設定ファイルの扱い

- `.claude/skills/`と`.claude/agents/`はプロジェクトのルールとしてコミットする。変更は必ず{{issue_and_pr}}で行う
- 個人の設定（`.claude/settings.local.json`）と、各自が個人で使うSkill・エージェント（`~/.claude/`に置いたもの）はコミットしない
