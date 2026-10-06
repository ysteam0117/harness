# 変更履歴

ハーネスのバージョンごとの主な変更点。`harness status` は、このファイルから、プロジェクトのバージョンより新しい項目を表示する。バージョンはセマンティックバージョニング（C-08）で付ける。

## 次の版（未リリース。版はリリースのときに決める）

セキュリティのテストの道具を、技術プロファイルに追加した（Issue #42）。

### 互換性が壊れる変更

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
