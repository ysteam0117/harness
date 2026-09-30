// 層をまたぐ依存の向き（C-03・C-06）。違反が1件でもあれば失敗にする
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    // フロントエンド：画面・部品からAPI層を直接呼ばない（Hookを通す）
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
    // バックエンド：Controller からデータアクセス層を直接呼ばない（Service を通す）
    {
      name: "no-controller-to-repository",
      severity: "error",
      from: { path: "^backend/src/controllers" },
      to: { path: "^backend/src/(repositories|daos)" },
    },
    {
      name: "no-repository-to-service",
      severity: "error",
      from: { path: "^backend/src/(repositories|daos)" },
      to: { path: "^backend/src/(services|controllers)" },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
  },
};
