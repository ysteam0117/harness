# 設計書：GitHub を使わないプロジェクト（Issue #61）

## 目的と範囲

リポジトリの置き場所の質問（`repository`）で「使わない（手元のGitだけ）」を選んだとき、GitHub の代わりに、Issue のファイル・Git のフック・取り込みのコマンドで、Issue 駆動・`main` の保護・品質チェックを行うプロジェクトを生成する（要件：C-83、F-27、F-28）。

- 作らないもの：後から GitHub に移す手順（`harness update` で `.github/` を加える。移すときに決める）、`docs/issues/` の Issue を GitHub の Issue に移す方法

| 番号 | 内容 |
| --- | --- |
| AC-1 | `local` を選ぶと、公開範囲・品質チェックの実行場所を聞かずに `private`・`local` に決まる。`.github/`・`LICENSE` が出ず、`docs/issues/`・フック・取り込みのコマンドなどが出る |
| AC-2 | フックは `main` の上の直接のコミットを止め、取り込みのコマンドは `npm run check` が通った場合だけ `main` に Squash で取り込む |
| AC-3 | `local` の AGENTS.md・CLAUDE.md・Skill・agents・README に、GitHub の語（`gh`・`Closes`・PR・GitHub Actions・`.github/`）が残らない。GitHub の出力に、`merge:check`・`.githooks`・`docs/issues/` が残らない |

## 出すファイル

| 出力先 | ひな形 | 条件（`repository`） | 区分（F-27） |
| --- | --- | --- | --- |
| `.github/ISSUE_TEMPLATE/*`・`.github/pull_request_template.md` | `templates/.github/` | `github` | 管理する |
| `docs/issues/README.md` | `templates/local-git/docs/issues/README.md` | `local` | プロジェクトのもの（一覧は利用者が育てる） |
| `docs/issues/_template.md` | 同上 | `local` | 管理する |
| `docs/issues/0001-replace-icons.md`（仮のアイコンの差し替え。状態は未着手） | 同上 | `local` | プロジェクトのもの |
| `.githooks/pre-commit`（実行できるファイル） | `templates/local-git/githooks/pre-commit` | `local` | 管理する |
| `scripts/merge-check.mjs`・`package.json` の `merge:check` | `templates/local-git/scripts/merge-check.mjs` | `local` | 管理する |
| `docs/harness-feedback/README.md`（C-78 の改善の提案の下書きの書き方） | `templates/local-git/docs/harness-feedback/README.md` | `local` | 管理する |

- `check.yml`・`LICENSE` は既存の条件のまま。`local` では `check_location` が `local`・`visibility` が `private` に決まるため、出ない
- `ProjectFile` の `executable` が真のファイルは、`writeProject` が書いたあとに `chmod 0o755` する（Windows では影響しない）
- 生成するプロジェクトの `.prettierignore` に、`scripts/merge-check.mjs`・`.githooks` を足す（ハーネスが書いたものとして、書式をそのまま保つ。ひな形は回答で分けない）
- npm の依存は増やさない（取り込みのコマンドは Node 標準だけ）

## 値による入れ替え（F-28）

AGENTS.md・CLAUDE.md・Skill・agents・README の、GitHub の手順（PR・`Closes`・Squash マージ・`gh`・Dependabot など）は、ひな形に分岐を入れず、`data/template-values.yaml` の `repository` の条件付きの値で入れ替える。`github` の値は、もとの文章と同じ（出力は変わらない）。

| 値 | 内容 |
| --- | --- |
| `workflow_issue_step`・`workflow_review_steps`・`workflow_main_rules` | AGENTS.md「作業の流れ」の手順1・5〜7・`main` の決まり |
| `issue_and_pr`・`issue_or_pr_record`・`pr_equivalent`・`issue_record_place`・`knowledge_record_place`・`test_list_place`・`change_review_place`・`merged_unit` | 「Issue・PR」「PRの「知見」の欄」「Issueのコメント」などの言い換え |
| `remote_ops_caution`・`secret_write_places`・`secret_put_commands`・`done_link_check`・`feedback_instruction`・`feedback_proposal_ref`・`harness_proposal_way` | AGENTS.md・Skill の、GitHub に触れる文 |
| `commit_merge_step`・`prev_merged_check`・`implement_deliverable`・`dependency_update_row` | Skill「実装の進め方」・「テスト」の文・表の行 |
| `readme_repository_setup`・`readme_env_test_step`・`readme_icons_issue`・`readme_branch_protection`・`readme_merge_command_row`・`repo_visibility_flag` | README の「リポジトリの用意」・仮のアイコン・`main` の保護・コマンドの表 |

`data/template-values.yaml` の値の中の `{{名前}}`（例：`readme_repository_setup` の `{{repo_visibility_flag}}`）は、`buildValues` がほかの値で1段だけ展開する。

## フック（`.githooks/pre-commit`、POSIX sh）

1. まだコミットがない（最初のコミット）なら、`main` でも許す
2. 今のブランチが `main` なら止める。例外は、取り込みのコマンドが `git rev-parse --git-path harness-merge-check` の場所に書いた木の hash が、`git write-tree` と一致するときだけ（一致したら印を消して許す）。環境変数で飛ばす方式は採らない
3. ステージしたファイル（`--diff-filter=ACMR`）で、作業ファイルとステージの内容が違うもの（部分的なステージ）があれば、「検査できません」と表示して止める。検査する作業ファイルとコミットする内容を一致させるため
4. `gitleaks` があれば、`gitleaks git --help` の出力に `--staged` がある場合は `gitleaks git --pre-commit --staged --redact --no-banner`、ない場合は `gitleaks protect --staged --redact --no-banner` で確かめ、検出したら止める（値は表示しない）。判定にはヘルプの文字列を使い、ヘルプの成功だけでは判定しない。なければ警告して続ける
5. ステージした整形の対象のファイルを `node_modules/.bin/prettier --check`、Lint の対象のファイルを `node_modules/.bin/eslint` に渡す。道具がなければ「npm install してください」と表示して止める

## 取り込みのコマンド（`scripts/merge-check.mjs`）

`npm run merge:check`（今のブランチ）または `npm run merge:check -- <ブランチ名>`。

1. 事前の確かめ（何も変えない）：ブランチ名が `<種類>/<番号>-<内容>`（`feature`・`fix`・`docs`・`refactor`・`chore`）・`main` でない・存在する・作業ツリーがきれい・`main` が別の作業ツリーで使われていない（使われていれば、その作業ツリーで実行する案内を表示して止まる）
2. 今のブランチが `main` でなければ `main` に切り替え、`git merge --squash <ブランチ>`（競合したら中止）
3. 実行開始時の作業ツリーと Squash 後の作業ツリーの `package.json`・`package-lock.json` の中身（ファイルの有無も含む）を比較し、どちらかが違う場合だけ、`npm ci`（lock がなければ、lock を作らない `npm install --no-package-lock`）で依存を更新する。作業ブランチを作った後の `main` 側の変更も対象になる。失敗したら中止。その後、**取り込んだ後の作業ツリー（`main` ＋ 変更）で `npm run check`**。失敗したら中止
4. `docs/issues/<番号4桁>-*.md` の「状態」を「完了」にして `git add`（ファイルがない・状態の行がない場合は中止）
5. 印（木の hash）を書き、`git commit -m "<種類>: <内容> (#<番号>)"`。印は、コミットの成否にかかわらず必ず消す
6. 中止のときは、`git reset --merge` で `main` の HEAD・作業ツリー・インデックスを取り込む前に戻し、元のブランチに戻る。引数でブランチを指定して `main` の上から実行したときは、`main` のままでいる

依存の更新を試した内容が、実行開始時に記録した `package.json`・`package-lock.json` の中身と違う場合だけ、中止・中断による巻き戻しの後にもう一度 `npm ci`（lock がなければ、lock を作らない `npm install --no-package-lock`）を実行し、元の依存に戻す。更新が途中で失敗した場合も復元する。開始時と検証時の中身が同じなら、Squash の差分に依存のファイルが含まれていても更新・復元は行わない。復元にも失敗した場合は「依存を元に戻せませんでした。npm install を実行してください」と表示する。子プロセスの `spawnSync` は `windowsHide: true` を指定する。

## テスト

| 番号 | 内容 | テスト |
| --- | --- | --- |
| AC-1 | 質問・`--answers`・ルール | `test/questions/repository.test.ts` |
| AC-1・AC-3 | 出すファイル・中身 | `test/generate/local-repository.test.ts` |
| AC-2 | フック・取り込み・依存の更新と復元・`git worktree` | `test/generate/local-git.test.ts`（実際の git を一時フォルダ（`os.tmpdir`）で使う。git がなければ飛ばす。Prettier・ESLint・gitleaks は偽の道具。依存の更新と復元のテストは PATH の先頭に偽の npm を置き、引数と実行時の package.json を記録する） |
| AC-2 | 本物の Prettier・ESLint・`npm run check` | `npm run smoke:generated`（`SMOKE_CASES=local`） |

テストの値はすべて架空（`testapp-001`・`test@example.invalid`・`FAKE_SECRET_FOR_TEST` など）。
