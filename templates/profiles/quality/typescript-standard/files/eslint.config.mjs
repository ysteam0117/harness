import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  ...tseslint.configs.recommended,
  // Reactのルールはフロントエンドのコードにだけ当てはめる（E2Eの `use` 等を誤って判定するため）
  { files: ["frontend/**/*.{ts,tsx}"], ...reactHooks.configs.flat.recommended },
  // 関数の複雑さの上限（初期値）。超えたら分割を検討する
  { rules: { complexity: ["error", 15] } },
  // 生成されたファイル・組み立ての結果は対象から外す
  {
    ignores: [
      "node_modules",
      "dist",
      ".wrangler",
      "**/.wrangler",
      "worker-configuration.d.ts",
      "prototype",
    ],
  },
);
