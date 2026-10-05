# Terraform とプロバイダーの版を固定する（C-62）。版の決め方は docs/tech-stack.md。
terraform {
  required_version = ">= {{terraform_version}}, < 2.0.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= {{terraform_cloudflare_version}}"
    }
  }
}
