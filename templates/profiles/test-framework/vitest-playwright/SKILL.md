---
name: test-tools
description: テストの道具の使い方。Vitest（バックエンドはWorkersの実行エンジン、フロントエンドはjsdom）、Testing Library、MSW、fast-check、Playwright、k6、OWASP ZAPを使うときに読む。
---

<!-- もとになった共通仕様：C-24・C-25・C-37・C-69・C-70・C-79 -->

# テストの道具

作業の過程と結果は、すべて日本語で書く。

| 用途 | 道具 | 置き場所 |
| --- | --- | --- |
| バックエンドの単体・結合テスト | Vitest＋`@cloudflare/vitest-pool-workers`（本番と同じ実行エンジン、ローカルのD1） | `backend/**/*.test.ts` |
| フロントエンドの単体・コンポーネントのテスト | Vitest（jsdom）＋Testing Library | `frontend/**/*.test.tsx` |
| 外部APIのモック | MSW | テストの共通処理（`test/`） |
| 異常な入力のテスト | fast-check | 対象と同じ場所 |
| E2E | Playwright（`e2e/console-guard.ts`の`test`を使う） | `e2e/` |
| 負荷・限界のテスト | k6（検証環境だけ、承認を得て） | `tests/load/` |
| セキュリティのテスト（DAST） | OWASP ZAP（検証環境だけ、承認を得て） | 手順書（`docs/testing/`） |

## 守ること

- **MUST**：Web E2Eは、`@playwright/test`ではなく`e2e/console-guard.ts`の`test`・`expect`を読み込む。意図したエラー（誤ったパスワードでの401等）は、そのテストの中だけで`allowConsoleError(page, /メッセージ/, "理由")`で許可する
- **MUST**：バックエンドの結合テストは、テストごとにマイグレーションを適用したローカルのD1で行う（`vitest.config.ts`の設定済み）
- **MUST**：Workers＋PostgreSQL（Hyperdrive）の結合テストは、テストの道具の中では`pg`を読み込めないため、`wrangler dev`で起動したアプリのAPIに対して行う
- **MUST**：フロントエンドのテストでAPIを呼ぶ場合は、jsdomの画面の場所と同じドメインにし、MSWで応答を返す
- **MUST**：テストで起動したものは、テストの工程が完了したら止め、ポートが解放されたことを確かめる。ポートの確認は、待ち受け中（LISTEN）の状態だけで判定する
- **MUST NOT**：自動の再試行（`retries`）でテストを通さない
