# 設計書：既存のプロジェクトへの導入（最小限、Issue #15）

## 目的と範囲

`harness adopt` で、すでに動いているプロジェクトに、AI 向けのルールを足す（F-29、親 #5）。この Issue は最小限で、**既存のファイルを失わずに、AI 向けのファイルだけを足す**ところまでを扱う。

最優先の約束は、**利用者の既存のファイルを失わないこと**である。既存の文書は印で囲んだ部分だけを足し、同じ名前のファイルは上書きしない。

受け入れ条件

| 番号 | 内容 |
| --- | --- |
| AC-1 | `AGENTS.md`・`CLAUDE.md` は、既存の内容を残し、ハーネスの部分を印（`<!-- harness:begin -->`〜`<!-- harness:end -->`）で囲んで追加する。印の外は1文字も変えない |
| AC-2 | 共通の Skill・エージェントの定義・AI の権限の設定は、同じ名前のファイルがなければ追加する。ある場合は、差分を見せて利用者が選ぶ（`--yes` では既存を残す） |
| AC-3 | 技術プロファイルの Skill は入れない。生成したアプリにだけあるコマンド・文書を、導入先の文書に書かない |
| AC-4 | `--dry-run` は何も書かない。取り消しでも何も書かない |
| AC-5 | `--answers` は必須。足りない項目だけ質問する。アプリ名はフォルダの名前から決める（回答ファイルの `app_name` が違えば止める） |
| AC-6 | 書き込みは一括で、失敗・中断では元のバイト列に戻る |

この Issue でまだやらないこと（別の Issue）

- 秘密情報の確認（gitleaks で履歴も含めて確かめる。F-29 の手順1）：#17。この Issue では、`harness adopt` の開始時に「秘密情報の確認（履歴を含む）はまだ行いません。導入の前に、秘密情報が含まれていないことを確かめてください」と表示する
- 既存の構成・コードを調べる・AI が読んで答えの案を作る（手順2・3）、差の一覧（手順5）、ブランチ・PR（手順6）、基準線（手順7）
- CI の追加、品質チェックの道具の設定、`docs/requirements.md` のひな形

実装を正とする。この設計書とコードが食い違ったときは、コードの動きを正として設計書を直す。

## ファイルと役割

| ファイル | 役割 |
| --- | --- |
| `src/adopt/markers.ts` | 印の検出（`extractBlock`）と統合（`mergeBlock`）。純粋な関数。印の文字列は `BEGIN`・`END` |
| `src/adopt/build.ts` | `buildAdoptFiles`：導入するファイルを、メモリ上で組み立てる。技術プロファイルを使わず、AI 向けのファイルだけ |
| `src/adopt/plan.ts` | `planAdopt`：ファイルごとに doc-merge・add・same・choose を決める。純粋な関数 |
| `src/commands/adopt.ts` | `harness adopt`。差し込み口は `AdoptDeps`（prompter・cwd・interactive・stderr・stdout・now・fs） |
| `data/adopt-values.yaml` | 導入のときだけ、`data/template-values.yaml` の値の代わりに使う値 |
| `src/update/apply.ts` | 原子的な書き込み（`harness update` と共通） |
| `src/update/diff.ts` | 差分の表示（`harness update` と共通） |

## 流れ

1. 場所を決める（`--dir`、なければ作業中のフォルダ）。`.harness/config.yaml` が既にあれば止める（二重に導入しない）
2. `--answers` を読む（必須）。アプリ名は、常にフォルダの名前から決める。名前の形が正しくなければ止めて案内する。回答ファイルに、フォルダの名前と違う `app_name` があれば止める（同じなら可）。端末でなく回答が足りなければ、足りない項目を示して止める
3. 端末でなく `--yes` もなければ止める（`--dry-run` を除く）
4. ロック（`.harness/.update-lock`。`harness update` と同じ）を取る。`--dry-run` はロックしない
5. 開始の表示（秘密情報の確認をまだ行わないこと・コミット／push をしないこと）。足りない項目だけ質問する
6. `buildAdoptFiles` で導入するファイルを作り、今のファイルを読む（リンクは拒む）。既存の `AGENTS.md`・`CLAUDE.md` が UTF-8 として読めなければ（UTF-16・Shift_JIS 等。BOM 付きの UTF-8 は可）、書き込みの前に止める。印が壊れていても、止める
7. `planAdopt` で判定する
8. `--dry-run`：一覧と差分を表示して終わる
9. 差分の表示（同じ名前で中身が違うファイルは、省かず全体を見せる。`.harness-new` は使わない）→ 承認（`--yes` なら聞かない。同じ名前で中身が違うファイルは、対話なら「置き換える／残す」を選ぶ。既定は残す）。「いいえ」なら何も書かない
10. `applyUpdate` で書く。**`.harness/config.yaml` の新規作成も、同じ一括の最後の操作**にする。途中の失敗・中断（Ctrl+C）では、書いた分を元に戻し、ロックも一時ファイルも残さない
11. 結果の一覧（PR の本文に貼れる Markdown）を出す。コミット・push はしない

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
- 記録の `mode` は `create`・`update`・`adopt` を読める（無ければ `create`）

## 導入したアプリの更新（`harness update`、Issue #16）

`mode: adopt` の記録のアプリでは、`harness update` は印の中だけを更新する。

- 版の解決・整合性チェック・新しい警告は行わない（導入のときの記録のまま。`versions`・`accepted_warnings` は変えない）。新しい組は `buildAdoptFiles` で作る
- `marked_files` の文書は、UTF-8 でなければ止まる。印が壊れている・無いときも止まり、何も書かない（ロックは外す）
- 印の中の本文を、記録の指紋と新しい本文で比べる（未変更は置き換え、手で書き換えていれば conflict）。置き換えは `mergeBlock` で、印の外のバイト列（BOM・改行を含む）を保つ。conflict で残すときの `.harness-new` には、印を含む全文を書く。記録の指紋は、本文の指紋
- 新しい組に文書が増えて、ディスクに無いときは、印で囲んで追加し、`marked_files` に入れる（消されていれば、今の update と同じく復元を聞く）
- 導入のとき既存を残したファイル（新しい組にあるが管理に入っておらず、ディスクにある）は、管理外として触れず、報告だけする。新しい組から消えた文書・ファイルは、不要になったものとして報告するだけで、消さない
- `config.yaml` は `mode: adopt` のまま、`marked_files` は管理に残った文書にして書き直す

## 生成したアプリ専用のものを書かない

導入先には、`harness create` が生成するアプリだけにあるもの（`npm run env:check`・`check:app`・`security` などのコマンド、`docs/project-rules.md`・`docs/secrets.md`・`docs/testing/` などの文書、テストが開発・本番の DB と分かれていることの保証、技術プロファイルの Skill）が無い。ひな形には分岐を入れず（F-28）、`data/template-values.yaml` の値を、導入のときだけ `data/adopt-values.yaml` で入れ替える。

- `harness create` の値は、これまでの文言のまま（1文字も変えない）
- 品質チェック・テストのコマンドは「未設定」とする。実行する前に、既存のコマンド（`package.json` の `scripts`・README）と、テストが本番や共有の DB に接続しないことを確かめさせ、不明なら利用者に聞かせる
- `AGENTS.md` の「ルールを読んで従う」の表は、出さない Skill を書かない（技術プロファイルの Skill の欄は、「該当する技術の Skill はない」とする）
- 手元の Git だけで管理する場合（`repository: local`）も、`docs/issues/`・`npm run merge:check` などを前提にしない
- `data/adopt-values.yaml` に、`data/template-values.yaml` にない名前は書けない（書き間違いは止まる）

文書のパス・フォルダ構成（`docs/requirements.md`・`docs/design/`・`docs/adr/`・`docs/tech-stack.md`・`docs/api/`・`docs/testing/`・`prototype/`・`backend/src/`・`frontend/src/`）と、権限の設定の `npm run env:check` の案内も、同じ仕組みで入れ替える。導入先では「既存のプロジェクトの文書・手順・フォルダ構成を確かめて合わせる（無ければ、利用者に聞く）」とする。テストは、全 Skill・両 AI（`.claude`・`.codex`）のエージェントの定義・AI の権限の設定まで、導入の出力全体に、これらが無いことを確かめる。

## テスト

`test/adopt/`（印・判定・組み立て）、`test/commands/adopt.test.ts`（架空の既存のアプリ `test/fixtures/adopt-sample/` を一時フォルダに写して実行）。`test/commands/update.test.ts`・`status.test.ts`・`test/update/read-config.test.ts` に、導入済みのアプリの扱いを足した。
