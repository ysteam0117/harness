---
name: adopt-existing
description: 既存のプロジェクトにハーネスを導入する前に、要件定義書・README・設計書・コードを読み、`harness adopt` に渡す回答のファイル（根拠つき）を作るときに読む。ハーネスの利用者が、導入の前に使う Skill で、導入先のプロジェクトには入らない。導入のあとに、差の一覧（docs/harness-adoption.md）の「未確認」を埋めるときにも読む。
---

<!-- もとになった共通仕様：C-05・C-76 -->

# 既存のプロジェクトへの導入（回答の案を作る）

作業の過程と結果は、すべて日本語で書く。

この Skill は、すでに動いているプロジェクトに `harness adopt` を実行する前に使う。既存の文書とコードを読み、`harness adopt --answers <ファイル>` が読める回答の案を、根拠つきで作る。回答を決めるのは利用者で、AI は案を作って根拠を示す（要件の確認は利用者との対話で行う。C-76）。

## 守ること

- 秘密情報は開かない。`.env`、`.env.*`（`.env.example` を除く）、秘密鍵（`*.pem`・`*.key`・`id_rsa` など）、`*.tfstate`、認証情報のファイルは、読まない・一覧にも中身を出さない。`.env.example` は、項目の名前だけを見る（値は読まない・書かない）
- 回答のファイルとコメントに、秘密情報の値、個人の名前、メールアドレス、電話番号などの個人情報を書かない。根拠には、読んだファイルのパス（と節の名前）だけを書く（C-05）
- `app_name` は書かない。アプリ名は、`harness adopt` を実行するフォルダの名前から決まる
- 推測で埋めない。文書とコードから判定できないものは、`undecided` にして、利用者に聞く

## 手順

1. 読むものの一覧を作る：要件定義書、`README.md`、設計書（`docs/` など）、`package.json` などの依存の一覧、設定ファイル、ルーティングやAPIのコード。読む前に、一覧を利用者に見せる（秘密情報のファイルが入っていないことを確かめる）
2. 下の「判定の表」の質問ごとに、読んだ内容から答えを判定する
3. 各項目の直前の行に、根拠を `# 根拠: パス（節の名前など）` の形で書く
4. 判定できない項目は、`undecided` と書き、直前の行に `# 根拠: なし（判定できない）` と書く。ただし、`undecided` を書けない質問（表の「undecided」の列が不可）は、分からなければ項目ごと書かない（省略する）
5. 技術プロファイルの候補は、ファイルの末尾にコメントで書く（候補の名前と、手がかりにしたファイル）。技術プロファイルは、`harness adopt` がファイルから自動で判定するので、回答のファイルには項目として書かない。コメントは参考で、CLI は読まない
6. 書いてよいキーは、質問の id と `accepted_warnings` だけ。ほかのキー（`app_name` を含む）を書くと、`harness adopt` が拒否する
7. `harness adopt --answers <ファイル> --dry-run` を実行して、回答が読めること、何が変わるかを確かめる。エラーが出たら、表の条件を見直して直す（このコマンドは何も書かない）。実際の導入は、利用者が決めて実行する（`--issue <導入先の Issue の番号>` が必要。新しいブランチ `chore/<番号>-adopt-harness` に書き、コミット・push・PR は利用者が行う）

## 判定の表

対象は、`harness adopt` が端末で聞かない質問（回答のファイルに書く質問）。値は `harness adopt` が読む値と同じものだけを書く。

| id | 質問 | 選べる値 | 条件 | undecided | 判定の目安 |
| --- | --- | --- | --- | --- | --- |
| `auth` | 認証方式 | none・app・oidc・both・undecided | なし | 可 | ログインがなければ none。自前のパスワードなら app。外部のアカウントなら oidc。両方なら both |
| `idp` | 外部IdP | google・microsoft・other | auth が oidc か both のときだけ | 不可 | ログインに使う外部のアカウントの種類。分からなければ書かない |
| `personal_data` | 個人情報の扱い | none・basic・sensitive・undecided | なし | 可 | 氏名・連絡先なら basic。健康・信用などなら sensitive |
| `admin` | 管理者機能 | no・yes・undecided | auth が none のときは no に決まる | 可 | 管理画面や管理者向けの操作の有無 |
| `critical_ops` | 重要な操作（決済・公開範囲を広げる・削除・権限の変更など） | no・yes・undecided | なし | 可 | 該当する操作があるか |
| `critical_ops_kinds` | 重要な操作の種類（複数選べる） | payment・publish・delete・permission | critical_ops が yes のときだけ | 不可 | 一覧で書く。分からなければ書かない |
| `collaborative` | 複数人での共同作業（同時編集・共有） | no・yes・undecided | auth が none のときは no に決まる | 可 | 同時編集や共有の機能の有無 |
| `org_separation` | 組織ごとのデータ分離 | no・yes・undecided | なし | 可 | 組織（会社・チーム）ごとにデータを分ける作りか |
| `realtime` | リアルタイムの更新 | no・yes・undecided | なし | 可 | WebSocket や配信で、画面がすぐ更新されるか |
| `availability` | 止まったときの影響 | tolerant・critical・undecided | なし | 可 | 止まって困るかどうか。コードからは分かりにくいので、文書になければ undecided |
| `file_upload` | ファイルのアップロード | no・yes・undecided | なし | 可 | アップロードの機能の有無 |
| `file_kinds` | 扱うファイルの種類（複数選べる） | image・video・document | file_upload が yes のときだけ | 不可 | 一覧で書く。分からなければ書かない |

- 条件に合わない項目は書かない。条件の質問が `undecided` や省略のときは、その補足は書けない（`harness adopt` が拒否する）
- `auth` が none のとき、`admin` と `collaborative` は no に決まる（書くなら no。別の値は拒否される）
- 一覧で書く質問（`critical_ops_kinds`・`file_kinds`）は、1つ以上を YAML の配列で書く

### 分からない補足（未記入の補足）

`idp`・`critical_ops_kinds`・`file_kinds` は、既定値がなく、省略しても `harness adopt` は質問しない。分からなければ書かず、利用者への報告に「未記入の補足」として、項目の名前と理由を一覧にして伝える。分かった時点で、`.harness/config.yaml` の `answers` に追記して、`harness update` を実行すると反映される（`harness update` は回答のファイルを受け取らず、`.harness/config.yaml` の `answers` を読む）。

## 開発環境の質問（事実が分かるものだけ）

次の質問は、ファイルで事実が確かめられたときだけ書く。分からないものは書かない（`harness adopt` を端末で実行したときに聞かれる）。

- `repository`：Git の remote が GitHub なら `github`。remote がなく、手元の Git だけなら `local`
- `database`：D1 の設定（`wrangler.toml` の `d1_databases` など）があれば `d1`。PostgreSQL の接続の設定やクライアントの依存があれば `postgresql`。DB を使っていないと確かめられたら `none`
- `postgres_provider`：`database` が `postgresql` で、提供元が文書や設定の名前で確かめられたときだけ（`neon`・`supabase`・`other`）

それ以外（使うAI、公開範囲、開発人数、品質チェックの実行場所、バージョンの方針）は、利用者が決めることなので、書かない。

## 回答のファイルの例

```yaml
# 根拠: docs/requirements.md の「認証」の節（Google アカウントでログイン）
auth: oidc
# 根拠: docs/requirements.md の「認証」の節
idp: google
# 根拠: docs/requirements.md の「扱う情報」の節（氏名と連絡先を保存する）
personal_data: basic
# 根拠: README.md（管理画面の記述がない）
admin: no
# 根拠: なし（判定できない）
critical_ops: undecided
# 根拠: なし（判定できない）
collaborative: undecided
# 根拠: docs/requirements.md（組織の区別はない）
org_separation: no
# 根拠: なし（判定できない）
realtime: undecided
# 根拠: なし（判定できない）
availability: undecided
# 根拠: src/routes（アップロードの処理がない）
file_upload: no

# 技術プロファイルの候補（CLI は読まない。harness adopt が自動で判定する）
# - backend-framework/hono：package.json の dependencies に hono がある
```

## 導入のあとに、未確認の項目を埋める

`harness adopt` が新しいブランチに書いた `docs/harness-adoption.md`（共通仕様との差の一覧）は、CLI が機械的に分かる項目だけを判定し、ほかは「未確認」にしてある。導入のあとに、この「未確認」を、コードと文書を読んで埋める。

判定の値は、次の5つだけを使う。

| 値 | 意味 |
| --- | --- |
| 満たしている | 基準を満たしていると、読んだ内容で確かめられた |
| 一部 | 一部は満たしているが、足りない点がある |
| 満たしていない | 基準を満たす手がかりが、読んでも見つからなかった |
| 対象外 | このアプリには当てはまらない（回答の条件に合わない） |
| 未確認 | 判断できなかった（無理に決めない） |

手順：

1. 導入したブランチ（`--issue` で指定した番号の `chore/<番号>-adopt-harness`）にいることを確かめ、`docs/harness-adoption.md` の表で「未確認」の行（共通仕様の番号と内容）を一覧にする。共通仕様の文書（`docs/requirements/common/`）は、導入先には無い。内容は、表の見出しと、導入した Skill・AGENTS.md の該当の節で確かめる
2. 行ごとに、関係するコード・設定・文書を読む。読む前に、読むファイルの一覧を利用者に見せる。秘密情報のファイル（`.env`、`.env.*`（`.env.example` を除く）、秘密鍵、`*.tfstate`、認証情報のファイル）は開かない
3. 値を決め、「根拠」の列に、読んだファイルのパス（と節・関数の名前）だけを書く。コード・設定の値、ファイルの中身、秘密情報、個人の名前、メールアドレスは、書かない（C-05）
4. 判断できない行は、「未確認」のままにして、根拠の列に理由を書く。推測で埋めない
5. 件数の要約を、表に合わせて書き直す
6. 利用者に、埋めた結果（件数の変化と、判断できなかった行）を報告する。`harness update` は、この文書を書き換えない（導入のときの記録なので、書き換えるのは、この手順だけ）

埋めたあとは、「満たしていない」「一部」の項目を、優先度を付けて Issue にする（F-29 の手順7）。一度にすべてを直さない。Issue の本文には、対象の共通仕様の番号、現状（根拠のファイルのパス）、直す方針、受け入れ基準を書く。優先度は、秘密情報の混入・本番の依存の高・重大の脆弱性（最初から直す）、セキュリティ、テスト、そのほか、の順を目安にし、利用者と決める。Issue は、導入のブランチを取り込んだあとの `main` から分けた、別のブランチで直す。

## 報告のしかた

- 作った回答のファイルの場所と、`--dry-run` の結果
- `undecided` にした項目と、省略した補足（未記入の補足）の一覧と、そのまま決めてよいか利用者に確認したいこと
- 秘密情報のファイルは開かなかったこと
