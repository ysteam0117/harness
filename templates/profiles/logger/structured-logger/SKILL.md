---
name: logger
description: ログの出し方のルール。ログを出すとき、監査ログを残すとき、エラーを記録するときに読む。
---

<!-- もとになった共通仕様：C-30 -->

# ログ（共通ロガー）

作業の過程と結果は、すべて日本語で書く。

## 使い方

```ts
import { createLogger } from "../lib/logger/logger";

const logger = createLogger({ traceId: requestId, userId });
logger.info("レシピを登録した", { recipeId });
logger.warn("試行制限を発動した", { attempts });
logger.error("想定していないエラー", { error });
logger.audit("権限の変更", `user:${targetUserId}`, "success");
```

## 守ること

- **MUST NOT**：各層から`console.log`等を直接呼ばない。必ず共通ロガーを使う
- **MUST**：`INFO`は正常な重要イベント、`WARN`は処理を続けたが想定外のこと、`ERROR`は処理を完了できず対応が必要なこと、`DEBUG`は開発時だけに使う
- **MUST**：ログイン・ログアウト・パスワードや認証要素の変更・権限の変更・認可の拒否・試行制限の発動・管理者の操作は、`audit`で記録する
- 伏せ字にする項目名は`logger.ts`の`REDACT_KEYS`にある。新しく秘密情報・個人情報の項目を扱う場合は、ここに加え、`logger.test.ts`にも確かめるテストを加える
- 利用者はログ上で利用者IDで表し、メールアドレスや氏名を書かない
