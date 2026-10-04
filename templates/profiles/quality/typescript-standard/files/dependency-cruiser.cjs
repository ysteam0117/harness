// 層をまたぐ依存の向き（C-03・C-06）。違反が1件でもあれば失敗にする
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    // フロントエンド：画面（pages）は部品を組み合わせるだけ。API層（features/*/api）と通信の共通部分（services）を直接呼ばない
    {
      name: "no-pages-to-api",
      severity: "error",
      from: { path: "^frontend/src/pages" },
      to: { path: "^frontend/src/features/[^/]+/api" },
    },
    {
      name: "no-pages-to-services",
      severity: "error",
      from: { path: "^frontend/src/pages" },
      to: { path: "^frontend/src/services" },
    },
    {
      name: "no-components-to-services",
      severity: "error",
      from: { path: "^frontend/src/components" },
      to: { path: "^frontend/src/services" },
    },
    {
      name: "no-features-to-pages",
      severity: "error",
      from: { path: "^frontend/src/features" },
      to: { path: "^frontend/src/pages" },
    },
    // バックエンド：routes（Controller）から db（Repository）を直接呼ばない（services を通す）
    {
      name: "no-routes-to-db",
      severity: "error",
      from: { path: "^backend/src/routes" },
      to: { path: "^backend/src/db" },
    },
    {
      name: "no-db-to-services-or-routes",
      severity: "error",
      from: { path: "^backend/src/db" },
      to: { path: "^backend/src/(services|routes)" },
    },
    {
      name: "no-services-to-routes",
      severity: "error",
      from: { path: "^backend/src/services" },
      to: { path: "^backend/src/routes" },
    },
    // services は HTTP（Hono）を知らない
    {
      name: "no-services-to-hono",
      severity: "error",
      from: { path: "^backend/src/services" },
      to: { path: "node_modules/hono" },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
  },
};
