# 設計書：文書と GitHub のファイルのひな形（Issue #63）

## 目的と範囲

生成するプロジェクトに、要件定義書・ADR・テストの手順書・PR／Issue のテンプレート・CI・LICENSE・プロトタイプ・仮のアイコンを出す。

- 作らないもの：E2E のシナリオと IaC（#64 で追加した。[e2e-iac.md](e2e-iac.md)）
- `.github/`（ワークフローを除く）は、リポジトリの置き場所（`repository`）が `github` のときだけ出す。`local`（手元のGitだけ）のときの出し分けは [local-git.md](local-git.md)（#61）

| 番号 | 内容 |
| --- | --- |
| AC-1 | 回答（CI の実行場所・公開）に応じて、正しいファイルが出る |
| AC-2 | 要件定義書のひな形に、判定の結果と未定の項目が書かれる |
| AC-3 | 管理するファイルが `managed_files` に記録される |

## 出すファイル

| 出力先 | ひな形 | 条件 | 区分（F-27） |
| --- | --- | --- | --- |
| `docs/requirements.md` | `templates/docs/requirements.md` | 常に | プロジェクトのもの |
| `docs/adr/README.md`・`0000-template.md` | `templates/docs/adr/` | 常に | プロジェクトのもの |
| `docs/testing/README.md`・`quality`・`unit`・`integration`・`e2e`・`mutation`（`.md`） | `templates/docs/testing/` | 常に | プロジェクトのもの |
| `.github/pull_request_template.md` | `templates/.github/` | `repository` が `github` | 管理する |
| `.github/ISSUE_TEMPLATE/parent.md`・`child.md`・`replace-icons.md`・`harness-feedback.md` | `templates/.github/ISSUE_TEMPLATE/` | `repository` が `github` | 管理する |
| `.github/workflows/check.yml` | `templates/.github/workflows/check.yml` | `check_location` が `github_actions`・`both` | プロジェクトのもの |
| `LICENSE`（MIT） | `templates/project/LICENSE` | `visibility` が `public` | プロジェクトのもの |
| `prototype/README.md`・`index.html`・`style.css`・`app.js` | `templates/project/prototype/` | 常に | プロジェクトのもの |
| `public/favicon.ico`・`favicon.svg`・`apple-touch-icon.png`・`icons/icon-192.png`・`icons/icon-512.png`・`manifest.webmanifest` | `src/generate/icons.ts` | 常に | プロジェクトのもの |

- ワークフローは、プロジェクトが CI を足したり変えたりするため、プロジェクトのものにする
- 結合テストの手順書は、DB の回答で内容が変わる。変わる部分は値（`integration_tools`・`integration_setup`・`integration_verify`・`integration_cleanup`。`data/template-values.yaml`）にし、ひな形に条件の分岐を入れない（F-28）
- CI の検証用の環境変数は、リポジトリの Secrets の `ENV_TEST` に `.env.test` の中身を登録して渡す。ワークフローに値は書かない

## 要件定義書に書き込む値

| 値 | 中身 |
| --- | --- |
| `judgment_table` | 質問A〜Gの表の行（記号・質問の `title`・回答の `label`） |
| `asvs_level`・`pentest_requirement` | 既存の値（[generation.md](generation.md)） |
| `enabled_rules` | 有効にした共通仕様を「、」でつないだもの。なければ「なし」 |
| `undecided_items` | 未定の質問の箇条書き（記号・`title`・id）。なければ「なし」 |
| `license_year` | 生成した年（`now`）。LICENSE に使う |

## 仮のアイコン（C-55）

- `icons.ts` が、アプリ名の頭文字（5×7 の点の文字を拡大）と、仮であることを示す枠の PNG を作る。外部のライブラリは使わず、`node:zlib`（`deflateSync`・`crc32`）で組み立てる。同じアプリ名なら同じ中身になる
- `favicon.ico` は、32×32 の PNG を1つ入れた ICO。`favicon.svg` は頭文字の文字
- PNG・ICO は、`ProjectFile` の `encoding: "base64"` で持ち、`writeProject` がバイト列に戻して書く
- `index.html` から参照し、README に「仮のアイコン」の章と、差し替えの Issue の作り方（Issue テンプレート「仮のアイコンの差し替え」）を書く。README には `main` ブランチの保護の手順（C-42）も書く
