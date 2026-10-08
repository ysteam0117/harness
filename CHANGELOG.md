# 変更履歴

ハーネスのバージョンごとの主な変更点。`harness status` は、このファイルから、プロジェクトのバージョンより新しい項目を表示する。バージョンはセマンティックバージョニング（C-08）で付ける。

## 次の版（未リリース。版はリリースのときに決める）

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
