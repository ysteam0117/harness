# D1 のデータベース。Worker から使うための紐づけ（バインディング）は wrangler.jsonc に書く。
resource "cloudflare_d1_database" "main" {
  account_id = var.account_id
  name       = "${var.app_name}-db"
}

output "d1_database_id" {
  description = "wrangler.jsonc の d1_databases の database_id に書く値"
  value       = cloudflare_d1_database.main.id
}
