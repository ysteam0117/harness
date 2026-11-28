# 変更履歴

ハーネスのバージョンごとの主な変更点。`harness status` は、このファイルから、プロジェクトのバージョンより新しい項目を表示する。バージョンはセマンティックバージョニング（C-08）で付ける。

## 0.8.0

- GitHub の生成先で Vitest と該当する Workers 用パッケージの定期更新を `vitest-packages` にまとめた（C-62・C-82、Issue #105）。Hono では Vitest のメジャー版の定期更新を止める。Workers 用パッケージが Vitest 5 に対応し、組み合わせの動作を確かめたら解除する。
- 管理する `.github/dependabot.yml` は `harness update` で更新する。編集済みの設定は対話で差分を確かめ、`--yes` では新しい設定を `.harness-new` に置く。導入先でハーネスの管理外にある設定と、既存の `docs/testing/security.md` には必要に応じて手で反映する。
- 0.7.1 は Hono・Zod の公開勧告に対応した同じ系列の互換性のある修正。最初の修正版は Hono 4.13.16・Zod 4.6.6。

## 0.7.1

- 新規生成で使う検証済みの版を Hono 4.13.23 と Zod 4.6.7 に更新した（F-16・F-19、Issue #103）。項目と仕様を保ち、同じ系列の修正版を選んだ（C-08 の PATCH）。
- 生成済み・導入済みの場合は、プロジェクト側で依存を更新する。 `harness status` と `harness update` でこの変更履歴を確認できる。

## 0.7.0

- 非同期で整う状態は、必要な条件が成立するまで待って確かめる（C-25・C-52、Issue #101）。Testing Library で DOM を検索する場合の `getBy*`・`findBy*`・`waitFor` の使い分けをテスト Skill に追加した。
- test-tools に、`frontend/src/rules-examples/async-query.test.tsx` で動作を確かめた2つの例を追加した。管理している Skill と担当の定義は `harness update` で更新する。create のプロジェクトには例のテストを追加し、adopt ではプロファイルを導入している場合に Skill に例を展開する。導入時に管理外に残した同名ファイルには必要に応じて手動で取り込む。

## 0.6.0

- `harness status` で Claude Code の承認設定を調べる（F-27・F-28、Issue #99）。対象の `.claude/settings.local.json` と `.claude/settings.json`、標準の `~/.claude/settings.json` の `permissions.defaultMode` を確認し、版や条件によっては未設定でも auto で始まることを知らせる。
- 利用者による承認を手元の設定や起動方法で省かないことを、統括・各担当の定義・共通の依頼に明記した（C-66・C-75）。管理ファイルには `harness update` で反映する。変更済みなら対話で差分を確認し、`--yes` では新しい内容を `.harness-new` に置く。adopt で管理外に残した文書・定義・Skill は手動で取り込む。個人設定の `.claude/settings.local.json`・`~/.claude/settings.json` は更新対象外。

## 0.5.0

- 工程の記録の書式を追加した（C-35・C-66・C-83、Issue #97）。担当は開始・終了、待機理由、再実行、使用量の範囲・取得元と未取得の理由を統括へ報告する。統括が既存の記録先に要約を手で残す。
- 管理対象の `AGENTS.md`・Skill・エージェント・記録テンプレートは `harness update` で更新する。既にあるPR・Issueのファイルには統括が手で節を足す。adopt 時に管理外に残した同名ファイルと既存のローカルIssueのREADMEは必要に応じて手で取り込む。

## 0.4.0

- 計画・コードレビューの依頼と結果を重大・軽微でそろえ、終了と再レビューの条件を明記した（C-33・C-66、Issue #95）。計画レビューは必要な場合も原則2回以内とし、2回目に重大が残る場合に3回目を行う。コードレビューは最大3回。データ破損・認証の回避・情報漏えいにつながる指摘は解消まで続ける。
- 統括が、後追いの対象・担当・理由・追跡先と、軽微な修正で再レビューを省く場合の根拠を記録する。管理対象の `AGENTS.md`・Skill・エージェントは `harness update` で更新し、adopt で管理外に残した同名ファイルは必要に応じて手で取り込む。

## 0.3.0

- 手元の対象検証と CI の全体確認を分け、検証の範囲・結果・対象コミットを記録する手順を追加した（C-61、Issue #93）。「両方」を選んだプロジェクトは両方の全体確認を行う。commit・push 前の手元の秘密情報確認と、CI に含まれない必須確認を維持する。
- 管理対象の Skill、エージェント、`AGENTS.md` と PR・ローカル Issue のテンプレートは `harness update` で更新する。既存の `check.yml` と品質チェックの手順書、adopt 時に管理外に残した同名ファイルは、必要に応じて手動で取り込む。

## 0.2.0

- 委譲した作業の一時フォルダを安全に割り当て、完了の報告時に残す手順を追加した。担当の状態を区別し、承認が必要な操作は実行前に統括へ報告する（C-66、Issue #90）。
- Orca連携の有無を問わず、利用上限に達したときは利用者が待機や別のモデルへの切り替えなどから続け方を選ぶ。利用上限以外でClaude Codeが使えない場合は、従来のCodexへの切り替え手順に従う。
- レビュー Skill では、承認を必要としない通常のコマンドの失敗だけでレビュー全体の失敗と判断せず、承認が必要な操作は保留して統括に報告する。
- 管理対象の `CLAUDE.md`・Skill・エージェントの定義に `harness update` で反映する。adopt 時に管理外として残した同名の文書・定義は手動で取り込む。

## 0.1.0

- ミューテーションなど重い検証の事前確認、結果の保存、異常時の停止と再開条件を共通の testing Skill・品質チェック担当・品質 Skill に反映した（C-25、Issue #87）。`harness update` は管理対象の Skill・エージェントに反映する。既存導入先の `docs/testing/mutation.md` と、adopt 時に管理外として残した同名ファイルは、必要に応じて今回の手順を手動で取り込む。

### 0.0.1 以降に main に入った変更

- Spring Boot・Gradle のバックエンドと、対応する React のフロントエンドを生成できるようにした（#40）。
- CSS の共通ルール（C-06）を追加し、配布する Node.js の最低バージョンを 24.22.1 に更新した。
- 生成に使う検証済みの版を Spring Boot 4.1.2、Vite 8.3.3、Vitest 4.1.12 に更新した。
- ミューテーションテストの対象範囲、全体確認の時期、結果の再利用条件を C-25 に明記した（#71）。
- Orca 連携、統括 AI による進行、利用上限からの再開に関する要件と設計を記載した（#59）。ゼロトラストを要件の未決定事項に追加した（#65）。
- CLI と生成処理で重複していた関数・定数を整理した（#76）。

## 0.0.1

インストールを、GitHub の Release に付けた tgz から行う形にした（Issue #48。`npm install -g https://github.com/ysteam0117/harness/releases/latest/download/harness.tgz`）。GitHub を直接指定する形は、npm の仕様で入らない。

セキュリティのテストの道具を、技術プロファイルに追加した（Issue #42）。

### 既存のプロジェクトへの導入（`harness adopt`、Issue #15。最小限）

- `harness adopt --answers <file>`：既存のプロジェクトに、AI 向けのルールだけを足す。`AGENTS.md`・`CLAUDE.md` は、既存の内容を残して、印（`<!-- harness:begin -->`〜`<!-- harness:end -->`）で囲んで追加する。共通の Skill・エージェントの定義・AI の権限の設定は、同じ名前のファイルがなければ追加し、あれば差分を見せて選ぶ（`--yes` では既存を残す）。技術プロファイルの Skill・コード・CI・設定ファイルには触れない
- 秘密情報の確認（Issue #17）：導入の前に、Docker の gitleaks（`harness create` のセキュリティのテストと同じ、版とダイジェストで固定したイメージ。ネットワークなし・読み取り専用）で、Git の履歴と作業フォルダ（未コミット・未追跡のファイルを含む）を確かめる。Git のリポジトリでなければ、作業フォルダだけ。見つかったら、何も書かずに止まり、場所・行・コミットだけを表示する（種類は、独自ルールの名前に値が入りうるため出さない）（値は表示しない・どこにも残さない）。Docker が使えないときも止まる。`--skip-secret-scan` で省けるが、`.harness/config.yaml` の `secret_scan` に「確認していない」と記録する（省いたときは、`--dry-run` などの差分の表示に、既存のファイルの値が出ることがある）。`--dry-run` でも確認する。このフォルダに `.gitleaks.toml` があれば、その設定が使われる。gitleaks が黙って飛ばす、読めないファイル・フォルダがあれば、確かめきれないとして止まる
- `.harness/config.yaml` に `mode: adopt`・`marked_files` を記録する。`harness status` は、印で囲んだ文書を、印の中の本文の指紋で比べる。導入したアプリの `harness update` は、印の中だけを新しい内容にする（印の外は変えない。Issue #16）
- 導入先の AI 向けの文書には、生成したアプリだけにあるコマンド・文書（`npm run env:check` など）を書かない。品質チェック・テストのコマンドは「未設定」とし、既存のコマンドを確かめさせる。`harness create` の出力は変わらない

- 既存の技術の判定（Issue #18 の一部）：`harness adopt` が、ファイルから機械的に、言語・実行環境の版・バックエンド・フロント・DB・テスト・品質チェック・CI を判定して表示する（`--dry-run` でも）。`.env` 等の秘密情報のファイルは読まず、リンクはたどらず、ルートの外は読まない。必要な手がかりがすべて合うときだけ技術プロファイルを「当てたプロファイル」とし、合わない技術は「プロファイルなし（一部一致：…）」とハーネスの改善の提案を表示する。結果は `.harness/config.yaml` の `detected_stack`・`profiles` に記録し、`harness update` はそれを引き継ぐ。Node.js 以外（Python・Go・Ruby・Java）は、ファイルの有無で言語だけを判定し、フレームワーク・依存の名前は判定しない（後の #19 で AI が根拠つきで補う。表示は「プロファイルなし（Python）」の形）。出力のファイルは変わらない

- 当てたプロファイルの Skill と CI の確認（Issue #18）：`harness adopt` は、当てた技術プロファイルの Skill だけを入れる（`.claude/skills/<名前>/`・`.agents/skills/<名前>/`。プロファイルのコード・設定は入れず、ESLint・Prettier・tsconfig などの設定は作らず、上書きもしない）。`AGENTS.md` の「ルールを読んで従う」の表に Skill の行を足し、どのフォルダに当たるかを書く。既存のアプリがハーネスと違う技術なら、共通のルールだけ。`harness update` は、判定し直さず、記録した `profiles.applied` で組み直す（今のハーネスに無いプロファイルは、除いて報告する）。GitHub で品質チェックを GitHub Actions で行うときは、`.github/workflows/harness-check.yml` を追加する（秘密情報の確認を常に、`npm audit --omit=dev --audit-level=high` を Node.js のアプリのときだけ。Lint・型・テストは入れない。既存のワークフローは変えない）。`harness create` の出力は変わらない

- Skill「既存のプロジェクトへの導入」（Issue #19）：`templates/skills/adopt-existing/SKILL.md`。導入の前に、AI が既存の要件定義書・README・設計書・コードを読み、`harness adopt --answers` に渡す回答のファイルを、根拠（読んだファイル）つきで作る手順。判定できない項目は `undecided` にし、技術プロファイルの候補は YAML のコメントで書く（CLI は読まない）。`.env` などの秘密情報は開かない。この Skill はハーネスを使う人だけが読むもので、`harness create`・`harness adopt`・`harness update` の出力には入らない。回答の形・CLI の質問は変わらない

- 差の一覧と新しいブランチ（Issue #20）：`harness adopt` が、共通仕様（C-xx）との差の一覧 `docs/harness-adoption.md` を作る。判定は「満たしている／一部／満たしていない／対象外／未確認」。CLI は機械的に分かる項目（導入したファイル・CI・判定した技術・秘密情報の確認・回答で当てはまらない条件つきのルール）だけ判定し、ほかは「未確認」にする（回答が「未定」の項目は、対象外にしない）。導入のあとに AI が Skill「既存のプロジェクトへの導入」の節に従って「未確認」を根拠つきで埋め、Issue にする。文書にはファイルのパスと名前だけを書き、導入のときの記録として `harness update` は書き換えない。共通仕様の一覧は `data/adoption-checks.yaml`
- `harness adopt --issue <番号>`（適用するときは必須。`--dry-run` では不要）：承認のあと、書く前に、新しいブランチ `chore/<番号>-adopt-harness` に移る。Git のフォルダでない・作業ツリーが汚れている・同じ名前のブランチが別にある、のときは、何も書かずに止まる（今いるブランチがちょうど同名なら続ける）。`main` 以外にいるときは、今の HEAD から分ける。コミット・push・PR はせず、手順を表示する。`harness create` の出力は変わらない

- 基準線（Issue #21）：Node.js のアプリがあるとき、`harness adopt` が `.harness/scripts/baseline-check.mjs` を置く（確認の場所によらず。`harness update` で置き換わる）。導入のときの Lint・型・書式の違反の件数（ESLint のエラーと警告・tsc の型エラー・Prettier の整形が要るファイル。各アプリの `node_modules` に道具と設定があるものだけ。ハーネス自身の `.harness/` の下は数えない）を `.harness/baseline.json` に記録し、増えたら失敗する。`harness adopt` は件数を測らない。導入のあと、各アプリで `npm ci` をしてから `node .harness/scripts/baseline-check.mjs --init` を実行し、できた `baseline.json` をコミットする。減ったら `--update` で下げる。上げるのは `--update --allow-increase` のときだけで、ADR に記録し承認を得る（C-80）。道具の異常終了は 0 件にせず失敗にする。表示は件数・種類・フォルダだけで、シェルも `npx` も使わない。GitHub Actions で確認するときは、`harness-check.yml` に `baseline` の job も加わる（依存は `npm ci --ignore-scripts`）。`AGENTS.md` の印の中に実行方法の1行が足される。`harness create` の出力は変わらない

- `harness status` が、npm・Node.js の登録情報を読んで、採用した技術の新しい大きな版と、ハーネスの使える範囲（`version_ranges`）を緩められる候補を表示する（Issue #6）。読むだけで、何も書かない。取得できない項目は、固定の分類の理由（時間切れ・HTTP の番号など）で「取得できません」と表示し、終了コードは0

### 互換性が壊れる変更

- `harness adopt` の適用に `--issue <番号>` が必須になり、Git のフォルダで作業ツリーがきれいなときだけ実行できる（新しいブランチに導入するため）。`--dry-run` は、これまでどおり、どこでも実行できる

- **生成したプロジェクトの品質チェック（`npm run check`）に Docker が必須になった**。D1・DB なしのプロジェクトでも、Semgrep・gitleaks・OSV-Scanner を Docker のイメージで実行する。Docker がないと `npm run check` は失敗する（スキップの環境変数はない）。Docker のコンテナの中では、Docker を使わない `npm run check:app` を実行する。`harness update` の後、Docker を入れて起動してから `npm run check` を実行する。Docker Desktop は、大きな会社が業務で使うときは有料になる
- 品質チェックを2段にした：`npm run check:app`（これまでの `check` の中身）と、`npm run check`（`check:app` に `npm run security` を足したもの）。CI（GitHub Actions）の ubuntu は Docker を使える
- `package.json` はプロジェクトのものなので、`harness update` は `scripts` を書き換えない。作成済みのプロジェクトは、新しく生成した `package.json` を見て、`check:app`・`check`（`npm run check:app && npm run security`）・`security`・`security:semgrep`・`security:secrets`・`security:osv` を手で足す（`scripts/security-check.mjs` などのファイルは、`harness update` で入る）
- `harness create --verify` は、DB に関係なく、先に Docker を確かめる。Docker が使えないときは、確かめを飛ばして理由を表示する（これまでは PostgreSQL のときだけ）

### 追加

- セキュリティのテスト：`scripts/security-check.mjs`（`npm run security`・`security:semgrep`・`security:secrets`・`security:osv`）、Semgrep のルール（`.semgrep/`。公開のルールから選んだもの）、`.gitleaks.toml`、`.github/dependabot.yml`（GitHub のときだけ）、`docs/testing/security.md`。イメージは、版とダイジェストで固定し、技術プロファイルの `container_images` に確かめた日と方法を記録する
- Git に追加された秘密のファイル（`.env`・`.env.*`・`.dev.vars`。`.env.example` を除く）を、`npm run security` と `pre-commit`（GitHub を使わない場合）が止める
- API の仕様書（`docs/api/openapi.json`。プロジェクトのもの）と、実際のルートとの突き合わせのテスト（`backend/src/openapi.test.ts`）、Schemathesis の手順書（`docs/testing/schemathesis.md`）
- ハーネスが管理するファイル：`scripts/security-check.mjs`・`.gitleaks.toml`・`.semgrep/`・`.github/dependabot.yml`

### 修正

- 壊れた JSON の本文を受けると 500 を返していたのを、検証のエラー（422・`VALIDATION_ERROR`）にした（Schemathesis が見つけた不具合）

## 0.0.0

初回完成。

### 生成（harness create）

- 質問に答えると、Cloudflare（Workers・D1／PostgreSQL）・React・Hono のアプリの土台と、AI と開発するためのルール（AGENTS.md・CLAUDE.md・Skill・役割ごとのエージェントの定義）を生成する
- 回答の整合性チェック、使う技術のバージョンの調査と選択、F-26 の判定（ASVS のレベル・ペネトレーションテストの要否）、要件定義書・ADR・テストの手順書・設計書のひな形
- GitHub を使うプロジェクトと、使わない（手元の Git だけの）プロジェクトの出し分け（フックと取り込みのコマンド）
- E2E（Playwright）と IaC（Terraform）のひな形、開発と検証の環境の分離
- 認証・ファイルのアップロードは、生成のときではなく、アプリの要件定義で決める（共通仕様はルールとして残す）
- `--verify`：生成の直後に `npm install` と `npm run check` で動作を確かめ、`docs/tech-stack.md` に記録する

### コードの書き方のルール

- コードを書く前に、変更する部分の Skill を必ず読んで従う決まり（AGENTS.md の表・計画の「従うルール」・コードレビューでの確認）
- バックエンド・クエリ（Drizzle・Hono）とフロントエンド（TanStack Query・React Hook Form・Axios・ロガー）の Skill に、テストで動作を確かめた良い例・悪い例を載せた。悪い例は、問題が起きることをテストで示す

### 更新と状態の確認

- `harness update`：ハーネスのルールの変更を、作成済みのアプリに反映する（書き換えたファイルは上書きしない。失敗・中断では元に戻す）
- `harness status`：プロジェクト・インストール済み・最新のバージョンと、主な変更点を表示する
