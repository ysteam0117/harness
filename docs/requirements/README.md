# 要件定義書：ハーネス設計

| 項目 | 内容 |
| --- | --- |
| バージョン | なし（ハーネスの初回完成時に`0.0.0`を付ける） |
| 状態 | 検討中 |

文書中の専門用語は、[用語集](glossary.md)で説明している。

## 文書の構成

要件定義書は、単元ごとに次のファイルに分けている。

| ファイル | 内容 |
| --- | --- |
| [overview.md](overview.md) | 1. プロジェクト概要（目的、初回完成の範囲、スコープ） |
| common/ | 2. 共通仕様（下表） |
| [functional.md](functional.md) | 3. 機能要件（F-01〜、質問の一覧、生成するファイル） |
| [open-items.md](open-items.md) | 4. 未決定事項 |
| [glossary.md](glossary.md) | 付録：用語集 |

### 共通仕様

全プロジェクトに適用する設計・開発のルール。多くは対話で質問しない固定ルールだが、C-12（認証方式）のように、CLIの質問で選んだ内容に応じて適用範囲が変わるものも含む。

番号（C-xx）は項目の識別子であり、見出しの中では番号順に並ばない。項目を追加するときは、次の番号を振って該当する見出しに入れる。

| 見出し | ファイル |
| --- | --- |
| 2.1 開発フロー・GitHub運用 | [common/workflow.md](common/workflow.md) |
| 2.2 プロジェクト構成・環境 | [common/project-env.md](common/project-env.md) |
| 2.3 バックエンド | [common/backend.md](common/backend.md) |
| 2.4 フロントエンド | [common/frontend.md](common/frontend.md) |
| 2.5 品質チェック・テスト | [common/quality-test.md](common/quality-test.md) |
| 2.6 認証・認可・セキュリティ | [common/security.md](common/security.md) |
| 2.7 エラー応答 | [common/error-response.md](common/error-response.md) |
| 2.8 設計の基本方針 | [common/design-principles.md](common/design-principles.md) |

## 番号と文書の管理のルール

- 番号（C-xx・F-xx）は項目の識別子であり、変更しない。Issue・PR・ほかの文書から番号で参照する
- 項目を追加するときは、次の番号を振って該当するファイルに入れ、下の「番号の一覧」にも追加する
- ほかのファイルの項目を参照するときは、リンクを付ける（例：`[C-05](common/security.md#c-05)`）

## 番号の一覧

| 番号 | 概要 | ファイル |
| --- | --- | --- |
| [C-01](common/workflow.md#c-01) | 開発フローは**Issue駆動**とする | common/workflow.md |
| [C-02](common/project-env.md#c-02) | **1つのリポジトリ内で`frontend/`と`backend/`にディレクトリを分ける**（モノレポ） | common/project-env.md |
| [C-03](common/backend.md#c-03) |  | common/backend.md |
| [C-04](common/backend.md#c-04) | データアクセス層は**必要最低限の列だけをDTOで取得する**。Entityを丸ごと取得して画面やAPIに渡すことを禁止する | common/backend.md |
| [C-05](common/security.md#c-05) |  | common/security.md |
| [C-06](common/frontend.md#c-06) |  | common/frontend.md |
| [C-07](common/workflow.md#c-07) |  | common/workflow.md |
| [C-08](common/workflow.md#c-08) |  | common/workflow.md |
| [C-09](common/security.md#c-09) |  | common/security.md |
| [C-10](common/backend.md#c-10) |  | common/backend.md |
| [C-11](common/workflow.md#c-11) |  | common/workflow.md |
| [C-12](common/security.md#c-12) |  | common/security.md |
| [C-13](common/security.md#c-13) |  | common/security.md |
| [C-14](common/security.md#c-14) |  | common/security.md |
| [C-15](common/error-response.md#c-15) |  | common/error-response.md |
| [C-16](common/security.md#c-16) |  | common/security.md |
| [C-17](common/security.md#c-17) |  | common/security.md |
| [C-18](common/security.md#c-18) |  | common/security.md |
| [C-19](common/security.md#c-19) |  | common/security.md |
| [C-20](common/security.md#c-20) |  | common/security.md |
| [C-21](common/workflow.md#c-21) |  | common/workflow.md |
| [C-22](common/workflow.md#c-22) |  | common/workflow.md |
| [C-23](common/workflow.md#c-23) |  | common/workflow.md |
| [C-24](common/quality-test.md#c-24) |  | common/quality-test.md |
| [C-25](common/quality-test.md#c-25) |  | common/quality-test.md |
| [C-26](common/quality-test.md#c-26) |  | common/quality-test.md |
| [C-27](common/security.md#c-27) |  | common/security.md |
| [C-28](common/security.md#c-28) |  | common/security.md |
| [C-29](common/security.md#c-29) |  | common/security.md |
| [C-30](common/backend.md#c-30) |  | common/backend.md |
| [C-31](common/backend.md#c-31) |  | common/backend.md |
| [C-32](common/quality-test.md#c-32) |  | common/quality-test.md |
| [C-33](common/workflow.md#c-33) |  | common/workflow.md |
| [C-34](common/workflow.md#c-34) |  | common/workflow.md |
| [C-35](common/workflow.md#c-35) |  | common/workflow.md |
| [C-36](common/project-env.md#c-36) |  | common/project-env.md |
| [C-37](common/backend.md#c-37) |  | common/backend.md |
| [C-38](common/design-principles.md#c-38) |  | common/design-principles.md |
| [C-39](common/project-env.md#c-39) |  | common/project-env.md |
| [C-40](common/project-env.md#c-40) | 環境は開発・検証・本番の3つに分け、開発・検証は手元で環境変数の設定を切り替えて使う。本番だけをCloudflareに置き、本番の値は手元に置かない | common/project-env.md |
| [C-41](common/project-env.md#c-41) |  | common/project-env.md |
| [C-42](common/workflow.md#c-42) |  | common/workflow.md |
| [C-43](common/frontend.md#c-43) |  | common/frontend.md |
| [C-44](common/frontend.md#c-44) |  | common/frontend.md |
| [C-45](common/frontend.md#c-45) |  | common/frontend.md |
| [C-46](common/frontend.md#c-46) |  | common/frontend.md |
| [C-47](common/frontend.md#c-47) |  | common/frontend.md |
| [C-48](common/frontend.md#c-48) |  | common/frontend.md |
| [C-49](common/frontend.md#c-49) |  | common/frontend.md |
| [C-50](common/frontend.md#c-50) |  | common/frontend.md |
| [C-51](common/frontend.md#c-51) |  | common/frontend.md |
| [C-52](common/frontend.md#c-52) |  | common/frontend.md |
| [C-53](common/design-principles.md#c-53) |  | common/design-principles.md |
| [C-54](common/frontend.md#c-54) |  | common/frontend.md |
| [C-55](common/frontend.md#c-55) |  | common/frontend.md |
| [C-56](common/design-principles.md#c-56) |  | common/design-principles.md |
| [C-57](common/design-principles.md#c-57) |  | common/design-principles.md |
| [C-58](common/security.md#c-58) |  | common/security.md |
| [C-59](common/security.md#c-59) |  | common/security.md |
| [C-60](common/quality-test.md#c-60) |  | common/quality-test.md |
| [C-61](common/quality-test.md#c-61) |  | common/quality-test.md |
| [C-62](common/quality-test.md#c-62) |  | common/quality-test.md |
| [C-63](common/security.md#c-63) |  | common/security.md |
| [C-64](common/backend.md#c-64) | 。デッドロックを起きにくくし、起きた場合はトランザクション全体を回数の上限付きでやり直す | common/backend.md |
| [C-65](common/backend.md#c-65) |  | common/backend.md |
| [C-66](common/workflow.md#c-66) |  | common/workflow.md |
| [C-67](common/workflow.md#c-67) |  | common/workflow.md |
| [C-68](common/workflow.md#c-68) |  | common/workflow.md |
| [C-69](common/quality-test.md#c-69) |  | common/quality-test.md |
| [C-70](common/quality-test.md#c-70) |  | common/quality-test.md |
| [C-71](common/error-response.md#c-71) |  | common/error-response.md |
| [C-72](common/security.md#c-72) |  | common/security.md |
| [C-73](common/error-response.md#c-73) |  | common/error-response.md |
| [C-74](common/backend.md#c-74) |  | common/backend.md |
| [C-75](common/design-principles.md#c-75) | 取り消しが難しい操作や、ほかの人の作業・環境に影響する破壊的な操作は、実行する前に利用者の判断を仰ぐ | common/design-principles.md |
| [C-76](common/workflow.md#c-76) | 実装の前に、統括が利用者と対話して要件定義を行い、HTML・CSS・JavaScriptのプロトタイプで動きを確かめてから、受け入れ条件付きのIssueに分割する。IssueごとにC-66の流れで実装する | common/workflow.md |
| [C-77](common/frontend.md#c-77) | 操作した結果は、画面を再読み込みしなくても、そのページ全体にすぐ反映されるようにする | common/frontend.md |
| [C-78](common/workflow.md#c-78) | 作業中に気づいたハーネスの改善点は、AIが自分で直さず、決まった形のIssueとして記録し、利用者が採用するかを判断する | common/workflow.md |
| [C-79](common/quality-test.md#c-79) | 「壊そうとしても壊れないこと」を確かめるテスト（異常な入力・同時実行・障害・負荷・セキュリティ）を行う。カオステストは条件付きで検討する | common/quality-test.md |
| [C-80](common/workflow.md#c-80) | プロジェクト固有のルールは`docs/project-rules.md`に書き、ハーネスのルールと分ける。迷ったらプロジェクト固有として始め、ほかのアプリでも通用すると分かったらハーネスへ提案する | common/workflow.md |
| [C-81](common/workflow.md#c-81) | 実装したコードの全体の構成と、機能ごとのファイルの役割・処理の流れを、設計書（`docs/design/`）に書く。コードは書き写さず、ファイル名・関数名で指し、実装したPRの中で更新する | common/workflow.md |
| [C-83](common/workflow.md#c-83) | GitHubを使わない（手元のGitだけの）プロジェクトでは、Issueとレビューの記録をファイルで管理し、`main`の保護と品質チェックをGitのフックと取り込みのコマンドで行う | common/workflow.md |
| [C-82](common/quality-test.md#c-82) | セキュリティのテストを、コードを見るテスト（毎回）・依存関係を見るテスト（毎回）・攻撃を試すテスト（リリース前、検証環境）・手動のペネトレーションテスト（条件付きで必須、検証環境）の4つで行う | common/quality-test.md |
| [F-01](functional.md#f-01) | 対話形式でのハーネス生成 | functional.md |
| [F-02](functional.md#f-02) | 使用AIの選択 | functional.md |
| [F-03](functional.md#f-03) | AIの追加 | functional.md |
| [F-04](functional.md#f-04) | 共通ルールの一元管理 | functional.md |
| [F-05](functional.md#f-05) | プロジェクト種別の選択 | functional.md |
| [F-06](functional.md#f-06) | フロントエンド・バックエンドの有無の選択 | functional.md |
| [F-07](functional.md#f-07) | 技術スタックの選択 | functional.md |
| [F-08](functional.md#f-08) |  | functional.md |
| [F-09](functional.md#f-09) | DBの選択 | functional.md |
| [F-10](functional.md#f-10) | 認証方式の選択 | functional.md |
| [F-11](functional.md#f-11) | インフラ・デプロイ先の選択 | functional.md |
| [F-12](functional.md#f-12) | CIの選択 | functional.md |
| [F-13](functional.md#f-13) | 公開・非公開の選択 | functional.md |
| [F-14](functional.md#f-14) | 開発人数の選択 | functional.md |
| [F-15](functional.md#f-15) |  | functional.md |
| [F-16](functional.md#f-16) |  | functional.md |
| [F-17](functional.md#f-17) |  | functional.md |
| [F-18](functional.md#f-18) |  | functional.md |
| [F-19](functional.md#f-19) |  | functional.md |
| [F-20](functional.md#f-20) |  | functional.md |
| [F-21](functional.md#f-21) |  | functional.md |
| [F-22](functional.md#f-22) | 共通仕様とテンプレートの対応の確認 | functional.md |
| [F-23](functional.md#f-23) | ハーネスの改善の提案の仕組みの生成 | functional.md |
| [F-24](functional.md#f-24) | 技術プロファイル | functional.md |
| [F-25](functional.md#f-25) | AIの権限の設定と秘密情報の確認の生成 | functional.md |
| [F-26](functional.md#f-26) | 共通仕様の判定に必要な質問 | functional.md |
| [F-27](functional.md#f-27) | 生成済みのプロジェクトへのハーネスの更新 | functional.md |
| [F-28](functional.md#f-28) | CLI本体 | functional.md |
| [F-29](functional.md#f-29) | 既存のプロジェクトへのハーネスの導入 | functional.md |
