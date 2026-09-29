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
| [C-40](common/project-env.md#c-40) |  | common/project-env.md |
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
| [C-64](common/backend.md#c-64) |  | common/backend.md |
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
