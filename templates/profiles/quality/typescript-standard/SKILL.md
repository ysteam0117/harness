---
name: quality-tools
description: 品質チェックの道具と合格の基準。Lint・型チェック・整形・層の依存・重複・ミューテーションテスト・依存ライブラリの脆弱性を確かめるときに読む。
---

<!-- もとになった共通仕様：C-25・C-32・C-57・C-61 -->

# 品質チェックの道具

作業の過程と結果は、すべて日本語で書く。{{profile_skill_note}}

## 実行

{{quality_run_section}}

## 合格の基準（初期値）

| 項目 | 道具 | 基準 |
| --- | --- | --- |
| Lint・型チェック・整形 | ESLint・`tsc`・Prettier | エラーが0件（警告は記録する） |
| 関数の複雑さ | ESLintの`complexity` | 1つの関数で15以下 |
| 層をまたぐ依存 | dependency-cruiser | 違反が0件 |
| 重複 | jscpd | 重複の割合が5%以下 |
| ミューテーションテスト | Stryker | 対象の処理で80%以上 |
| 依存ライブラリの脆弱性 | `npm audit --omit=dev` | 高・重大が0件 |
| コードの書き方のセキュリティ | Semgrep（同梱のルール`.semgrep/`） | 重大度が高い（ERROR）指摘が0件 |
| 秘密情報の混入 | gitleaks（`.gitleaks.toml`） | 検出が0件。Gitに追加された`.env`・`.dev.vars`も失敗 |
| 依存ライブラリの脆弱性（本番の依存） | OSV-Scanner | CVSSの重大度7.0以上（高・重大）が0件。重大度のないものは記録だけ |
| テストのカバレッジ | — | 合否には使わず、記録だけする |

## 守ること

- **MUST NOT**：基準を満たすために、`eslint-disable`・`@ts-ignore`・除外の設定を安易に加えない。加える場合は理由を書く
- **MUST**：{{quality_nosemgrep_rule}}{{pr_equivalent}}に記録する。gitleaksのテスト用の架空の値は、値に`FAKE_SECRET_FOR_TEST`を含める
- **MUST NOT**：セキュリティのテストをスキップする設定（環境変数・`--no-verify`での回避など）を作らない。Dockerが使えないときは、導入して起動する
- **MUST**：{{quality_generated_rule}}
- **MUST**：基準をプロジェクトの事情で変える場合は、{{project_rules_place}}に書く。緩める場合はADRに記録し、承認を得る
