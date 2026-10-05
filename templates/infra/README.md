# infra/（Terraform）

Cloudflare の資源を、コードで作る（C-39）。管理画面での手作業はしない。**既定では本番だけ**を作る（C-40）。

> `terraform plan`・`terraform apply` は、Cloudflare の本番に影響する。**利用者の承認を得てから**実行する。AI は承認なしに実行しない。

## 役割の分け方（Terraform と wrangler）

| やること | 使う道具 |
| --- | --- |
| D1・R2・Hyperdrive の作成・変更 | Terraform（この `infra/`） |
| Worker のコードのデプロイ | wrangler |
| 環境変数（`vars`） | wrangler（`wrangler.jsonc`） |
| 秘密情報（`secret`） | wrangler（`npx wrangler secret put`。手順は `docs/secrets.md`） |
| DNS（独自ドメイン） | 今は対象外 |

- Worker そのものは Terraform で作らない（二重の管理を避ける）
- ドメインが決まったら、DNS のリソースを `infra/` に足す
- 出るファイルは回答で決まる：`d1.tf`（D1）・`r2.tf`（ファイルのアップロード）・`hyperdrive.tf`（PostgreSQL）

## 必要なもの

- Terraform（版は `docs/tech-stack.md` と `versions.tf`）。PC に直接入れる
- Cloudflare の API トークン。必要な権限だけを付ける（D1・R2・Hyperdrive の編集）

## 秘密情報の渡し方

コードにも `.env.example` にも書かない。環境変数で渡す（`docs/secrets.md` の「Terraform」）。

| 環境変数 | 内容 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare の API トークン |
| `TF_VAR_account_id` | Cloudflare のアカウント ID |
| `TF_VAR_hyperdrive_host`・`TF_VAR_hyperdrive_database`・`TF_VAR_hyperdrive_user`・`TF_VAR_hyperdrive_password` | Hyperdrive の接続情報（`hyperdrive.tf` があるときだけ） |

## 手順

1. 環境変数を設定する（上の表。値は自分でターミナルに入力する）
2. 初期化する（Cloudflare には何も作らない）

   ```bash
   terraform -chdir=infra init
   ```

3. 構文を確かめる（認証が要らない）

   ```bash
   terraform -chdir=infra validate
   ```

4. 差分を確かめる。結果を{{change_review_place}}確認する

   ```bash
   terraform -chdir=infra plan
   ```

5. 利用者の承認を得てから、適用する

   ```bash
   terraform -chdir=infra apply
   ```

6. 出力の値を `wrangler.jsonc` に書き写す（D1 の `database_id`、Hyperdrive の `id`）

   ```bash
   terraform -chdir=infra output
   ```

## 版の固定（lock ファイル）

プロバイダーの版は `versions.tf` で固定している。さらに、取得したファイルの検証値を `.terraform.lock.hcl` に記録し、**コミットする**（C-62）。最初の1回、次のコマンドで作る。

```bash
terraform -chdir=infra providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=windows_amd64
```

## 状態ファイル（tfstate）

- 状態ファイルには、秘密情報（Hyperdrive の接続情報など）が**平文で**残る。リポジトリにコミットしない（`.gitignore` で除外済み）
- 手元の状態ファイルのままにしない。**アクセスを制限し、暗号化する保存先（リモートの状態管理）**に置く。置き場所は、ADR で決めて記録する
- 同時に2人が適用しないよう、保存先のロック（lock）の機能を使う。使えない保存先は選ばない
- 保存先を決めたら、`terraform` ブロックに `backend` を足し、`terraform -chdir=infra init -migrate-state` で移す

## 環境（environment）

`environment` 変数は、既定が `production` で、`production` 以外は拒否する。検証の環境を足すときに、許可する値を広げ、リソースの名前に環境を含める。
