# ファイルのアップロード先の R2 バケット。名前は wrangler.jsonc の bucket_name と同じにする。
resource "cloudflare_r2_bucket" "uploads" {
  account_id = var.account_id
  name       = "${var.app_name}-uploads"
}

output "r2_bucket_name" {
  description = "wrangler.jsonc の r2_buckets の bucket_name と同じ値"
  value       = cloudflare_r2_bucket.uploads.name
}
