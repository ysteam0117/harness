import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// 画面（React）とAPI（Hono）を1つのWorkersにまとめて組み立てる（C-29）
export default defineConfig({
  plugins: [react(), cloudflare()],
});
