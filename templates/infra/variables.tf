# 秘密情報・環境ごとの値は、コードに書かず、環境変数（TF_VAR_<名前>）で渡す（C-05・C-40）。
variable "account_id" {
  type        = string
  description = "Cloudflare のアカウント ID（TF_VAR_account_id で渡す）"
  sensitive   = true
}

variable "app_name" {
  type        = string
  description = "アプリ名。リソースの名前の元になる（wrangler.jsonc の名前とそろえる）"
  default     = "{{app_name}}"
}

variable "environment" {
  type        = string
  description = "環境。既定では本番だけを作る（C-39）。検証の環境を足すときに、許可する値を広げる"
  default     = "production"

  validation {
    condition     = var.environment == "production"
    error_message = "environment は production だけを指定できます（検証の環境を足すときに広げる）。"
  }
}
