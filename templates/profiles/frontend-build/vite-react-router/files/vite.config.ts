import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// 画面（React）とAPI（Hono）を1つのWorkersにまとめて組み立てる（C-29）
export default defineConfig(({ mode }) => {
  // Cloudflare の道具（wrangler）が環境変数から読む設定（CLOUDFLARE_ で始まるもの。
  // Hyperdrive の手元の接続先など）を、.env から読んで渡す。すでに環境変数にある値（Docker の設定など）は上書きしない
  const env = loadEnv(mode, process.cwd(), "CLOUDFLARE_");
  for (const [name, value] of Object.entries(env)) process.env[name] ??= value;

  return { plugins: [react(), cloudflare()] };
});
