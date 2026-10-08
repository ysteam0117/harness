---
name: logger
description: ログの出し方のルール。ログを出すとき、監査ログを残すとき、エラーを記録するときに読む。
---

<!-- もとになった共通仕様：C-30 -->

# ログ（共通ロガー）

作業の過程と結果は、すべて日本語で書く。{{profile_skill_note}}

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

- **MUST NOT**：{{logger_common_rule}}
- **MUST**：`INFO`は正常な重要イベント、`WARN`は処理を続けたが想定外のこと、`ERROR`は処理を完了できず対応が必要なこと、`DEBUG`は開発時だけに使う
- **MUST**：{{logger_audit_rule}}
- 伏せ字にする項目名は`logger.ts`の`REDACT_KEYS`にある。新しく秘密情報・個人情報の項目を扱う場合は、ここに加え、`logger.test.ts`にも確かめるテストを加える
- 利用者はログ上で利用者IDで表し、メールアドレスや氏名を書かない

## 良い例・悪い例

{{logger_examples_intro}}

### 共通ロガーを使い、`console.log`で秘密の値を出さない

#### 良い例

{{example:backend/src/rules-examples/logger.test.ts#use-logger}}

#### 悪い例

{{example:backend/src/rules-examples/logger.test.ts#console-log-bad}}

- 問題：`console.log`でそのまま出すと、`token`・`password`などの秘密の値が、ログにそのまま残る
