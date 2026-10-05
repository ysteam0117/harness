# 設計書：E2E と IaC のひな形（Issue #64）

## 目的と範囲

生成したプロジェクトに、Playwright の最初のシナリオ（`e2e/`）と、Terraform（`infra/`）を出す。要件：C-24・C-69（E2E）、C-39・C-40・C-62（IaC）。

- 受け入れ条件
  - AC-1：生成したプロジェクトで、E2E のシナリオが手元で通る
  - AC-2：生成した `infra/` で `terraform validate` が通る（Cloudflare には何も作らない）
- ハーネスの `npm run smoke:generated` が、どちらも実際に実行して確かめる

## E2E

| ファイル | 出す条件 | 内容 |
| --- | --- | --- |
| `playwright.config.ts` | 常に | `webServer` で `npm run dev:test`（検証用の開発サーバー）を必ず起動する。`reuseExistingServer` は `false` で、接続先の切り替え（`E2E_BASE_URL`）は作らない（`local-env.ts` が親の環境変数を消す方針に合わせ、検証を別のサーバーに向けないため） |
| `e2e/health.spec.ts` | 常に | 画面を開いて「サーバーの状態：ok」「環境：test」が見え、`/api/health` が 200 を返す。コンソールのエラーは `console-guard` が失敗にする |
| `e2e/sample-users.spec.ts` | DB あり | シードした `e2euser_health_001` を `/api/sample-users` から読める。シードの保存先と、検証用サーバーの読み先が同じことの確認を兼ねる |
| `e2e/auth-session.spec.ts` | 認証あり（#73。`--answers` で認証を明示したときだけ。既定の未定では出ない。#79） | 未認証の `/api/auth/me` が 401（`Cache-Control: no-store`）で、保護された画面（`/account`）を開くとログインの案内（`/login`）に移る。ブラウザが出す 401 のコンソールの出力は、理由を付けて許可する |
| `e2e/seeds/health.sql` | DB あり | 架空のシード（`e2euser_` で始まる。`ON CONFLICT DO NOTHING` で何回流しても同じ） |

- 検証用 DB の初期化は、`globalSetup` ではなく、npm の前処理 `pretest:e2e` で行う。Playwright は `webServer` を起動した**あとに** `globalSetup` を実行するため、サーバーが DB を開いたあとに DB を消してしまう（D1 のファイルを消す）から
- `pretest:e2e`：DB なしは `npm run env:check -- test` だけ。DB ありは、続けて `npm run db:reset:test`（検証用 DB の初期化・マイグレーション・標準のシード）と、`node scripts/db-local.ts test seed-file e2e/seeds/health.sql`（E2E 用のシード）を行う。どちらの DB の種類も、`package_json_when` で出し分ける（ひな形のファイルに条件の分岐を入れない方針）
- `db-local.ts` の `seed-file` は、`e2e/seeds/` の下の `.sql` を1つだけ受け付け、選んだ環境の保存先（D1 は `--persist-to`、PostgreSQL は検証用のコンテナ）にだけ流す
- `run-local.ts` の許可する道具に `playwright` を足した。道具の名前とパッケージ名が違う（`@playwright/test`）ため、名前 → パッケージ名の表を持つ
- `cleanup.sql` は `e2euser_` も識別して消し、残数が 0 になることを確かめる（`testuser_` と同じ）
- E2E は `npm run check` に入れない（ブラウザの導入が要り、時間がかかるため）。生成するプロジェクトの CI（`check.yml`）にも、今回は足していない

## IaC

| ファイル | 出す条件 | 内容 |
| --- | --- | --- |
| `infra/versions.tf` | 常に | `required_version` と、`cloudflare/cloudflare` プロバイダーを `= 版` で固定 |
| `infra/providers.tf` | 常に | `provider "cloudflare" {}`。トークンは環境変数 `CLOUDFLARE_API_TOKEN` |
| `infra/variables.tf` | 常に | `account_id`（`sensitive`・既定なし）・`app_name`・`environment`（既定 `production`、validation で `production` だけ） |
| `infra/outputs.tf` | 常に | `environment` の出力 |
| `infra/d1.tf` | `database` が `d1` | `cloudflare_d1_database`（`<app_name>-db`）と、`wrangler.jsonc` に書く id の出力 |
| `infra/r2.tf` | `file_upload` が `yes`（`--answers` で明示したときだけ。既定の未定では出ない。#79） | `cloudflare_r2_bucket`（`<app_name>-uploads`。wrangler の `bucket_name` と同じ） |
| `infra/hyperdrive.tf` | `database` が `postgresql` | `cloudflare_hyperdrive_config`。接続情報は `sensitive` の変数（`TF_VAR_` で渡す） |
| `infra/README.md` | 常に | 手順・役割の分け方・状態ファイル・lock ファイルの作り方 |

- Terraform と wrangler の役割：D1・R2・Hyperdrive の作成は Terraform。Worker のコードのデプロイ・環境変数（`vars`）・秘密情報（`secret`）は wrangler。Worker のリソースは Terraform で作らない。DNS はドメインが未定のため対象外（決まったら `infra/` に足す）
- 秘密情報（`CLOUDFLARE_API_TOKEN`・`TF_VAR_account_id`・Hyperdrive の接続情報）は `.env.example` に入れず、`docs/secrets.md` の Terraform の節に固定の文で書く（手元の開発・テストには要らないため）
- `.gitignore` に `.terraform/`・`*.tfstate`・`*.tfstate.*`・`*.tfvars`・`crash.log`・`*.tfplan` を足す。`.terraform.lock.hcl` は除外しない（C-62：コミットする）
- Hyperdrive の接続情報は状態ファイルに平文で残る。リモートの状態管理（暗号化・アクセス制限）を必須とし、置き場所は ADR で決める（`infra/README.md`）
- lock ファイルはハーネスでは作らない（プラットフォームごとの検証値になるため）。`infra/README.md` に `terraform providers lock` の手順を書く

## 版の決め方（Cloudflare プロバイダー）

Cloudflare プロバイダーは v5 系。`data/runtimes.yaml` の `terraform_cloudflare_provider` に、確かめた版を書く。

1. 生成した `infra/`（D1・R2・Hyperdrive の3つが入る回答）で、`terraform init -backend=false -input=false` を実行する
2. `terraform fmt -check` と `terraform validate` が成功した版を、`data/runtimes.yaml` に書く（確かめた日と Terraform の版も、そこのコメントに書く）
3. `docs/tech-stack.md` にも、Terraform とプロバイダーの版を載せる（`renderTechStack`）

Cloudflare への `plan`・`apply`・認証が要る操作は、確かめでも実行しない。更新するときも同じ手順で確かめる。

## smoke（`scripts/smoke-generated.ts`）

- 各通りで、`npm install` のあとに、Playwright のブラウザ（chromium）を導入し、`npm run test:e2e` を実行する。D1 は2回続けて実行し、既存のデータがある2回目でも初期化とシードの取得が成功することを確かめる。PostgreSQL は、検証用 DB のコンテナを起動して待ってから実行する。終わったら、検証用サーバーのポートが解放されたことを確かめる
- 各通り（`local` を含む）で、`terraform -chdir=infra init -backend=false`・`fmt -check`・`validate` を実行する。`terraform` がなければ飛ばす。`SMOKE_REQUIRE_TERRAFORM=1` のときは失敗にする
- `SMOKE_SKIP_E2E=1` で E2E を飛ばせる
- CI の smoke ジョブは、`hashicorp/setup-terraform`（版を固定）と `SMOKE_REQUIRE_TERRAFORM=1` を使う
