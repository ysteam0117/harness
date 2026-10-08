# 設計書：既存のプロジェクトへの導入（最小限、Issue #15）

## 目的と範囲

`harness adopt` で、すでに動いているプロジェクトに、AI 向けのルールを足す（F-29、親 #5）。この Issue は最小限で、**既存のファイルを失わずに、AI 向けのファイルだけを足す**ところまでを扱う。

最優先の約束は、**利用者の既存のファイルを失わないこと**である。既存の文書は印で囲んだ部分だけを足し、同じ名前のファイルは上書きしない。

受け入れ条件

| 番号 | 内容 |
| --- | --- |
| AC-1 | `AGENTS.md`・`CLAUDE.md` は、既存の内容を残し、ハーネスの部分を印（`<!-- harness:begin -->`〜`<!-- harness:end -->`）で囲んで追加する。印の外は1文字も変えない |
| AC-2 | 共通の Skill・エージェントの定義・AI の権限の設定は、同じ名前のファイルがなければ追加する。ある場合は、差分を見せて利用者が選ぶ（`--yes` では既存を残す） |
| AC-3 | 技術プロファイルの Skill は、当てたものだけ入れる（#18。最初の版では入れない）。生成したアプリにだけあるコマンド・文書を、導入先の文書に書かない |
| AC-4 | `--dry-run` は何も書かない。取り消しでも何も書かない |
| AC-5 | `--answers` は必須。足りない項目だけ質問する。アプリ名はフォルダの名前から決める（回答ファイルの `app_name` が違えば止める） |
| AC-6 | 書き込みは一括で、失敗・中断では元のバイト列に戻る |

この Issue でまだやらないこと（別の Issue）

- 既存の構成・コードを調べる・AI が読んで答えの案を作る（手順2・3）、差の一覧（手順5）、ブランチ・PR（手順6）、基準線（手順7）
- CI の追加、品質チェックの道具の設定、`docs/requirements.md` のひな形

実装を正とする。この設計書とコードが食い違ったときは、コードの動きを正として設計書を直す。

## ファイルと役割

| ファイル | 役割 |
| --- | --- |
| `src/adopt/markers.ts` | 印の検出（`extractBlock`）と統合（`mergeBlock`）。純粋な関数。印の文字列は `BEGIN`・`END` |
| `src/adopt/build.ts` | `buildAdoptFiles`：導入するファイルを、メモリ上で組み立てる。AI 向けのファイルと、当てたプロファイルの Skill、`harness-check.yml` だけ（プロファイルのコード・設定は入れない） |
| `src/adopt/profiles.ts` | 当てたプロファイルの扱い（#18 の PR-B）：`usableProfiles`（今のハーネスで使えるものを選ぶ）、`applyProfileSkillValues`（Skill を AGENTS.md の表に書く値にする）、`hasNodeApp` |
| `src/adopt/ci.ts` | `buildHarnessCheck`：`.github/workflows/harness-check.yml` の中身（ひな形は `templates/adopt/`） |
| `data/adopt-profile-skills.yaml` | プロファイルの分類ごとの、AGENTS.md の表の欄（C-38） |
| `src/adopt/plan.ts` | `planAdopt`：ファイルごとに doc-merge・add・same・choose を決める。純粋な関数 |
| `src/adopt/secret-scan.ts` | 秘密情報の確認（#17）：`scanSecrets`（docker・git の実行役は差し替え可）、`parseLeakReport`（レポートから場所・行・コミットだけを取り出す）、`formatLeaks`、`gitleaksImage` |
| `src/adopt/detect.ts` | 既存の技術の判定（#18）：`detectStack`（ディスクを読む。fs は注入）、`matchProfiles`（プロファイルの判定。純粋な関数）、`loadDetectionRules` |
| `src/adopt/record.ts` | `detected_stack`・`profiles` の config.yaml への記録（`detectedStackEntry`・`profilesEntry`）と読み戻し（`readDetectedStack`・`readProfiles`） |
| `data/adopt-detection.yaml` | 判定のルール（C-38）：package.json の依存の名前・言語のファイル・版のファイル・プロファイルごとの必須の手がかり |
| `src/commands/adopt.ts` | `harness adopt`。差し込み口は `AdoptDeps`（prompter・cwd・interactive・stderr・stdout・now・fs・secretScan・runner） |
| `data/adopt-values.yaml` | 導入のときだけ、`data/template-values.yaml` の値の代わりに使う値 |
| `src/update/apply.ts` | 原子的な書き込み（`harness update` と共通） |
| `src/update/diff.ts` | 差分の表示（`harness update` と共通） |

## 流れ

1. 場所を決める（`--dir`、なければ作業中のフォルダ）。`.harness/config.yaml` が既にあれば止める（二重に導入しない）
2. `--answers` を読む（必須）。アプリ名は、常にフォルダの名前から決める。名前の形が正しくなければ止めて案内する。回答ファイルに、フォルダの名前と違う `app_name` があれば止める（同じなら可）。端末でなく回答が足りなければ、足りない項目を示して止める
3. `--issue` を確かめる（適用するときは必須、`--dry-run` では不要。正の整数でなければ止める）。端末でなく `--yes` もなければ止める（`--dry-run` を除く）
3.5. （適用するときだけ）新しいブランチの検査（下の「差の一覧と新しいブランチ」）。何も書き換えない。
4. 秘密情報の確認（下の「秘密情報の確認」）。中断（SIGINT・SIGTERM）の受け付けは、この確認より前に始める。`--dry-run` でも確認する
5. ロック（`.harness/.update-lock`。`harness update` と同じ）を取る。`--dry-run` はロックしない
6. 開始の表示（秘密情報の確認の結果・ブランチ・コミット／push／PR をしないこと）。足りない項目だけ質問する
7. `buildAdoptFiles` で導入するファイルを作り、今のファイルを読む（リンクは拒む）。既存の `AGENTS.md`・`CLAUDE.md` が UTF-8 として読めなければ（UTF-16・Shift_JIS 等。BOM 付きの UTF-8 は可）、書き込みの前に止める。印が壊れていても、止める
8. `planAdopt` で判定する
9. `--dry-run`：一覧と差分と差の一覧の件数の要約を表示して終わる（git に触れない）
10. 差分の表示（同じ名前で中身が違うファイルは、省かず全体を見せる。`.harness-new` は使わない）→ 承認（`--yes` なら聞かない。同じ名前で中身が違うファイルは、対話なら「置き換える／残す」を選ぶ。既定は残す）。「いいえ」なら何も書かない。差の一覧（`docs/harness-adoption.md`）は、ほかのファイルの選択が決まった後の内容で作り直し、同名のファイルがあれば同じように選ばせる
11. 新しいブランチへ移ってから（`git switch -c`）、`applyUpdate` で書く。**`.harness/config.yaml` の新規作成も、同じ一括の最後の操作**にする。途中の失敗・中断（Ctrl+C）では、書いた分を元に戻し、ロックも一時ファイルも残さない
12. 結果の一覧（PR の本文に貼れる Markdown）と、次の手順を出す。コミット・push・PR はしない

## 判定

| 判定 | 条件 | 扱い |
| --- | --- | --- |
| doc-merge | `AGENTS.md`・`CLAUDE.md` | 印で囲んで統合する（下の「印と統合」） |
| add | 同じ名前のファイルがない | 追加する |
| same | 中身が同じ（改行の違いは無視） | 書かない。ハーネスの管理に入れる |
| choose | 同じ名前で中身が違う | 上書きしない。差分を見せて選ぶ。置き換えを選んだものだけ、管理に入れる。残したものは管理に入れない |

## 印と統合

印は `<!-- harness:begin -->` と `<!-- harness:end -->`。

- ファイルが無い：印で囲んだ本文だけのファイルを作る
- 印が無い：既存の末尾に「空行＋印で囲んだ本文」を足す。既存の文章は変えない
- 印が1組：中だけを置き換える。印の外は変えない
- 印が壊れている（begin だけ・end だけ・複数組・順番が逆）：書かずに止める
- 改行は、既存のファイルの改行（LF／CRLF。多い方）にそろえる。BOM は保つ
- 何度適用しても同じ結果になる（冪等）。ただし、`.harness/config.yaml` があれば二重に導入しない
- ハーネスの本文の中に、印の文字列は書かない（`mergeBlock` が拒む）

## 記録（`.harness/config.yaml`）

- `mode: adopt`
- `marked_files`：印で囲んだ文書のパス（`AGENTS.md`・`CLAUDE.md`）
- `managed_files`：印で囲んだ文書の指紋は、**印の中の本文**の指紋。それ以外は、ファイル全体の指紋。残した既存のファイルは入れない
- `versions: []`・`accepted_warnings: []`（導入では版の調査をしない）
- `harness status` は、`marked_files` の文書を印の中の本文の指紋で比べる（印の外の編集は数えない）。印が無い・壊れていれば「印が壊れている管理ファイル」として報告する。`marked_files` が無い記録は、これまでどおり全体の指紋で比べる
- `secret_scan`：秘密情報の確認の記録。確認したら `{status: passed, scope: history+worktree | worktree, checked_on}`、省いたら `{status: skipped, checked_on}`。`harness update` は、導入のときの記録をそのまま引き継ぐ
- 記録の `mode` は `create`・`update`・`adopt` を読める（無ければ `create`）

## 既存の技術の判定（Issue #18 の PR-A）

秘密情報の確認の後、足りない項目の質問の前に、ファイルから機械的に判定する（回答は使わない。`Answers` の frontend・backend・infra はプロファイル選びに使わない）。結果は `DetectedStack`（アプリ（フォルダ）ごとの、分類・技術・版・根拠のファイル）。`--dry-run` でも表示する。

- 調べる範囲：ルート、`frontend/`・`backend/`・`apps/*`・`packages/*`、package.json の `workspaces`（深さ2まで）。`node_modules`・`.git`・隠しフォルダは見ない
- 読むファイルは、ルールで決めたものだけ（package.json・go.mod の go 行・版のファイル・`.env.example`・`.github/workflows/` のファイル名）。`.env`・`.env.*`・`.dev.vars` は、名前で先に除外して開かない。`.env.example` は、キーの名前だけを使い、値は捨てる
- **Node.js 以外（Python・Go・Ruby・Java）は、ファイルの有無で言語だけを判定する**（`pyproject.toml`・`requirements.txt`・`setup.py`・`manage.py`・`go.mod`・`Gemfile`・`pom.xml`・`build.gradle(.kts)`）。フレームワーク・依存の名前（Django・pytest・Rails・Spring 等）は判定しない。ファイルの中身から名前を拾うと、説明文・コメント・URL まで拾うため。後の #19 で、AI が根拠つきで補う。表示は「プロファイルなし（Python）」の形
- リンク（シンボリックリンク・ジャンクション）は、lstat で見つけて読まず、「リンクのため読まない」と記録する。探索先（workspaces の値を含む）は、`../`・絶対パス・realpath がルートの外になるものを読まない。壊れた package.json は止めずに「読めなかった」と記録する（中身・エラーの文は残さない）
- プロファイルの判定は、アプリ（package.json などのあるフォルダ）単位。必須の手がかりは、そのアプリとルートの依存だけを合わせて見る（別のアプリは合算しない）。ルートを対象から外すのは、`package.json` に workspaces があり、自分自身はアプリの手がかり（バックエンド・フロント・DB、go.mod・pyproject.toml 等の言語のファイル）を持たない管理用のルートだけ。workspaces の無い独立したルートや、言語のファイルがあるルートは、実アプリとして対象に残す。ルートの依存を子に合算するのは、ルートに workspaces があり、その所属の子だけ。一部だけ合うときは当てず、「プロファイルなし（一部一致：…）」にする。`requires`（例：Hono → 共通ロガー）は profile.yaml から読んで解決する
- 当てるプロファイルは、`applied: [{ profile, apps }]`（対象のアプリのフォルダ付き）。Skill の導入は次の節（PR-B）。表示は「当てたプロファイル」。プロファイルのない技術は「プロファイルなし」として出し、ハーネスの改善の提案（C-78）として、プロファイルを作る提案の文を出す（CLI は Issue を作らない）
- 記録：`detected_stack`（apps・notes）と `profiles`（applied・none）を、導入のときだけ config.yaml に書く。`harness update` は判定し直さず、この記録を引き継ぐ。無い記録（古い config）も読める

## 当てたプロファイルの Skill と CI（Issue #18 の PR-B）

- 入れるのは、**当てたプロファイルの Skill（`SKILL.md`）だけ**。プロファイルの `files`（コード・設定）は入れず、ESLint・Prettier・tsconfig などの品質チェックの道具の設定は作らず、上書きもしない。既存のアプリがハーネスと違う技術なら、`applied` が空で、共通のルールだけ（出力は変わらない）。Skill は `.claude/skills/<名前>/`・`.agents/skills/<名前>/`（選んだ AI の分）に入り、管理するファイルになる
- 組み立て：`buildOutputs` にプロファイルを渡し（良い例の差し込み `{{example:...}}` のため、プロファイルの `files` も一度は描く）、出力のうちプロファイルの `files` の出力先だけを捨てる。`applied` のうち今のハーネスに無いプロファイルは、除いて報告する。除いたものを `requires` している適用済みのプロファイルも、連鎖して除く（Skill だけを入れるので、`requires` の検証は「足りないものを除く」で扱う。`resolveProfiles` の例外で止めない）
- `AGENTS.md` の「ルールを読んで従う」の表：`data/adopt-profile-skills.yaml` の分類ごとの欄に、当てた Skill を足す（`append`＝末尾に足す、`replace`＝「該当する技術の Skill はない」を置き換える、`row`＝DB の行を置き換える）。どのフォルダ（`applied` の `apps`）に当たるかは、Skill の名前の後ろに「（`backend/` のみ）」と書く（ルート全体なら書かない）。良い例・悪い例の案内（`example_skills`・`frontend_example_skills`）も、入れた Skill に合わせる。表に書けない分類のプロファイルは、導入できない（入れた Skill はすべて表にある）
- プロファイルの Skill は、生成したアプリだけにあるコマンド・文書・フォルダ構成・共通の部品を前提にした箇所（導入しない部品を「必須（MUST）」として使わせる指示を含む）を、`data/template-values.yaml` の値にした（`harness create` の値は、これまでの文言のまま）。導入のときは `data/adopt-values.yaml` で入れ替え、各 Skill の冒頭に「このプロジェクトにないものは、既存のものに読み替える」という案内（`profile_skill_note`。`harness create` では空）を足す。テストは、プロファイルの Skill を含む導入の出力全体に、生成したアプリ専用のコマンド・文書・フォルダ構成が無いことを確かめる
- `harness update`：判定し直さず、config の `profiles.applied` を使う。`detected_stack` に JavaScript・TypeScript の言語の項目があれば Node.js のアプリとする。記録の無い古い config は、プロファイルの Skill を入れない
- `.github/workflows/harness-check.yml`（管理するファイル）：`repository: github` かつ `check_location` が `github_actions`・`both` のときだけ出す。`on` は `pull_request` と `push`（main）、`permissions` は `contents: read`、actions は既存のワークフローと同じくタグで固定する。
  - `secret-scan`：履歴をすべて取得し、#17 と同じ固定の gitleaks のイメージ（`gitleaks_image`。profile.yaml の値を差し込む）を `--network none`・`:ro`・`--redact` で動かす。標準エラーは捨て（`2>/dev/null`）、レポートは #17 と同じ3項目だけのテンプレート（`REPORT_TEMPLATE`）で標準出力（`--report-path -`）に出す。終了コード 0 は固定の文、1 で中身があれば一覧と固定の案内、それ以外は固定の文「確認を完了できませんでした」で失敗する。一覧は `jq` で検証してから出す：種類（RuleID）は出さない（独自ルールの id に値が入りうるため。文字種や長さでは秘密と見分けられない。#17 の CLI も同じ）。場所（File）は JSON の文字列として出し、制御文字は逃がす（#17 の CLI と同じく、場所は出す）。**ファイル名そのものに秘密の値を書いていた場合は、その名前が表示される**このリポジトリの `.gitleaks.toml` は gitleaks が使う
  - `npm-audit`：Node.js のアプリのときだけ、別のひな形の断片を値（`npm_audit_job`）として差し込む（ひな形に分岐を作らない）。対象は、`detected_stack` に記録した JavaScript・TypeScript のアプリのフォルダだけ（リポジトリ全体を `find` で探さない）。フォルダの一覧は matrix の配列で渡し、シェルには環境変数（`AUDIT_DIR`）として渡す。フォルダの名前は matrix の JSON（`JSON.stringify` で引用）で渡すので、日本語・括弧・スペースなどは、そのまま使える。使えないのは、絶対パス・`..`・空の名前・`${{`（GitHub の式の注入）・制御文字（改行など）を含むものだけで、一覧に入れず、`harness adopt` の表示（`harness update` では警告）に「npm audit の対象にできないフォルダ：<逃がした名前>（理由）」と出す。`cd` は `cd --` で行う（config を書き換えられても、注入にならない）。フォルダごとに `npm audit --omit=dev --audit-level=high`（既存の脆弱性でも最初から失敗する）。そのフォルダに `package-lock.json` が無ければ、旨を出して失敗にしない
  - Lint・型・テストは入れない（既存のアプリの基準線を決めてから足す。Issue #21）
  - 同じ名前のファイルがあれば、差分を見せて選ばせる（`--yes` では残す）
- smoke（`test/scripts/smoke-generated-harness-check.test.ts`）：生成した `secret-scan` の `run` を、実際の Docker の gitleaks で動かす（Linux コンテナを動かせる Docker と bash があるときだけ）。値は出ない。GitHub のランナー上の動き（権限・`GITHUB_WORKSPACE`）は、手元では確かめていない

## 回答の案を作る Skill（Issue #19）

- `templates/skills/adopt-existing/SKILL.md`：導入の前に、AI が既存の要件定義書・README・設計書・コードを読み、`--answers` の回答のファイルを根拠つきで作るための手順（F-29 の手順3）。もとになった共通仕様は C-05・C-76。F-21 の Skill の表に行がある（`scripts/check-spec-coverage.ts` の `SKILL_FOLDERS`）
- **導入物に入れない**：ハーネスを使う人だけが読む Skill のため、`src/generate/adapter.ts` の `HARNESS_ONLY_SKILLS` に入れ、`harness create`・`harness adopt`・`harness update` の出力に出さない（`.claude/skills/`・`.agents/skills/` に出ない。`create` のスナップショットは変わらない）。配布物（`templates/`）には入る
- 回答の形は変えない：CLI の質問処理（`src/questions`）は変えず、技術プロファイルの候補・根拠は YAML のコメントに書く（CLI は無視する）。プロファイルは #18 の自動判定
- Skill が書く質問は `interactive: false` の質問だけ。値は `src/questions/definitions.ts` と同じ。`undecided` を書けるのは、選択肢に `undecided` がある質問だけ。`idp`・`critical_ops_kinds`・`file_kinds` は、既定値がなく省略しても質問されないので、分からなければ書かず、利用者への報告に「未記入の補足」として一覧にする。分かったら `.harness/config.yaml` の `answers` に追記して `harness update` で反映する
- 秘密情報（`.env` など）は開かず、回答・コメントに値や個人情報を書かない

## 秘密情報の確認（Issue #17）

- 道具：gitleaks の Docker イメージ。`harness create` のセキュリティのテスト（#42）と同じ固定のイメージを、技術プロファイル（`profile.yaml` の `container_images.gitleaks`）から取る（値を二重に持たない）。`--network none`・対象は `:ro`
- 範囲：Git のリポジトリなら、履歴（`gitleaks git`。`--dir` がサブフォルダでも、リポジトリ全体）と、作業フォルダ（`gitleaks dir`。未コミット・未追跡のファイルを含む。`.git` の中は gitleaks の既定で調べない）の2回。どちらかで見つかれば止め、どちらかが失敗しても止める。Git でなければ作業フォルダだけで、その旨を表示・記録する
- 値を出さない：`--redact` に加え、レポートはテンプレート（`--report-format template`。`REPORT_TEMPLATE`）で、生成の時点から場所（File）・行（StartLine）・コミット（Commit）の3項目だけを出す。種類（RuleID）は、独自ルールの id に値が入りうるため出さない（`--redact` は Message＝コミットメッセージを伏せないため）。レポートは一時フォルダにだけ出し（終了時に消す）、読むときも型を確かめて新しいオブジェクトに写す（コミットは先頭7桁）。実行の出力（stdout・stderr）は残さず、失敗の文は決まった文だけ（実行の出力・例外の文を入れない）。File の制御文字は逃がす
- 結果：exit 0 かつ空 → 問題なし。exit 1 かつ中身あり → 見つかった（何も書かずに exit 1）。それ以外（起動できない・時間切れ 10 分・別の終了コード・レポートが読めない）→ 確認できなかったとして止める。Docker が無い・動いていない → 止める（`--skip-secret-scan` のときだけ進める）
- Git かどうかは `git rev-parse --show-toplevel`（`LC_ALL=C`）で判定する。「リポジトリではない」と確かめられたとき（終了コード 128 と固定の判定）だけ作業フォルダのみにし、起動失敗・時間切れ・所有権やアクセス権の拒否・想定外の出力は、確認できなかったとして止める
- 後始末：中断・時間切れ・起動失敗のときは、`finally` でコンテナを名前で探して `docker rm -f` で消す。消せなかった可能性・一時フォルダを消せなかったことは、固定の文で警告する（値は入れない）
- Linux コンテナを動かせない Docker（Windows コンテナのモード。GitHub の Windows ランナーなど）：`docker info --format {{.OSType}}` が windows なら、Docker が無いときと同じく止める（Linux コンテナへの切り替えと `--skip-secret-scan` を案内する）
- レポートの出力先（一時フォルダ）は、所有者だけが書ける権限（mkdtemp の既定）にする。root の権限を持たないコンテナ（user namespace の割り当てがある環境など）では書けず、「結果を読めなかった」として止まる（安全側。他のユーザーに書き換えられないことを優先する）
- 読めないものの調べ：gitleaks（v8.30.1）は、読めないファイル・入れないフォルダを黙って飛ばし、exit 0・空のレポートになりうる。そのため、作業フォルダの確認の前に、同じイメージ・同じマウント（`:ro`・`--network none`）・同じユーザーで、コンテナの中の `sh` と `find` で `/src` の下（`.git` を除く）に、読めない・入れないものが無いかを数える（`UNREADABLE_SCRIPT`）。出力は数だけで、名前は出さない・残さない。1件以上なら「読めないファイル・フォルダが N 件あり、秘密情報を確かめきれません。権限を直すか、`--skip-secret-scan` で省いてください」で止まり、何も書かない。調べ自体の失敗も止まる。gitleaks のイメージは既定で root で動くため、読めないものが問題になるのは、root でも読めない環境（rootless Docker・root squash の共有フォルダなど）である。smoke は、root の権限（`DAC_OVERRIDE`・`DAC_READ_SEARCH`）を落としてまねる
- 中断（SIGINT・SIGTERM）：実行中の gitleaks を止め、コンテナも名前で消し、exit 130。何も書かない
- `/src` に置くフォルダ（Git のトップ）の `.gitleaks.toml` は gitleaks が使う（その設定で許可したものは、見つからない）。あれば、開始の表示で知らせる（サブフォルダにだけあるものは使われない）
- `--skip-secret-scan`：確認しない。開始の表示・結果の一覧・`secret_scan` に「確認していない」と残す。確認が通る前には差分を表示しないが、省いたときは、差分の表示に既存のファイルの値が出うる

## 導入したアプリの更新（`harness update`、Issue #16）

`mode: adopt` の記録のアプリでは、`harness update` は印の中だけを更新する。

- 版の解決・整合性チェック・新しい警告は行わない（導入のときの記録のまま。`versions`・`accepted_warnings` は変えない）。新しい組は `buildAdoptFiles` で作る
- `marked_files` の文書は、UTF-8 でなければ止まる。印が壊れている・無いときも止まり、何も書かない（ロックは外す）
- 印の中の本文を、記録の指紋と新しい本文で比べる（未変更は置き換え、手で書き換えていれば conflict）。置き換えは `mergeBlock` で、印の外のバイト列（BOM・改行を含む）を保つ。conflict で残すときの `.harness-new` には、印を含む全文を書く。記録の指紋は、本文の指紋
- 新しい組に文書が増えて、ディスクに無いときは、印で囲んで追加し、`marked_files` に入れる（消されていれば、今の update と同じく復元を聞く）
- 導入のとき既存を残したファイル（新しい組にあるが管理に入っておらず、ディスクにある）は、管理外として触れず、報告だけする。新しい組から消えた文書・ファイルは、不要になったものとして報告するだけで、消さない
- `config.yaml` は `mode: adopt` のまま、`marked_files` は管理に残った文書にして書き直す

## 差の一覧と新しいブランチ（Issue #20）

F-29 の手順5・6。`harness adopt` は、共通仕様（C-xx）との差の一覧 `docs/harness-adoption.md` を作り、新しいブランチ `chore/<--issue の番号>-adopt-harness` に書く。

| ファイル | 役割 |
| --- | --- |
| `data/adoption-checks.yaml` | 共通仕様の一覧と判定の方法（C-38）。`docs/requirements/` は配布物に入らないため、見出しをここに持つ。`test/adopt/adoption-checks.test.ts` が、`docs/requirements/common/*.md` の冒頭の表の C-xx と過不足なく一致することを確かめる |
| `src/adopt/assess.ts` | `loadAdoptionChecks`・`assessAdoption`（判定。純粋な関数）・`renderAdoptionDoc`（文書の本文。LF）・`summaryLines`（件数の要約） |
| `src/adopt/git.ts` | `parseIssue`・`branchNameFor`・`prepareBranch`（書く前の検査）・`createBranch`（`git switch -c`）。git の実行は `RunGit`（`update.ts` と共通。`AdoptDeps.runGit` で差し替え） |

判定の値は、満たしている／一部／満たしていない／対象外／未確認。CLI は機械的に分かる項目だけ判定する。

| 方法（method） | 判定 |
| --- | --- |
| `harness_files` | 書く（書かない）ファイルの結果から。足した・統合した・置き換えた・同じ内容 → 満たしている。既存を残した → 一部。今回導入しなかったファイルだけ（選ばなかった AI の分など）→ 未確認 |
| `ci` | `harness-check.yml` を導入する、または既存の CI を判定している → 一部（実行内容は未確認）。どちらもなければ満たしていない |
| `stack` | 判定した技術（`detected_stack`）に合えば一部（設定の差は未確認）、なければ満たしていない |
| `scan` | 秘密情報の確認が通った → `clean` の値（既定は満たしている）。省いた → 未確認 |
| `answers` | `rule` が回答の判定（`judge`）で有効でなければ対象外、有効なら未確認 |
| `manual` | 未確認。導入のあとに、AI が Skill「既存のプロジェクトへの導入」の節に従い、根拠つきで埋める |

`rule` は、どの方法にも付けられる。回答で有効でなければ対象外にする。回答が「未定」の項目は、`judge` が安全側で有効にするので、対象外にならない。文書には、ファイルのパスと技術の名前だけを書く（値・中身は書かない）。

- **文書の判定の順序**：差の一覧は、同名ファイルの「置き換える／残す」の選択がすべて確定した後（最終の書き込み内容が決まった後）に作る。`--dry-run` の要約は、選択の前の既定（`--yes` と同じく既存を残す）で作る。`docs/harness-adoption.md` 自身に同名のファイルがあれば、ほかのファイルと同じく、差分を見せて選ぶ（`--yes` は既存を残す）
- 文書は `config.yaml` の `managed_files`（指紋）に入れない。導入のときの記録なので、`harness update` は書き換えない
- **ブランチの検査**（`prepareBranch`）：`.harness/.update-lock` を作る前、最初の書き込みの前に行う。Git のフォルダか、作業ツリーがきれいか（未追跡のファイルを含む。回答のファイルをプロジェクトの中に置いていると止まる）、同名のブランチがないか（今いるブランチがちょうど同名なら続ける）。オプションでの回避はない。`main` 以外にいるときは、今の HEAD から分け、元を表示する
- **ブランチの作成**：承認の後、書き込みの前に `git switch -c`。取り消し・`--dry-run` では作らない。書き込みに失敗したときは、ファイルは元に戻り、ブランチは空で残る（消さず、消し方を表示する）。ロックは未追跡のまま残っていても `switch -c` はできる
- `--issue` は適用するとき必須（`--dry-run` では不要で、git に触れない）。正の整数でなければ止まる
- コミット・push・PR はしない。手順（`git add -A`・`commit`・`push`、GitHub なら `gh pr create`、手元の Git だけなら C-83）を表示する

## 生成したアプリ専用のものを書かない

導入先には、`harness create` が生成するアプリだけにあるもの（`npm run env:check`・`check:app`・`security` などのコマンド、`docs/project-rules.md`・`docs/secrets.md`・`docs/testing/` などの文書、テストが開発・本番の DB と分かれていることの保証、技術プロファイルのコード）が無い。ひな形には分岐を入れず（F-28）、`data/template-values.yaml` の値を、導入のときだけ `data/adopt-values.yaml` で入れ替える。

- `harness create` の値は、これまでの文言のまま（1文字も変えない）
- 品質チェック・テストのコマンドは「未設定」とする。実行する前に、既存のコマンド（`package.json` の `scripts`・README）と、テストが本番や共有の DB に接続しないことを確かめさせ、不明なら利用者に聞かせる
- `AGENTS.md` の「ルールを読んで従う」の表は、出さない Skill を書かない（技術プロファイルの Skill の欄は、当てたプロファイルがなければ「該当する技術の Skill はない」とし、当てたものがあれば、その Skill を書く）
- 手元の Git だけで管理する場合（`repository: local`）も、`docs/issues/`・`npm run merge:check` などを前提にしない
- `data/adopt-values.yaml` に、`data/template-values.yaml` にない名前は書けない（書き間違いは止まる）

文書のパス・フォルダ構成（`docs/requirements.md`・`docs/design/`・`docs/adr/`・`docs/tech-stack.md`・`docs/api/`・`docs/testing/`・`prototype/`・`backend/src/`・`frontend/src/`）と、権限の設定の `npm run env:check` の案内も、同じ仕組みで入れ替える。導入先では「既存のプロジェクトの文書・手順・フォルダ構成を確かめて合わせる（無ければ、利用者に聞く）」とする。テストは、全 Skill・両 AI（`.claude`・`.codex`）のエージェントの定義・AI の権限の設定まで、導入の出力全体に、これらが無いことを確かめる。

## テスト

`test/adopt/`（印・判定・組み立て・Skill「既存のプロジェクトへの導入」`adoption-skill.test.ts`・秘密情報の確認 `secret-scan.test.ts`。プロファイルの Skill `build-profiles.test.ts`、`harness-check.yml` `harness-check.test.ts`）、`test/commands/adopt-profiles.test.ts`（Skill・`harness-check.yml` の導入と、update が記録した `applied` で組み直すこと）、`test/scripts/smoke-generated-harness-check.test.ts`（実際の Docker の gitleaks で、生成した確認の `run` を動かす）、`test/commands/adopt-secret-scan.test.ts`（確認の道具を差し替えた結果の扱い）、`test/scripts/smoke-generated-secret-scan.test.ts`（実際の Docker の gitleaks。`npm run test:smoke`。Docker が無ければ飛ばす）、`test/adopt/detect*.test.ts`・`match-profiles.test.ts`（技術の判定。偽の fs で、読んだパスを記録して .env・リンク・ルートの外を確かめる）、`test/commands/adopt-detect.test.ts`（`test/fixtures/adopt-hono-react`・`adopt-django`・`adopt-go`・`adopt-mixed` を写して実行）、`test/commands/adopt.test.ts`（架空の既存のアプリ `test/fixtures/adopt-sample/` を一時フォルダに写して実行）。Issue #20：`test/adopt/assess.test.ts`・`adoption-checks.test.ts`・`git.test.ts`（偽の git。`git-helpers.ts` が偽の git と、既存のテスト向けの `runAdopt` の包みを持つ）、`test/commands/adopt-report.test.ts`（差の一覧とブランチ。偽の git）、`test/commands/adopt-branch.test.ts`（実際の git）。`test/commands/update.test.ts`・`status.test.ts`・`test/update/read-config.test.ts` に、導入済みのアプリの扱いを足した。
