---
name: logger
description: ログの出し方のルール（Spring Boot。SLF4J・Logback）。ログを出すとき、エラーを記録するときに読む。
---

<!-- もとになった共通仕様：C-30 -->

# ログ（SLF4J・Logback）

作業の過程と結果は、すべて日本語で書く。{{profile_skill_note}}

## 使い方

```java
private static final Logger log = LoggerFactory.getLogger(RecipeService.class);

log.info("レシピを登録した recipeId={}", recipeId);
log.warn("試行制限を発動した attempts={}", attempts);
log.error("想定していないエラー", exception);
```

- `org.slf4j.Logger`を使う。`System.out`・`System.err`・`e.printStackTrace()`で出さない
- ログの設定は`backend/src/main/resources/logback-spring.xml`。出力先・書式を変えるときは、ここを直す

## 守ること

- **MUST NOT**：パスワード・トークン・APIキー・セッションID・個人情報（氏名・メールアドレス・電話番号など）をログに出さない。オブジェクトをそのまま出さず、必要な項目だけを出す
- **MUST**：`INFO`は正常な重要イベント、`WARN`は処理を続けたが想定外のこと、`ERROR`は処理を完了できず対応が必要なこと、`DEBUG`は開発時だけに使う
- **MUST**：メッセージは`{}`で値を埋め込む（`+`で文字列をつなげない）。例外は最後の引数に渡し、スタックトレースを残す
- 利用者はログ上で利用者IDで表し、メールアドレスや氏名を書かない
