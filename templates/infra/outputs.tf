# 値は apply の後に確かめる。D1・R2・Hyperdrive の出力は、それぞれのファイルにある。
output "environment" {
  description = "この構成が対象にしている環境"
  value       = var.environment
}
