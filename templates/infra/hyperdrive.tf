# Hyperdrive の設定（PostgreSQL への接続）。接続情報は変数で渡し、コードに書かない。
# 状態ファイルには接続情報が平文で残るため、リモートの状態管理（暗号化・アクセス制限）が必須（README）。
variable "hyperdrive_host" {
  type        = string
  description = "PostgreSQL のホスト名（TF_VAR_hyperdrive_host で渡す）"
  sensitive   = true
}

variable "hyperdrive_port" {
  type        = number
  description = "PostgreSQL のポート"
  default     = 5432
}

variable "hyperdrive_database" {
  type        = string
  description = "PostgreSQL のデータベース名（TF_VAR_hyperdrive_database で渡す）"
  sensitive   = true
}

variable "hyperdrive_user" {
  type        = string
  description = "PostgreSQL のユーザー名（TF_VAR_hyperdrive_user で渡す）"
  sensitive   = true
}

variable "hyperdrive_password" {
  type        = string
  description = "PostgreSQL のパスワード（TF_VAR_hyperdrive_password で渡す）"
  sensitive   = true
}

resource "cloudflare_hyperdrive_config" "main" {
  account_id = var.account_id
  name       = "${var.app_name}-db"

  origin = {
    scheme   = "postgres"
    host     = var.hyperdrive_host
    port     = var.hyperdrive_port
    database = var.hyperdrive_database
    user     = var.hyperdrive_user
    password = var.hyperdrive_password
  }
}

output "hyperdrive_id" {
  description = "wrangler.jsonc の hyperdrive の id に書く値"
  value       = cloudflare_hyperdrive_config.main.id
}
